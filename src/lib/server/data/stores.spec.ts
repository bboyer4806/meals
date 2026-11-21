import { beforeEach, describe, expect, it } from 'vitest';
import { expectHttpError, freshDb, makeHousehold, makeStore } from '../testing.ts';
import { getStore, listStores, renameStore, setStoreArchived } from './stores.ts';

const NOW = Date.UTC(2026, 9, 3, 17, 0);

beforeEach(freshDb);

describe('listStores', () => {
	it("sorts by name ignoring case, so Épicerie sorts with the E's (MEA-88)", () => {
		const { householdId } = makeHousehold();
		for (const name of ['Walmart', 'Épicerie', 'aldi', 'Fresh Market']) {
			makeStore(householdId, name);
		}
		expect(listStores(householdId).map((store) => store.name)).toEqual([
			'aldi',
			'Épicerie',
			'Fresh Market',
			'Walmart'
		]);
	});
});

describe("another household's store", () => {
	it("can't be renamed, archived or restored, and stays as it was (4.5)", () => {
		const { householdId } = makeHousehold();
		const other = makeHousehold().householdId;
		const theirs = makeStore(other, 'Walmart');

		expectHttpError(() => renameStore(householdId, theirs, 'Aldi'), 404);
		expectHttpError(() => setStoreArchived(householdId, theirs, true, NOW), 404);
		expect(getStore(other, theirs)).toEqual({ id: theirs, name: 'Walmart', archivedAt: null });

		setStoreArchived(other, theirs, true, NOW);
		expectHttpError(() => setStoreArchived(householdId, theirs, false, NOW), 404);
		expect(getStore(other, theirs).archivedAt).toBe(NOW);
	});
});
