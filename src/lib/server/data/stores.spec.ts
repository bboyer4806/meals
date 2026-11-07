import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, makeHousehold, makeStore } from '../testing.ts';
import { listStores } from './stores.ts';

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
