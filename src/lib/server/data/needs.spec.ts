import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { groceryNeeds, items, stores } from '../db/schema.ts';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import { setItemArchived } from './items.ts';
import {
	addNeed,
	listActiveLines,
	listHistory,
	markAllOrdered,
	markAllReceived,
	markDidntCome,
	markGotFewer,
	markOrdered,
	markReceived,
	undoReceived,
	updateLine,
	type AddInput
} from './needs.ts';

const TZ = 'America/Chicago';
// Sat 2026-10-03 12:00 in Chicago.
const NOON = Date.UTC(2026, 9, 3, 17, 0);
const HOUR = 60 * 60 * 1000;

function add(householdId: number, input: Partial<AddInput> & { itemName: string }) {
	return addNeed(
		householdId,
		{ quantity: 1, unit: null, store: 'usual', resolution: 'none', ...input },
		NOON
	);
}

function lines(householdId: number, now = NOON) {
	return listActiveLines(householdId, TZ, now);
}

function onlyLine(householdId: number) {
	const all = lines(householdId);
	expect(all).toHaveLength(1);
	return all[0]!;
}

function defaultStoreOf(itemId: number) {
	return db().select().from(items).where(eq(items.id, itemId)).get()?.defaultStoreId;
}

let householdId: number;
let walmart: number;
let aldi: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	walmart = makeStore(householdId, 'Walmart');
	aldi = makeStore(householdId, 'Aldi');
});

describe('adding', () => {
	it('creates the item and a To Order line without a store', () => {
		expect(add(householdId, { itemName: '  Paper   towels ', quantity: 2, unit: 'rolls' })).toEqual({
			kind: 'added'
		});
		const line = onlyLine(householdId);
		expect(line).toMatchObject({
			itemName: 'Paper towels',
			quantity: 2,
			unit: 'rolls',
			storeId: null,
			status: 'to_order'
		});
	});

	it('matches existing items ignoring case', () => {
		add(householdId, { itemName: 'Milk' });
		markReceived(householdId, onlyLine(householdId).id, walmart, NOON);
		add(householdId, { itemName: 'MILK' });
		expect(lines(householdId).filter((l) => l.status === 'to_order')[0]?.itemName).toBe('Milk');
		expect(db().select().from(items).all()).toHaveLength(1);
	});

	it('fills in the default store, and leaves it out when asked', () => {
		add(householdId, { itemName: 'Milk' });
		markReceived(householdId, onlyLine(householdId).id, aldi, NOON);
		add(householdId, { itemName: 'Milk' });
		expect(lines(householdId).find((l) => l.status === 'to_order')?.storeId).toBe(aldi);

		add(householdId, { itemName: 'Eggs', store: walmart });
		expect(lines(householdId).find((l) => l.itemName === 'Eggs')?.storeId).toBe(walmart);
	});

	it('skips an archived default store', () => {
		add(householdId, { itemName: 'Milk' });
		markReceived(householdId, onlyLine(householdId).id, aldi, NOON);
		db().update(stores).set({ archivedAt: 1 }).where(eq(stores.id, aldi)).run();
		add(householdId, { itemName: 'Milk' });
		expect(lines(householdId).find((l) => l.status === 'to_order')?.storeId).toBeNull();
	});

	it('warns about a To Order duplicate and suggests the sum when units match', () => {
		add(householdId, { itemName: 'Milk', quantity: 2, unit: 'gal', store: walmart });
		expect(add(householdId, { itemName: 'milk', quantity: 1, unit: 'GAL' })).toEqual({
			kind: 'duplicate',
			status: 'to_order',
			itemName: 'Milk',
			quantity: 2,
			unit: 'gal',
			storeName: 'Walmart',
			suggestedQuantity: 3
		});
		expect(add(householdId, { itemName: 'Milk', quantity: 1, unit: 'jug' })).toMatchObject({
			suggestedQuantity: 1
		});
		expect(add(householdId, { itemName: 'Milk', quantity: 3, unit: 'gal', resolution: 'update' })).toEqual({
			kind: 'updated'
		});
		expect(onlyLine(householdId)).toMatchObject({ quantity: 3, unit: 'gal', storeId: walmart });
	});

	it('offers a new line when the item is only Ordered', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		markOrdered(householdId, onlyLine(householdId).id, undefined, NOON);
		expect(add(householdId, { itemName: 'Milk' })).toMatchObject({
			kind: 'duplicate',
			status: 'ordered'
		});
		expect(add(householdId, { itemName: 'Milk', resolution: 'add' })).toEqual({ kind: 'added' });
		expect(lines(householdId).map((l) => l.status).sort()).toEqual(['ordered', 'to_order']);
	});

	it('asks before reusing an archived item, then restores it', () => {
		add(householdId, { itemName: 'Milk' });
		const itemId = onlyLine(householdId).itemId;
		setItemArchived(householdId, itemId, true, NOON);
		db().delete(groceryNeeds).run();
		expect(add(householdId, { itemName: 'milk' })).toEqual({ kind: 'archived', itemName: 'Milk' });
		expect(add(householdId, { itemName: 'milk', resolution: 'restore' })).toEqual({ kind: 'added' });
		expect(db().select().from(items).get()?.archivedAt).toBeNull();
	});

	it("rejects another household's store", () => {
		const other = makeHousehold(TZ);
		const theirStore = makeStore(other.householdId, 'Target');
		expectHttpError(() => add(householdId, { itemName: 'Milk', store: theirStore }), 404);
	});
});

