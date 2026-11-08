import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { foldCase, normalizeName } from '../../text.ts';
import { db } from '../db/index.ts';
import { items, partyAllocations } from '../db/schema.ts';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import { setItemArchived } from './items.ts';
import {
	addNeed,
	deleteLine,
	listActiveLines,
	listHistory,
	markAllOrdered,
	markAllReceived,
	markGotFewer,
	markOrdered,
	markReceived,
	undoReceived,
	updateLine,
	type GroceryLine
} from './needs.ts';
import {
	addPartyItem,
	addToGroceries,
	createPartyList,
	deletePartyList,
	getPartyList,
	listPartyLists,
	markBought,
	removePartyItem,
	renamePartyList,
	setPartyItemQuantity,
	unmarkBought
} from './party-lists.ts';

const TZ = 'America/Chicago';
// Sat 2026-10-03 12:00 in Chicago.
const NOON = Date.UTC(2026, 9, 3, 17, 0);

let householdId: number;
let walmart: number;
let aldi: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	walmart = makeStore(householdId, 'Walmart');
	aldi = makeStore(householdId, 'Aldi');
});

function newList(name: string): number {
	return createPartyList(householdId, name, NOON);
}

/** The thing on a party list whose item has this name, ignoring case and spacing. */
function thing(listId: number, itemName: string) {
	const key = foldCase(normalizeName(itemName));
	const found = getPartyList(householdId, listId).items.find((t) => foldCase(t.itemName) === key);
	if (!found) throw new Error(`${itemName} isn't on the list`);
	return found;
}

/** Adds something to a party list, and returns it as the list shows it. */
function addThing(listId: number, itemName: string, quantity: number, unit: string | null = null) {
	addPartyItem(householdId, listId, { itemName, quantity, unit }, NOON);
	return thing(listId, itemName);
}

function addToList(listId: number, ...things: { id: number }[]) {
	return addToGroceries(householdId, listId, things.map((t) => t.id), NOON);
}

/** Adds a line to the grocery list from the add bar, at Walmart unless another store is given. */
function addRegular(itemName: string, quantity: number, unit: string | null, store: number = walmart) {
	expect(addNeed(householdId, { itemName, quantity, unit, store, resolution: 'none' }, NOON)).toEqual({
		kind: 'added'
	});
}

function itemLines(itemName: string): GroceryLine[] {
	return listActiveLines(householdId, TZ, NOON)
		.filter((line) => line.itemName === itemName)
		.sort((a, b) => a.id - b.id);
}

/** The item's lines on the grocery list as [status, quantity, unit], oldest first. */
function linesOf(itemName: string) {
	return itemLines(itemName).map((line) => [line.status, line.quantity, line.unit]);
}

function lineOf(itemName: string, status: GroceryLine['status']): GroceryLine {
	const line = itemLines(itemName).find((l) => l.status === status);
	if (!line) throw new Error(`${itemName} has no ${status} line`);
	return line;
}

function expectRefused(run: () => unknown, message: string) {
	try {
		run();
	} catch (e) {
		expect(isHttpError(e, 400) ? e.body.message : String(e)).toBe(message);
		return;
	}
	expect.fail(`expected "${message}", but nothing was refused`);
}

