import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { listDishes, setDishArchived } from '../src/lib/server/data/dishes.ts';
import { getHousehold } from '../src/lib/server/data/households.ts';
import { freshDb, makeDish, makeHousehold, recipe } from '../src/lib/server/testing.ts';
import { findHouseholdId, importDishes, parseDishList } from './import-dishes.ts';

const TAG = 'Cooking Around the World';

beforeEach(freshDb);

describe('parseDishList', () => {
	it('reads the "- " lines as written', () => {
		expect(parseDishList('# Title\n\n- Afghanistan: kabuli palaw\n-  Wales:  cawl \n')).toEqual([
			'Afghanistan: kabuli palaw',
			'Wales: cawl'
		]);
	});

	it('reads every entry of the national dishes list', () => {
		const names = parseDishList(readFileSync('scripts/data/national-dishes.md', 'utf8'));
		expect(names).toHaveLength(478);
		expect(names[0]).toBe('Afghanistan: kabuli palaw');
	});
});

describe('findHouseholdId', () => {
	it('finds the household by its exact name', () => {
		const { householdId } = makeHousehold();
		makeHousehold();
		expect(findHouseholdId(getHousehold(householdId).name)).toBe(householdId);
	});

	it('fails when no household has the name', () => {
		makeHousehold();
		expect(() => findHouseholdId('The Boyer household')).toThrow('found 0');
	});
});

describe('importDishes', () => {
	it('adds each dish with the tag and no recipe, in that household only', () => {
		const { householdId } = makeHousehold();
		const other = makeHousehold();
		importDishes(householdId, ['Wales: cawl', 'Peru: ceviche'], TAG, 0);

		const dishes = listDishes(householdId, { search: '', tag: TAG, archived: false });
		expect(dishes.map((dish) => [dish.name, dish.tags, dish.hasRecipe])).toEqual([
			['Peru: ceviche', [TAG], false],
			['Wales: cawl', [TAG], false]
		]);
		expect(listDishes(other.householdId, { search: '', tag: null, archived: false })).toEqual([]);
	});

	it('adds nothing when a name is already a dish, even an archived one', () => {
		const { householdId } = makeHousehold();
		setDishArchived(householdId, makeDish(householdId, recipe('wales: CAWL')), true, 0);

		expect(() => importDishes(householdId, ['Peru: ceviche', 'Wales: cawl'], TAG, 0)).toThrow(
			'already a dish'
		);
		expect(listDishes(householdId, { search: '', tag: null, archived: false })).toEqual([]);
	});

	it('adds nothing when the list repeats a name', () => {
		const { householdId } = makeHousehold();
		expect(() => importDishes(householdId, ['Peru: ceviche', 'peru: ceviche'], TAG, 0)).toThrow(
			'twice'
		);
		expect(listDishes(householdId, { search: '', tag: null, archived: false })).toEqual([]);
	});
});
