import { beforeEach, describe, expect, it } from 'vitest';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import {
	createItem,
	createItems,
	findItemByName,
	getItem,
	itemsByName,
	listCatalog,
	listPickerItems,
	setItemArchived,
	setItemPhoto,
	updateItem
} from './items.ts';
import { addNeed, listActiveLines, listHistory, markReceived } from './needs.ts';

const TZ = 'America/Chicago';
// Sat 2026-10-03 12:00 in Chicago.
const NOON = Date.UTC(2026, 9, 3, 17, 0);
const KEY = '0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'fedcba9876543210fedcba9876543210';

let householdId: number;
let milk: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	milk = createItem(householdId, 'Milk', 0).id;
});

describe('setItemPhoto', () => {
	it('sets, replaces and clears the image, giving the key it replaced', () => {
		expect(getItem(householdId, milk).photoKey).toBeNull();

		expect(setItemPhoto(householdId, milk, KEY)).toBeNull();
		expect(getItem(householdId, milk).photoKey).toBe(KEY);

		expect(setItemPhoto(householdId, milk, OTHER_KEY)).toBe(KEY);
		expect(getItem(householdId, milk).photoKey).toBe(OTHER_KEY);

		expect(setItemPhoto(householdId, milk, null)).toBe(OTHER_KEY);
		expect(getItem(householdId, milk).photoKey).toBeNull();
	});

	it("gives no key when the image doesn't change", () => {
		expect(setItemPhoto(householdId, milk, null)).toBeNull();
		setItemPhoto(householdId, milk, KEY);
		expect(setItemPhoto(householdId, milk, KEY)).toBeNull();
		expect(getItem(householdId, milk).photoKey).toBe(KEY);
	});

	it("is not found for another household's item, which keeps its image", () => {
		const other = makeHousehold(TZ).householdId;
		const theirs = createItem(other, 'Milk', 0).id;
		setItemPhoto(other, theirs, KEY);

		expectHttpError(() => setItemPhoto(householdId, theirs, OTHER_KEY), 404);
		expectHttpError(() => setItemPhoto(householdId, theirs, null), 404);
		expect(getItem(other, theirs).photoKey).toBe(KEY);
	});

	it("gives each item an image of its own: another item's key is refused", () => {
		const eggs = createItem(householdId, 'Eggs', 0).id;
		setItemPhoto(householdId, milk, KEY);
		expect(() => setItemPhoto(householdId, eggs, KEY)).toThrow(/UNIQUE constraint failed/);
		expect(getItem(householdId, eggs).photoKey).toBeNull();
	});
});

describe("an item's image", () => {
	beforeEach(() => {
		setItemPhoto(householdId, milk, KEY);
	});

	it('stays through renaming, archiving and restoring', () => {
		expect(updateItem(householdId, milk, { name: 'Whole milk', notes: '1 gal' })).toEqual({
			kind: 'saved'
		});
		setItemArchived(householdId, milk, true, NOON);
		expect(listCatalog(householdId, true, '')).toMatchObject([{ id: milk, photoKey: KEY }]);
		setItemArchived(householdId, milk, false, NOON);
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Whole milk', photoKey: KEY });
	});

	it('comes with the item in Items, the suggestions, the list and History', () => {
		createItem(householdId, 'Eggs', 0);
		const walmart = makeStore(householdId, 'Walmart');
		addNeed(
			householdId,
			{ itemName: 'Milk', quantity: 1, unit: null, store: walmart, resolution: 'none' },
			NOON
		);
		addNeed(
			householdId,
			{ itemName: 'Eggs', quantity: 1, unit: null, store: walmart, resolution: 'none' },
			NOON
		);

		const byName = <T extends { photoKey: string | null }>(list: T[], name: (row: T) => string) =>
			Object.fromEntries(list.map((row) => [name(row), row.photoKey]));
		const images = { Milk: KEY, Eggs: null };
		expect(byName(listCatalog(householdId, false, ''), (item) => item.name)).toEqual(images);
		expect(byName(listPickerItems(householdId), (item) => item.name)).toEqual(images);

		const lines = listActiveLines(householdId, TZ, NOON);
		const lineImages = Object.fromEntries(lines.map((l) => [l.itemName, l.itemPhotoKey]));
		expect(lineImages).toEqual(images);

		for (const line of lines) markReceived(householdId, line.id, walmart, NOON);
		const history = listHistory(householdId, '', 10);
		expect(Object.fromEntries(history.map((l) => [l.itemName, l.itemPhotoKey]))).toEqual(images);
	});
});

describe('the Items page', () => {
	it("sorts by name ignoring case, so Éclairs sorts with the E's (MEA-88)", () => {
		for (const name of ['Zucchini', 'Éclairs', 'apples', 'Eggs']) createItem(householdId, name, 0);
		expect(listCatalog(householdId, false, '').map((item) => item.name)).toEqual([
			'apples',
			'Éclairs',
			'Eggs',
			'Milk',
			'Zucchini'
		]);
	});
});

// Import recipes looks up and adds many items at once (design 7, MEA-89).
describe('many items at once', () => {
	it('adds as many as one statement takes, and more', () => {
		const names = Array.from({ length: 2_500 }, (_, index) => `Item ${index + 1}`);
		const added = createItems(householdId, names, NOON);
		expect(added.map((item) => item.name).sort()).toEqual(names.toSorted());
		const byName = itemsByName(householdId);
		expect(byName.size).toBe(2_501);
		expect(added.map((item) => byName.get(item.name.toLowerCase()))).toEqual(added);
	});

	it('looks them up by name as findItemByName does, archived ones included', () => {
		const [jalapenos, salt] = createItems(householdId, ['Jalapeños', 'Salt'], NOON);
		if (!jalapenos || !salt) throw new Error('Expected two items');
		setItemArchived(householdId, salt.id, true, NOON);
		createItem(makeHousehold(TZ).householdId, 'Pepper', 0);
		const byName = itemsByName(householdId);
		expect([...byName.keys()].sort()).toEqual(['jalapeños', 'milk', 'salt']);
		expect(byName.get('jalapeños')).toEqual(jalapenos);
		expect(byName.get('salt')).toEqual(findItemByName(householdId, 'SALT'));
		expect(byName.get('salt')?.archivedAt).toBe(NOON);
	});
});