describe('party lists', () => {
	it('lists them by name with how many of their things are bought', () => {
		const picnic = newList('Picnic');
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 2, 'bags');
		addThing(birthday, 'Soda', 6);
		markBought(householdId, birthday, chips.id, undefined, NOON);
		expect(listPartyLists(householdId)).toEqual([
			{ id: birthday, name: 'Birthday', itemCount: 2, doneCount: 1 },
			{ id: picnic, name: 'Picnic', itemCount: 0, doneCount: 0 }
		]);
	});

	it('renames them, keeping names unique ignoring case', () => {
		const birthday = newList('Birthday');
		newList('Fête');
		expectRefused(() => newList('BIRTHDAY'), 'You already have a party list called BIRTHDAY.');
		expectRefused(() => newList('FÊTE'), 'You already have a party list called FÊTE.');
		expectRefused(
			() => renamePartyList(householdId, birthday, 'fête'),
			'You already have a party list called fête.'
		);
		renamePartyList(householdId, birthday, 'BIRTHDAY');
		expect(getPartyList(householdId, birthday).name).toBe('BIRTHDAY');
	});

	it("never shows or changes another household's lists", () => {
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 2, 'bags');
		const other = makeHousehold(TZ).householdId;
		expect(listPartyLists(other)).toEqual([]);
		expectHttpError(() => getPartyList(other, birthday), 404);
		expectHttpError(() => renamePartyList(other, birthday, 'Mine'), 404);
		expectHttpError(() => deletePartyList(other, birthday), 404);
		const input = { itemName: 'Soda', quantity: 1, unit: null };
		expectHttpError(() => addPartyItem(other, birthday, input, NOON), 404);
		expectHttpError(() => addToGroceries(other, birthday, [chips.id], NOON), 404);
		expectHttpError(() => markBought(other, birthday, chips.id, walmart, NOON), 404);
		expectHttpError(() => unmarkBought(other, birthday, chips.id, NOON), 404);
		expectHttpError(() => setPartyItemQuantity(other, birthday, chips.id, 5, NOON), 404);
		expectHttpError(() => removePartyItem(other, birthday, chips.id), 404);
		// Nor through a list of their own.
		const theirs = createPartyList(other, 'Theirs', NOON);
		expectHttpError(() => markBought(other, theirs, chips.id, undefined, NOON), 404);
		expect(addToGroceries(other, theirs, [chips.id], NOON)).toBe(0);
		expect(thing(birthday, 'Chips')).toMatchObject({ quantity: 2, bought: 0, onGroceries: 0 });
	});

	it('rejects an allocation that points at another household in the database itself', () => {
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 2, 'bags');
		addToList(birthday, chips);
		const other = makeHousehold(TZ).householdId;
		expect(() =>
			db()
				.insert(partyAllocations)
				.values({
					householdId: other,
					partyItemId: chips.id,
					needId: lineOf('Chips', 'to_order').id,
					quantity: 1
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});
});

describe('things on a list', () => {
	it('come from the household’s items, adding new names to them, once per list', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		expect(addThing(birthday, '  Paper   plates ', 20)).toMatchObject({
			itemName: 'Paper plates',
			quantity: 20,
			unit: null,
			bought: 0,
			onGroceries: 0,
			toAdd: 20,
			done: false
		});
		expectRefused(() => addThing(birthday, 'paper PLATES', 10), 'Paper plates is already on this list.');
		addThing(picnic, 'paper plates', 10, 'packs');
		expect(db().select().from(items).where(eq(items.householdId, householdId)).all()).toHaveLength(1);
	});

	it('refuse an archived item', () => {
		const birthday = newList('Birthday');
		addRegular('Candles', 1, null);
		setItemArchived(householdId, lineOf('Candles', 'to_order').itemId, true, NOON);
		expectRefused(() => addThing(birthday, 'candles', 12), 'Candles is archived. Restore it on Items first.');
	});
});

