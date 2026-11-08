import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { groceryNeeds, items, stores } from '../db/schema.ts';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import { setItemArchived } from './items.ts';
import {
	addNeed,
	deleteLine,
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
	withLineChanges,
	type AddInput
} from './needs.ts';
import { createStore } from './stores.ts';

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

function lineFor(householdId: number, itemName: string) {
	const line = lines(householdId).find((l) => l.itemName === itemName);
	expect(line, itemName).toBeDefined();
	return line!;
}

function defaultStoreOf(itemId: number) {
	return db().select().from(items).where(eq(items.id, itemId)).get()?.defaultStoreId;
}

/** The message a refusal shows the person. */
function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		if (isHttpError(e, 400)) return e.body.message;
		throw e;
	}
	return expect.fail('expected a refusal, but nothing was thrown');
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

	it('fills in the default store, uses a picked one, and leaves it out when asked', () => {
		add(householdId, { itemName: 'Milk' });
		add(householdId, { itemName: 'Eggs' });
		for (const line of lines(householdId)) markReceived(householdId, line.id, aldi, NOON);

		add(householdId, { itemName: 'Milk' });
		add(householdId, { itemName: 'Eggs', store: 'none' });
		add(householdId, { itemName: 'Bread', store: walmart });
		const open = lines(householdId).filter((l) => l.status === 'to_order');
		expect(open.find((l) => l.itemName === 'Milk')?.storeId).toBe(aldi);
		expect(open.find((l) => l.itemName === 'Eggs')?.storeId).toBeNull();
		expect(open.find((l) => l.itemName === 'Bread')?.storeId).toBe(walmart);
	});

	it('matches names ignoring case beyond A to Z', () => {
		add(householdId, { itemName: 'Éclairs', unit: 'box' });
		expect(add(householdId, { itemName: 'éclairs', unit: 'box' })).toMatchObject({
			kind: 'duplicate',
			itemName: 'Éclairs',
			suggestedQuantity: 2
		});
		expect(createStore(householdId, 'SEÑOR MARKET')).toEqual({ kind: 'saved' });
		expect(createStore(householdId, 'señor market')).toEqual({ kind: 'taken', archived: false });
		markReceived(householdId, onlyLine(householdId).id, walmart, NOON);
		expect(listHistory(householdId, 'éCLAIR', 10)).toHaveLength(1);
	});

	it('matches accented names whichever way they were typed', () => {
		// Escapes, so an editor can't quietly turn the accents into single characters.
		add(householdId, { itemName: 'Cafe\u0301 beans' });
		expect(add(householdId, { itemName: 'CAF\u00c9 BEANS' })).toMatchObject({ kind: 'duplicate' });
		add(householdId, { itemName: 'J\u030cicama' });
		expect(add(householdId, { itemName: '\u01f0icama' })).toMatchObject({ kind: 'duplicate' });
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

	it('suggests a sum without floating point noise (MEA-92)', () => {
		add(householdId, { itemName: 'Turkey', quantity: 1.1, unit: 'lb' });
		expect(add(householdId, { itemName: 'Turkey', quantity: 2.2, unit: 'lb' })).toMatchObject({
			suggestedQuantity: 3.3
		});
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

	it('keeps working for a line whose store was archived (design 6.10)', () => {
		add(householdId, { itemName: 'Bread', quantity: 2, store: aldi });
		const id = onlyLine(householdId).id;
		db().update(stores).set({ archivedAt: 1 }).where(eq(stores.id, aldi)).run();
		markOrdered(householdId, id, aldi, NOON);
		markGotFewer(householdId, id, 1, aldi, NOON);
		expect(lines(householdId).map((l) => [l.status, l.storeId]).sort()).toEqual([
			['received', aldi],
			['to_order', aldi]
		]);
		// Moving a line to an archived store is still refused.
		add(householdId, { itemName: 'Eggs', store: walmart });
		const eggs = lines(householdId).find((l) => l.itemName === 'Eggs')!;
		expectHttpError(() => markOrdered(householdId, eggs.id, aldi, NOON), 400);
	});

	it('learns the default store only when a line leaves To Order (design 6.3)', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const walmartOrder = onlyLine(householdId);
		markOrdered(householdId, walmartOrder.id, undefined, NOON);
		add(householdId, { itemName: 'Milk', store: aldi, resolution: 'add' });
		const aldiLine = lines(householdId).find((l) => l.status === 'to_order')!;
		markReceived(householdId, aldiLine.id, undefined, NOON);
		expect(defaultStoreOf(walmartOrder.itemId)).toBe(aldi);

		markReceived(householdId, walmartOrder.id, undefined, NOON);
		expect(defaultStoreOf(walmartOrder.itemId)).toBe(aldi);
	});

	it('learns the default store from Got fewer only when the line was To Order (design 6.3)', () => {
		add(householdId, { itemName: 'Milk', quantity: 2, store: walmart });
		const walmartOrder = onlyLine(householdId);
		markOrdered(householdId, walmartOrder.id, undefined, NOON);
		add(householdId, { itemName: 'Milk', quantity: 2, store: aldi, resolution: 'add' });
		const aldiLine = lines(householdId).find((l) => l.status === 'to_order')!;
		markGotFewer(householdId, aldiLine.id, 1, undefined, NOON);
		expect(defaultStoreOf(walmartOrder.itemId)).toBe(aldi);

		markGotFewer(householdId, walmartOrder.id, 1, undefined, NOON);
		expect(defaultStoreOf(walmartOrder.itemId)).toBe(aldi);
	});

	it('saves sheet edits with a status change, or neither', () => {
		add(householdId, { itemName: 'Bread', quantity: 2, store: walmart });
		const id = onlyLine(householdId).id;
		const edits = { quantity: 5, unit: 'loaves', storeId: walmart, note: 'whole wheat' };
		withLineChanges(householdId, id, edits, () => markOrdered(householdId, id, undefined, NOON));
		expect(onlyLine(householdId)).toMatchObject({ status: 'ordered', quantity: 5, unit: 'loaves' });

		add(householdId, { itemName: 'Eggs', quantity: 1 });
		const eggs = lines(householdId).find((l) => l.itemName === 'Eggs')!;
		const noStore = { quantity: 3, unit: null, storeId: null, note: null };
		expectHttpError(
			() =>
				withLineChanges(householdId, eggs.id, noStore, () =>
					markOrdered(householdId, eggs.id, undefined, NOON)
				),
			400
		);
		expect(lines(householdId).find((l) => l.itemName === 'Eggs')?.quantity).toBe(1);
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
		const walmartIds = lines(householdId)
			.filter((l) => l.storeId === walmart)
			.map((l) => l.id);
		expect(markAllOrdered(householdId, walmart, walmartIds, NOON)).toBe(2);
		const walmartLines = lines(householdId).filter((l) => l.storeId === walmart);
		expect(walmartLines.every((l) => l.status === 'ordered')).toBe(true);
		for (const line of walmartLines) expect(defaultStoreOf(line.itemId)).toBe(walmart);

		expect(markAllReceived(householdId, walmart, walmartIds, NOON)).toBe(2);
		expect(lines(householdId).find((l) => l.storeId === aldi)?.status).toBe('to_order');
	});

	it('orders only the lines the confirmation counted (MEA-68)', () => {
		for (const itemName of ['Milk', 'Bread', 'Butter', 'Rice']) {
			add(householdId, { itemName, store: walmart });
		}
		const milk = lineFor(householdId, 'Milk').id;
		const bread = lineFor(householdId, 'Bread').id;
		const butter = lineFor(householdId, 'Butter').id;
		const rice = lineFor(householdId, 'Rice').id;
		// Meanwhile, on another phone: Eggs is added, Bread is checked off in the store, Butter
		// moves to Aldi and Rice comes off the list.
		add(householdId, { itemName: 'Eggs', store: walmart });
		markReceived(householdId, bread, undefined, NOON);
		updateLine(householdId, butter, { quantity: 1, unit: null, storeId: aldi, note: null });
		deleteLine(householdId, rice);

		expect(markAllOrdered(householdId, walmart, [milk, bread, butter, rice], NOON)).toBe(1);
		expect(lineFor(householdId, 'Milk').status).toBe('ordered');
		const eggs = lineFor(householdId, 'Eggs');
		expect(eggs.status).toBe('to_order');
		expect(defaultStoreOf(eggs.itemId)).toBeNull();
		expect(lineFor(householdId, 'Bread').status).toBe('received');
		expect(lineFor(householdId, 'Butter')).toMatchObject({ status: 'to_order', storeId: aldi });
	});

	it('receives only the ordered lines the confirmation counted (MEA-68)', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		add(householdId, { itemName: 'Bread', store: walmart });
		const milk = lineFor(householdId, 'Milk').id;
		const bread = lineFor(householdId, 'Bread').id;
		markAllOrdered(householdId, walmart, [milk, bread], NOON);
		// Meanwhile, on another phone: Eggs is ordered on its own, and Bread didn't come.
		add(householdId, { itemName: 'Eggs', store: walmart });
		markOrdered(householdId, lineFor(householdId, 'Eggs').id, undefined, NOON);
		markDidntCome(householdId, bread);

		expect(markAllReceived(householdId, walmart, [milk, bread], NOON)).toBe(1);
		expect(lineFor(householdId, 'Milk').status).toBe('received');
		expect(lineFor(householdId, 'Bread').status).toBe('to_order');
		expect(lineFor(householdId, 'Eggs').status).toBe('ordered');
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

	it('leaves the rest of a Got fewer without floating point noise (MEA-92)', () => {
		add(householdId, { itemName: 'Beef', quantity: 1.1, unit: 'lb', store: walmart });
		const id = onlyLine(householdId).id;
		markGotFewer(householdId, id, 1, undefined, NOON);
		expect(lines(householdId).find((l) => l.status === 'to_order')).toMatchObject({
			id,
			quantity: 0.1
		});
		expect(refusal(() => markGotFewer(householdId, id, 0.1, undefined, NOON))).toBe(
			'Enter an amount less than 0.1'
		);
	});

	it('shows the amount in a Got fewer refusal as the list does (MEA-92)', () => {
		add(householdId, { itemName: 'Beef', quantity: 1, unit: 'lb', store: walmart });
		const id = onlyLine(householdId).id;
		// Floating point noise, as Got fewer left it before MEA-92.
		db().update(groceryNeeds).set({ quantity: 0.3 - 0.1 }).where(eq(groceryNeeds.id, id)).run();
		expect(refusal(() => markGotFewer(householdId, id, 0.2, undefined, NOON))).toBe(
			'Enter an amount less than 0.2'
		);
	});

	it('receives the whole line when the rest of a Got fewer rounds to nothing (MEA-92)', () => {
		add(householdId, { itemName: 'Beef', quantity: 1, unit: 'lb', store: walmart });
		const line = onlyLine(householdId);
		// What Got fewer left of 1.1 lb after 1 lb arrived, before MEA-92.
		db().update(groceryNeeds).set({ quantity: 1.1 - 1 }).where(eq(groceryNeeds.id, line.id)).run();
		markGotFewer(householdId, line.id, 0.1, undefined, NOON);
		expect(onlyLine(householdId)).toMatchObject({
			id: line.id,
			status: 'received',
			storeId: walmart,
			receivedAt: NOON
		});
		expect(defaultStoreOf(line.itemId)).toBe(walmart);
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

	it('is not found for a deleted line once a newer one is added, and leaves that one as it was (6.11)', () => {
		add(householdId, { itemName: 'Milk', store: walmart });
		const milk = onlyLine(householdId).id;
		deleteLine(householdId, milk);
		add(householdId, { itemName: 'Eggs', store: walmart });
		expectHttpError(() => markReceived(householdId, milk, undefined, NOON), 404);
		expect(onlyLine(householdId)).toMatchObject({ itemName: 'Eggs', status: 'to_order' });
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
		expectHttpError(() => markAllOrdered(other.householdId, walmart, [id], NOON), 404);
		const theirs = makeStore(other.householdId, 'Walmart');
		expect(markAllOrdered(other.householdId, theirs, [id], NOON)).toBe(0);
		expect(onlyLine(householdId).status).toBe('to_order');
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
