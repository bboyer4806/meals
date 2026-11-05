import { beforeEach, describe, expect, it } from 'vitest';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import {
	createItem,
	findItemByName,
	getItem,
	listCatalog,
	listPickerItems,
	setItemArchived,
	setItemPhoto,
	updateItem
} from './items.ts';
import { addNeed, listActiveLines, listHistory, markReceived } from './needs.ts';

const KEY = '0123456789abcdef0123456789abcdef';
const NEXT = 'fedcba9876543210fedcba9876543210';
// Sat 2026-10-03 12:00 in Chicago.
const NOON = Date.UTC(2026, 9, 3, 17, 0);

let householdId: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
});

/** Puts an item on the list at a store, adding the item if it's new. */
function add(itemName: string, store: number) {
	addNeed(householdId, { itemName, quantity: 1, unit: null, store, resolution: 'none' }, NOON);
}

describe('setItemPhoto', () => {
	it('sets, replaces and clears the image, giving back the one it replaced', () => {
		const milk = createItem(householdId, 'Milk', 0).id;
		expect(getItem(householdId, milk).photoKey).toBeNull();

		expect(setItemPhoto(householdId, milk, KEY)).toBeNull();
		expect(getItem(householdId, milk).photoKey).toBe(KEY);

		expect(setItemPhoto(householdId, milk, NEXT)).toBe(KEY);
		expect(getItem(householdId, milk).photoKey).toBe(NEXT);

		// Nothing to delete when it doesn't change.
		expect(setItemPhoto(householdId, milk, NEXT)).toBeNull();

		expect(setItemPhoto(householdId, milk, null)).toBe(NEXT);
		expect(getItem(householdId, milk).photoKey).toBeNull();
		expect(setItemPhoto(householdId, milk, null)).toBeNull();
	});

	it("can't change another household's item", () => {
		const other = makeHousehold().householdId;
		const theirs = createItem(other, 'Milk', 0).id;
		setItemPhoto(other, theirs, KEY);

		expectHttpError(() => setItemPhoto(householdId, theirs, NEXT), 404);
		expectHttpError(() => setItemPhoto(householdId, theirs, null), 404);
		expect(getItem(other, theirs).photoKey).toBe(KEY);
	});

	it('keeps the image while the item is archived and once it is restored', () => {
		const milk = createItem(householdId, 'Milk', 0).id;
		setItemPhoto(householdId, milk, KEY);

		setItemArchived(householdId, milk, true, NOON);
		expect(listCatalog(householdId, true, '')).toMatchObject([{ name: 'Milk', photoKey: KEY }]);

		setItemArchived(householdId, milk, false, NOON);
		expect(listCatalog(householdId, false, '')).toMatchObject([{ name: 'Milk', photoKey: KEY }]);
	});

	it('keeps the image when the item is renamed or its notes change', () => {
		const milk = createItem(householdId, 'Milk', 0).id;
		setItemPhoto(householdId, milk, KEY);
		expect(updateItem(householdId, milk, { name: 'Whole milk', notes: '1 gal' })).toEqual({
			kind: 'saved'
		});
		expect(findItemByName(householdId, 'whole milk')).toMatchObject({ photoKey: KEY });
	});
});

describe('item images in Groceries', () => {
	it('come with Items, the suggestions and the list, only for items that have one', () => {
		const aldi = makeStore(householdId, 'Aldi');
		add('Milk', aldi);
		add('Eggs', aldi);
		const milk = findItemByName(householdId, 'Milk')!.id;
		setItemPhoto(householdId, milk, KEY);

		expect(listCatalog(householdId, false, '')).toMatchObject([
			{ name: 'Eggs', photoKey: null },
			{ name: 'Milk', photoKey: KEY }
		]);
		const suggested = listPickerItems(householdId).map(({ name, photoKey }) => ({ name, photoKey }));
		expect(suggested).toEqual(
			expect.arrayContaining([
				{ name: 'Eggs', photoKey: null },
				{ name: 'Milk', photoKey: KEY }
			])
		);
		const lines = listActiveLines(householdId, 'America/Chicago', NOON);
		expect(lines.map(({ itemName, itemPhotoKey }) => ({ itemName, itemPhotoKey }))).toEqual(
			expect.arrayContaining([
				{ itemName: 'Eggs', itemPhotoKey: null },
				{ itemName: 'Milk', itemPhotoKey: KEY }
			])
		);
	});

	it('come with History', () => {
		add('Milk', makeStore(householdId, 'Aldi'));
		const [line] = listActiveLines(householdId, 'America/Chicago', NOON);
		markReceived(householdId, line!.id, undefined, NOON);
		setItemPhoto(householdId, line!.itemId, KEY);

		expect(listHistory(householdId, '', 10)).toMatchObject([
			{ itemName: 'Milk', itemPhotoKey: KEY }
		]);
	});

	it("never show another household's image", () => {
		const other = makeHousehold().householdId;
		setItemPhoto(other, createItem(other, 'Milk', 0).id, KEY);
		createItem(householdId, 'Milk', 0);

		expect(listCatalog(householdId, false, '')).toMatchObject([{ name: 'Milk', photoKey: null }]);
		expect(listPickerItems(householdId)).toMatchObject([{ name: 'Milk', photoKey: null }]);
	});
});