describe('adding to Groceries', () => {
	it('adds a line at the usual store once, and keeps the thing on its list', () => {
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		db().update(items).set({ defaultStoreId: aldi }).where(eq(items.id, chips.itemId)).run();
		expect(addToList(birthday, chips)).toBe(1);
		expect(itemLines('Chips')).toMatchObject([
			{ status: 'to_order', quantity: 3, unit: 'bags', storeId: aldi }
		]);
		expect(thing(birthday, 'Chips')).toMatchObject({ quantity: 3, onGroceries: 3, toAdd: 0 });

		expect(addToList(birthday, chips)).toBe(0);
		expect(linesOf('Chips')).toEqual([['to_order', 3, 'bags']]);
	});

	it('adds to a To Order line in the same or a converting unit, keeping its own quantity and unit', () => {
		const birthday = newList('Birthday');
		addRegular('Milk', 1, 'quart');
		addRegular('Soda', 2, 'Bottles');
		const milk = addThing(birthday, 'Milk', 2, 'cups');
		const soda = addThing(birthday, 'Soda', 4, 'bottles');
		expect(addToList(birthday, milk, soda)).toBe(2);
		expect(linesOf('Milk')).toEqual([['to_order', 1.5, 'quart']]);
		expect(linesOf('Soda')).toEqual([['to_order', 6, 'Bottles']]);
		expect(thing(birthday, 'Milk')).toMatchObject({ quantity: 2, unit: 'cups', onGroceries: 2 });
	});

	it("keeps units that don't convert, and ordered lines, apart", () => {
		const birthday = newList('Birthday');
		addRegular('Chips', 1, 'box');
		addRegular('Ice', 2, 'bags');
		markOrdered(householdId, lineOf('Ice', 'to_order').id, undefined, NOON);
		addToList(birthday, addThing(birthday, 'Chips', 3, 'bags'), addThing(birthday, 'Ice', 3, 'bags'));
		expect(linesOf('Chips')).toEqual([
			['to_order', 1, 'box'],
			['to_order', 3, 'bags']
		]);
		expect(linesOf('Ice')).toEqual([
			['ordered', 2, 'bags'],
			['to_order', 3, 'bags']
		]);
	});

	it('adds all that the things counted still need, leaving out what’s there or bought', () => {
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		const soda = addThing(birthday, 'Soda', 2);
		const plates = addThing(birthday, 'Plates', 20);
		const balloons = addThing(birthday, 'Balloons', 12);
		addToList(birthday, chips);
		markBought(householdId, birthday, balloons.id, undefined, NOON);
		// Meanwhile, on another phone, Soda comes off the list.
		removePartyItem(householdId, birthday, soda.id);

		expect(addToList(birthday, chips, soda, plates, balloons)).toBe(1);
		expect(linesOf('Chips')).toEqual([['to_order', 3, 'bags']]);
		expect(linesOf('Plates')).toEqual([['to_order', 20, null]]);
		expect(linesOf('Soda')).toEqual([]);
		expect(linesOf('Balloons')).toEqual([]);
	});
});

describe('buying on Groceries', () => {
	it('buys the things on a line that is received, with the rest of the line', () => {
		const birthday = newList('Birthday');
		addRegular('Chips', 1, 'bags');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		addToList(birthday, chips);
		markReceived(householdId, lineOf('Chips', 'to_order').id, undefined, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 3, onGroceries: 0, done: true });
		expect(linesOf('Chips')).toEqual([['received', 4, 'bags']]);
	});

	it("buys them with a store's Mark all received", () => {
		const birthday = newList('Birthday');
		const soda = addThing(birthday, 'Soda', 6, 'cans');
		db().update(items).set({ defaultStoreId: walmart }).where(eq(items.id, soda.itemId)).run();
		addToList(birthday, soda);
		const line = lineOf('Soda', 'to_order').id;
		markAllOrdered(householdId, walmart, [line], NOON);
		markAllReceived(householdId, walmart, [line], NOON);
		expect(thing(birthday, 'Soda')).toMatchObject({ bought: 6, done: true });
	});

	it('gives party lists what arrived first, in the order they were added to Groceries', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		addRegular('Chips', 1, 'bags');
		addToList(picnic, addThing(picnic, 'Chips', 2, 'bags'));
		addToList(birthday, addThing(birthday, 'Chips', 3, 'bags'));
		const line = lineOf('Chips', 'to_order').id;

		markGotFewer(householdId, line, 4, undefined, NOON);
		expect(thing(picnic, 'Chips')).toMatchObject({ bought: 2, onGroceries: 0, done: true });
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 2, onGroceries: 1, done: false });
		expect(linesOf('Chips')).toEqual([
			['to_order', 2, 'bags'],
			['received', 4, 'bags']
		]);

		markGotFewer(householdId, line, 1, undefined, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 3, onGroceries: 0, done: true });
		// What's left is the household's own bag.
		expect(itemLines('Chips')[0]).toMatchObject({ id: line, status: 'to_order', quantity: 1 });
	});

	it('splits a party quantity in another unit by what arrived', () => {
		const birthday = newList('Birthday');
		addRegular('Milk', 2, 'quarts');
		addToList(birthday, addThing(birthday, 'Milk', 1, 'gallon'));
		expect(linesOf('Milk')).toEqual([['to_order', 6, 'quarts']]);
		markGotFewer(householdId, lineOf('Milk', 'to_order').id, 2, undefined, NOON);
		expect(thing(birthday, 'Milk')).toMatchObject({ bought: 0.5, onGroceries: 0.5 });
	});
});