describe('status changes', () => {
	it('needs a store to order or receive', () => {
		add(householdId, { itemName: 'Milk' });
		const id = onlyLine(householdId).id;
		expectHttpError(() => markOrdered(householdId, id, undefined, NOON), 400);
		expectHttpError(() => markReceived(householdId, id, undefined, NOON), 400);
		markReceived(householdId, id, aldi, NOON);
		expect(onlyLine(householdId)).toMatchObject({ status: 'received', storeId: aldi });
	});

	it('makes the store used the default store', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const line = onlyLine(householdId);
		markOrdered(householdId, line.id, aldi, NOON);
		expect(onlyLine(householdId)).toMatchObject({ status: 'ordered', storeId: aldi });
		expect(defaultStoreOf(line.itemId)).toBe(aldi);
	});

	it('marks a whole store ordered, then received', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		add(householdId, { itemName: 'Eggs', store: walmart });
		add(householdId, { itemName: 'Bread', store: aldi });
		expect(markAllOrdered(householdId, walmart, NOON)).toBe(2);
		const walmartLines = lines(householdId).filter((l) => l.storeId === walmart);
		expect(walmartLines.every((l) => l.status === 'ordered')).toBe(true);
		for (const line of walmartLines) expect(defaultStoreOf(line.itemId)).toBe(walmart);

		expect(markAllReceived(householdId, walmart, NOON)).toBe(2);
		expect(lines(householdId).find((l) => l.storeId === aldi)?.status).toBe('to_order');
	});

	it("puts a line that didn't come back to To Order with its store", () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const id = onlyLine(householdId).id;
		expectHttpError(() => markDidntCome(householdId, id), 400);
		markOrdered(householdId, id, undefined, NOON);
		markDidntCome(householdId, id);
		expect(onlyLine(householdId)).toMatchObject({
			status: 'to_order',
			storeId: walmart,
			orderedAt: null
		});
	});

	it('splits off what arrived when there were fewer', () => {
		add(householdId, { itemName: 'Yogurt', quantity: 3, unit: 'cups', store: walmart });
		const id = onlyLine(householdId).id;
		markOrdered(householdId, id, undefined, NOON);
		expectHttpError(() => markGotFewer(householdId, id, 3, undefined, NOON), 400);
		markGotFewer(householdId, id, 2, undefined, NOON);
		const all = lines(householdId);
		expect(all.find((l) => l.status === 'received')).toMatchObject({ quantity: 2, unit: 'cups' });
		expect(all.find((l) => l.status === 'to_order')).toMatchObject({
			id,
			quantity: 1,
			storeId: walmart,
			orderedAt: null
		});
	});

	it('undoes a line received today, but not one from yesterday', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const id = onlyLine(householdId).id;
		markOrdered(householdId, id, undefined, NOON - HOUR);
		markReceived(householdId, id, undefined, NOON);
		undoReceived(householdId, id, TZ, NOON + HOUR);
		expect(onlyLine(householdId).status).toBe('ordered');

		markReceived(householdId, id, undefined, NOON);
		expectHttpError(() => undoReceived(householdId, id, TZ, NOON + 24 * HOUR), 400);
	});

	it('only lets an ordered line keep a store', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const id = onlyLine(householdId).id;
		const change = { quantity: 2, unit: null, storeId: null, note: 'blue cap' };
		updateLine(householdId, id, change);
		expect(onlyLine(householdId)).toMatchObject({ quantity: 2, storeId: null, note: 'blue cap' });
		markOrdered(householdId, id, walmart, NOON);
		expectHttpError(() => updateLine(householdId, id, change), 400);
	});
});

describe('listing', () => {
	it('shows received lines only on the day they were received', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		markReceived(householdId, onlyLine(householdId).id, undefined, NOON);
		expect(lines(householdId, NOON + 6 * HOUR)).toHaveLength(1);
		// Midnight in Chicago.
		expect(lines(householdId, NOON + 12 * HOUR)).toHaveLength(0);
		expect(listHistory(householdId, 'mil', 10)).toHaveLength(1);
		expect(listHistory(householdId, 'eggs', 10)).toHaveLength(0);
	});

	it("never shows or changes another household's lines", () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const id = onlyLine(householdId).id;
		const other = makeHousehold(TZ);
		expect(lines(other.householdId)).toHaveLength(0);
		expectHttpError(() => markReceived(other.householdId, id, undefined, NOON), 404);
	});

	it('rejects a line that points at another household in the database itself', () => {
		add(householdId, { itemName: 'Milk' });
		const itemId = onlyLine(householdId).itemId;
		const other = makeHousehold(TZ);
		expect(() =>
			db()
				.insert(groceryNeeds)
				.values({
					householdId: other.householdId,
					itemId,
					quantity: 1,
					status: 'to_order',
					createdAt: NOON
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});
});