describe('checking off on a party list', () => {
	it('receives only its part of the line, leaving the rest as it was', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		addRegular('Chips', 1, 'bags');
		const forBirthday = addThing(birthday, 'Chips', 2, 'bags');
		addToList(birthday, forBirthday);
		addToList(picnic, addThing(picnic, 'Chips', 3, 'bags'));
		const line = lineOf('Chips', 'to_order');

		markBought(householdId, birthday, forBirthday.id, undefined, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 2, done: true });
		expect(thing(picnic, 'Chips')).toMatchObject({ bought: 0, onGroceries: 3 });
		expect(itemLines('Chips')).toMatchObject([
			{ id: line.id, status: 'to_order', quantity: 4, storeId: walmart },
			{ status: 'received', quantity: 2, storeId: walmart, receivedAt: NOON }
		]);
	});

	it('leaves the rest of an ordered line ordered, and takes a whole line that is all its own', () => {
		const birthday = newList('Birthday');
		addRegular('Ice', 1, 'bags');
		const ice = addThing(birthday, 'Ice', 2, 'bags');
		const cups = addThing(birthday, 'Cups', 50);
		addToList(birthday, ice, cups);
		markOrdered(householdId, lineOf('Ice', 'to_order').id, undefined, NOON);
		markBought(householdId, birthday, ice.id, undefined, NOON);
		expect(linesOf('Ice')).toEqual([
			['ordered', 1, 'bags'],
			['received', 2, 'bags']
		]);
		expect(lineOf('Ice', 'received').orderedAt).toBe(NOON);

		const cupsLine = lineOf('Cups', 'to_order').id;
		markBought(householdId, birthday, cups.id, aldi, NOON);
		expect(itemLines('Cups')).toMatchObject([{ id: cupsLine, status: 'received', storeId: aldi }]);
	});

	it('needs a store for a line without one, and makes it the default store (6.3)', () => {
		const birthday = newList('Birthday');
		addRegular('Chips', 1, 'bags', aldi);
		const chips = addThing(birthday, 'Chips', 2, 'bags');
		const candles = addThing(birthday, 'Candles', 12);
		addToList(birthday, chips, candles);
		expect(thing(birthday, 'Candles').needsStore).toBe(true);
		expect(thing(birthday, 'Chips').needsStore).toBe(false);

		expectRefused(() => markBought(householdId, birthday, candles.id, undefined, NOON), 'Pick a store first');
		markBought(householdId, birthday, candles.id, walmart, NOON);
		expect(lineOf('Candles', 'received').storeId).toBe(walmart);
		const defaultStore = (itemId: number) =>
			db().select().from(items).where(eq(items.id, itemId)).get()?.defaultStoreId;
		expect(defaultStore(candles.itemId)).toBe(walmart);

		// A picked store doesn't move a line that has its own.
		markBought(householdId, birthday, chips.id, walmart, NOON);
		expect(lineOf('Chips', 'received').storeId).toBe(aldi);
	});

	it('buys a thing that isn’t on Groceries on the list alone', () => {
		const birthday = newList('Birthday');
		const balloons = addThing(birthday, 'Balloons', 12);
		markBought(householdId, birthday, balloons.id, undefined, NOON);
		expect(thing(birthday, 'Balloons')).toMatchObject({ bought: 12, toAdd: 0, done: true });
		expect(linesOf('Balloons')).toEqual([]);
		expectRefused(
			() => markBought(householdId, birthday, balloons.id, undefined, NOON),
			'Balloons is already bought'
		);
	});

	it('receives what’s on Groceries and counts the rest as bought on the list', () => {
		const birthday = newList('Birthday');
		const cups = addThing(birthday, 'Cups', 10);
		addToList(birthday, cups);
		const line = lineOf('Cups', 'to_order');
		updateLine(householdId, line.id, { quantity: 6, unit: null, storeId: walmart, note: null });
		expect(thing(birthday, 'Cups')).toMatchObject({ onGroceries: 6, toAdd: 4 });
		markBought(householdId, birthday, cups.id, undefined, NOON);
		expect(thing(birthday, 'Cups')).toMatchObject({ bought: 10, onGroceries: 0, done: true });
		expect(linesOf('Cups')).toEqual([['received', 6, null]]);
	});
});

describe('unchecking on a party list', () => {
	it('puts back only what Groceries received for it, as it was before', () => {
		const birthday = newList('Birthday');
		addRegular('Chips', 1, 'bags');
		addRegular('Ice', 1, 'bags');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		const ice = addThing(birthday, 'Ice', 2, 'bags');
		addToList(birthday, chips, ice);
		markReceived(householdId, lineOf('Chips', 'to_order').id, undefined, NOON);
		markOrdered(householdId, lineOf('Ice', 'to_order').id, undefined, NOON);
		markReceived(householdId, lineOf('Ice', 'ordered').id, undefined, NOON);

		unmarkBought(householdId, birthday, chips.id, NOON);
		unmarkBought(householdId, birthday, ice.id, NOON);
		expect(linesOf('Chips')).toEqual([
			['received', 1, 'bags'],
			['to_order', 3, 'bags']
		]);
		expect(linesOf('Ice')).toEqual([
			['received', 1, 'bags'],
			['ordered', 2, 'bags']
		]);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 0, onGroceries: 3, done: false });
		expect(listHistory(householdId, 'Chips', 10).map((line) => line.quantity)).toEqual([1]);
	});

	it('puts a whole line back when it was all its own, and forgets what was bought on the list', () => {
		const birthday = newList('Birthday');
		const cups = addThing(birthday, 'Cups', 10);
		addToList(birthday, cups);
		updateLine(householdId, lineOf('Cups', 'to_order').id, { quantity: 6, unit: null, storeId: aldi, note: null });
		markBought(householdId, birthday, cups.id, undefined, NOON);
		const line = lineOf('Cups', 'received').id;

		unmarkBought(householdId, birthday, cups.id, NOON);
		expect(itemLines('Cups')).toMatchObject([{ id: line, status: 'to_order', quantity: 6, storeId: aldi }]);
		expect(thing(birthday, 'Cups')).toMatchObject({ bought: 0, onGroceries: 6, toAdd: 4 });
		expectRefused(() => unmarkBought(householdId, birthday, cups.id, NOON), "Cups isn't bought yet");
	});
});

describe('undoing on Groceries', () => {
	it('puts back the party quantities of the line undone, and no others', () => {
		const birthday = newList('Birthday');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		addToList(birthday, chips);
		const line = lineOf('Chips', 'to_order').id;
		updateLine(householdId, line, { quantity: 3, unit: 'bags', storeId: walmart, note: null });
		markGotFewer(householdId, line, 1, undefined, NOON);
		const first = lineOf('Chips', 'received').id;
		markReceived(householdId, line, undefined, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 3, done: true });

		undoReceived(householdId, line, TZ, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 1, onGroceries: 2, done: false });
		undoReceived(householdId, first, TZ, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 0, onGroceries: 3 });
		expect(linesOf('Chips')).toEqual([
			['to_order', 2, 'bags'],
			['to_order', 1, 'bags']
		]);
	});
});

describe('changing what a party needs', () => {
	it('changes what’s on Groceries by as much, never undoing what was bought', () => {
		const birthday = newList('Birthday');
		addRegular('Chips', 1, 'bags');
		const chips = addThing(birthday, 'Chips', 3, 'bags');
		addToList(birthday, chips);
		const line = lineOf('Chips', 'to_order').id;

		setPartyItemQuantity(householdId, birthday, chips.id, 5, NOON);
		expect(linesOf('Chips')).toEqual([['to_order', 6, 'bags']]);
		setPartyItemQuantity(householdId, birthday, chips.id, 2, NOON);
		expect(linesOf('Chips')).toEqual([['to_order', 3, 'bags']]);
		expect(thing(birthday, 'Chips')).toMatchObject({ quantity: 2, onGroceries: 2, toAdd: 0 });

		markGotFewer(householdId, line, 1, undefined, NOON);
		setPartyItemQuantity(householdId, birthday, chips.id, 1, NOON);
		expect(thing(birthday, 'Chips')).toMatchObject({ bought: 1, onGroceries: 0, done: true });
		expect(linesOf('Chips')).toEqual([
			['to_order', 1, 'bags'],
			['received', 1, 'bags']
		]);
	});

	it('leaves Groceries as it is for a thing that isn’t on it', () => {
		const birthday = newList('Birthday');
		const plates = addThing(birthday, 'Plates', 20);
		setPartyItemQuantity(householdId, birthday, plates.id, 30, NOON);
		expect(linesOf('Plates')).toEqual([]);
		expect(thing(birthday, 'Plates')).toMatchObject({ quantity: 30, toAdd: 30 });

		markBought(householdId, birthday, plates.id, undefined, NOON);
		setPartyItemQuantity(householdId, birthday, plates.id, 40, NOON);
		expect(linesOf('Plates')).toEqual([]);
		expect(thing(birthday, 'Plates')).toMatchObject({ bought: 30, toAdd: 10, done: false });
	});

	it('adds more to a To Order line, and takes the newest off first', () => {
		const birthday = newList('Birthday');
		const ice = addThing(birthday, 'Ice', 2, 'bags');
		addToList(birthday, ice);
		markOrdered(householdId, lineOf('Ice', 'to_order').id, walmart, NOON);

		setPartyItemQuantity(householdId, birthday, ice.id, 5, NOON);
		expect(linesOf('Ice')).toEqual([
			['ordered', 2, 'bags'],
			['to_order', 3, 'bags']
		]);
		setPartyItemQuantity(householdId, birthday, ice.id, 3, NOON);
		expect(linesOf('Ice')).toEqual([
			['ordered', 2, 'bags'],
			['to_order', 1, 'bags']
		]);
		setPartyItemQuantity(householdId, birthday, ice.id, 1, NOON);
		expect(linesOf('Ice')).toEqual([['ordered', 1, 'bags']]);
	});
});

describe('removing', () => {
	it('takes a thing’s part off Groceries, keeping what was received and the other parts', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		addRegular('Chips', 1, 'bags');
		const forBirthday = addThing(birthday, 'Chips', 2, 'bags');
		addToList(birthday, forBirthday);
		addToList(picnic, addThing(picnic, 'Chips', 3, 'bags'));
		markGotFewer(householdId, lineOf('Chips', 'to_order').id, 1, undefined, NOON);

		removePartyItem(householdId, birthday, forBirthday.id);
		expect(linesOf('Chips')).toEqual([
			['to_order', 4, 'bags'],
			['received', 1, 'bags']
		]);
		expect(thing(picnic, 'Chips')).toMatchObject({ onGroceries: 3 });
		expect(getPartyList(householdId, birthday).items).toEqual([]);
	});

	it('deletes a line that was all its own', () => {
		const birthday = newList('Birthday');
		const candles = addThing(birthday, 'Candles', 12);
		addToList(birthday, candles);
		removePartyItem(householdId, birthday, candles.id);
		expect(linesOf('Candles')).toEqual([]);
		expectHttpError(() => removePartyItem(householdId, birthday, candles.id), 404);
	});

	it('deletes a list, taking its parts off Groceries and leaving the rest', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		addRegular('Chips', 1, 'bags');
		const soda = addThing(birthday, 'Soda', 6, 'cans');
		const candles = addThing(birthday, 'Candles', 12);
		addToList(birthday, addThing(birthday, 'Chips', 2, 'bags'), soda, candles);
		addToList(picnic, addThing(picnic, 'Chips', 3, 'bags'));
		markBought(householdId, birthday, candles.id, walmart, NOON);

		deletePartyList(householdId, birthday);
		expect(linesOf('Chips')).toEqual([['to_order', 4, 'bags']]);
		expect(linesOf('Soda')).toEqual([]);
		expect(linesOf('Candles')).toEqual([['received', 12, null]]);
		expect(thing(picnic, 'Chips')).toMatchObject({ onGroceries: 3 });
		expect(listPartyLists(householdId).map((list) => list.name)).toEqual(['Picnic']);
		expectHttpError(() => getPartyList(householdId, birthday), 404);
		expect(db().select().from(partyAllocations).all()).toHaveLength(1);
	});
});

describe('changing a line on Groceries', () => {
	it('takes a smaller line from the rest of the list first, then the newest party quantity', () => {
		const birthday = newList('Birthday');
		const picnic = newList('Picnic');
		addRegular('Chips', 1, 'bags');
		addToList(picnic, addThing(picnic, 'Chips', 2, 'bags'));
		addToList(birthday, addThing(birthday, 'Chips', 3, 'bags'));
		updateLine(householdId, lineOf('Chips', 'to_order').id, {
			quantity: 4,
			unit: 'bags',
			storeId: walmart,
			note: null
		});
		expect(thing(picnic, 'Chips')).toMatchObject({ onGroceries: 2, toAdd: 0 });
		expect(thing(birthday, 'Chips')).toMatchObject({ onGroceries: 2, toAdd: 1 });
	});

	it("keeps party quantities in a unit that converts, and lets go of them in one that doesn't", () => {
		const birthday = newList('Birthday');
		addRegular('Milk', 1, 'quart');
		addToList(birthday, addThing(birthday, 'Milk', 2, 'cups'));
		const line = lineOf('Milk', 'to_order').id;
		updateLine(householdId, line, { quantity: 6, unit: 'cups', storeId: walmart, note: null });
		expect(thing(birthday, 'Milk')).toMatchObject({ onGroceries: 2, toAdd: 0 });
		updateLine(householdId, line, { quantity: 2, unit: 'jugs', storeId: walmart, note: null });
		expect(thing(birthday, 'Milk')).toMatchObject({ onGroceries: 0, toAdd: 2 });
		expect(linesOf('Milk')).toEqual([['to_order', 2, 'jugs']]);
	});

	it('lets go of party quantities on a line that’s deleted', () => {
		const birthday = newList('Birthday');
		addToList(birthday, addThing(birthday, 'Candles', 12));
		deleteLine(householdId, lineOf('Candles', 'to_order').id);
		expect(thing(birthday, 'Candles')).toMatchObject({ onGroceries: 0, toAdd: 12 });
	});

	it('keeps party quantities within a line updated from the add bar', () => {
		const birthday = newList('Birthday');
		addToList(birthday, addThing(birthday, 'Chips', 3, 'bags'));
		const update = { itemName: 'Chips', quantity: 2, unit: 'bags', store: 'usual' as const };
		expect(addNeed(householdId, { ...update, resolution: 'update' }, NOON)).toEqual({
			kind: 'updated'
		});
		expect(thing(birthday, 'Chips')).toMatchObject({ onGroceries: 2, toAdd: 1 });
	});
});
