import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDay } from '../data/dinners.ts';
import { findDishByName, getDish } from '../data/dishes.ts';
import { getHousehold } from '../data/households.ts';
import { createItem, getItem, setItemArchived } from '../data/items.ts';
import { addNeed, getLine, listActiveLines, markReceived } from '../data/needs.ts';
import {
	addRequest,
	addRestaurantRequest,
	listCompletedRequests,
	listRequests
} from '../data/requests.ts';
import { getStore, listStores } from '../data/stores.ts';
import { transaction } from '../db/index.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDinner,
	makeDish,
	makeHousehold,
	makeStore,
	recipe
} from '../testing.ts';
import { changeSchema, planChange } from './operations.ts';

beforeEach(freshDb);

function plan(input: unknown) {
	return planChange(changeSchema.parse(input));
}

/** Looks the change up and makes it, as approving a proposal does. */
function make(input: unknown, now = 1000) {
	const planned = plan(input);
	transaction(() => planned.apply(now));
	return planned;
}

/** Why the data layer refused to make the change. */
function refusal(input: unknown): string {
	try {
		make(input);
	} catch (e) {
		if (isHttpError(e)) return e.body.message;
		throw e;
	}
	throw new Error('The change was made');
}

function problems(input: unknown): string[] {
	return changeSchema.safeParse(input).error?.issues.map((issue) => issue.message) ?? [];
}

const PANCAKES = {
	name: 'Pancakes',
	servings: 4,
	prepMinutes: 10,
	cookMinutes: 15,
	tags: ['Breakfast', 'breakfast', 'Sweet'],
	ingredients: [
		{ section: null, amount: '1 1/2', unit: 'cups', item: 'Flour', prepNote: 'sifted' },
		{ section: 'Topping', amount: null, unit: null, item: 'Maple syrup', prepNote: null }
	],
	steps: 'Mix\nCook',
	notes: null,
	source: null,
	calories: 250,
	proteinG: null,
	carbsG: null,
	fatG: null
};

describe('households', () => {
	it('changes the settings with the settings form’s rules', () => {
		const { householdId } = makeHousehold();
		const before = getHousehold(householdId).name;
		const change = {
			operation: 'update_household',
			householdId,
			name: '  The   Smiths ',
			defaultServings: 3,
			timeZone: 'America/New_York'
		};
		expect(make(change)).toMatchObject({
			title: "Change the household's settings",
			householdName: before,
			record: `Household ${householdId}`,
			current: [
				{ name: 'Name', value: before },
				{ name: 'Usual servings', value: '4' },
				{ name: 'Time zone', value: 'America/Chicago' }
			],
			proposed: [
				{ name: 'Name', value: 'The Smiths' },
				{ name: 'Usual servings', value: '3' },
				{ name: 'Time zone', value: 'America/New_York' }
			]
		});
		expect(getHousehold(householdId)).toMatchObject({
			name: 'The Smiths',
			defaultServings: 3,
			timeZone: 'America/New_York'
		});
		expect(problems({ ...change, timeZone: 'Mars/Base' })).toEqual(['Pick a time zone']);
		expect(problems({ ...change, defaultServings: 51 })).toEqual(['Enter 50 servings or fewer']);
	});

	it("says so for a household that isn't there", () => {
		const change = { operation: 'create_store', householdId: 999, name: 'Aldi' };
		expect(refusal(change)).toBe("Household 999 wasn't found");
	});
});

describe('stores and items', () => {
	it('adds, renames, archives and restores stores, with names unique as on Household', () => {
		const { householdId } = makeHousehold();
		make({ operation: 'create_store', householdId, name: 'Costco' });
		const [costco] = listStores(householdId);
		expect(refusal({ operation: 'create_store', householdId, name: 'costco' })).toBe(
			'A store is already called costco.'
		);
		const renamed = make({ operation: 'rename_store', householdId, storeId: costco!.id, name: 'Aldi' });
		expect(renamed.current).toEqual([
			{ name: 'Name', value: 'Costco' },
			{ name: 'Status', value: 'Active' }
		]);
		make({ operation: 'set_store_archived', householdId, storeId: costco!.id, archived: true });
		expect(getStore(householdId, costco!.id)).toMatchObject({ name: 'Aldi', archivedAt: 1000 });
		expect(refusal({ operation: 'create_store', householdId, name: 'Aldi' })).toBe(
			'An archived store is already called Aldi. Restore it instead.'
		);
		make({ operation: 'set_store_archived', householdId, storeId: costco!.id, archived: false });
		expect(getStore(householdId, costco!.id).archivedAt).toBeNull();
	});

	it('changes and archives items, with names unique as on Items', () => {
		const { householdId } = makeHousehold();
		const milk = createItem(householdId, 'Milk', 0);
		createItem(householdId, 'Eggs', 0);
		make({ operation: 'update_item', householdId, itemId: milk.id, name: 'Whole milk', notes: ' Organic ' });
		expect(getItem(householdId, milk.id)).toMatchObject({ name: 'Whole milk', notes: 'Organic' });
		const taken = { operation: 'update_item', householdId, itemId: milk.id, name: 'eggs', notes: null };
		expect(refusal(taken)).toBe('An item is already called eggs.');
		make({ operation: 'set_item_archived', householdId, itemId: milk.id, archived: true });
		expect(getItem(householdId, milk.id).archivedAt).toBe(1000);
	});

	it("never reaches another household's records", () => {
		const one = makeHousehold();
		const two = makeHousehold();
		const aldi = makeStore(two.householdId, 'Aldi');
		const eggs = createItem(two.householdId, 'Eggs', 0);
		const rename = { operation: 'rename_store', householdId: one.householdId, storeId: aldi, name: 'X' };
		expect(refusal(rename)).toBe(`Store ${aldi} wasn't found`);
		const archive = { operation: 'set_item_archived', householdId: one.householdId, itemId: eggs.id, archived: true };
		expect(refusal(archive)).toBe(`Item ${eggs.id} wasn't found`);
		expect(getItem(two.householdId, eggs.id).archivedAt).toBeNull();
	});
});

describe('grocery lines', () => {
	it('adds, changes and deletes lines as the grocery list does', () => {
		const { householdId } = makeHousehold();
		const walmart = makeStore(householdId, 'Walmart');
		const add = {
			operation: 'add_grocery_line',
			householdId,
			itemName: 'Milk',
			quantity: 2,
			unit: 'gal',
			store: walmart
		};
		expect(make(add).proposed).toEqual([
			{ name: 'Item', value: 'Milk' },
			{ name: 'Amount', value: '2 gal' },
			{ name: 'Store', value: 'Walmart' }
		]);
		const [line] = listActiveLines(householdId, 'America/Chicago', 1000);
		expect(line).toMatchObject({ itemName: 'Milk', quantity: 2, unit: 'gal', storeName: 'Walmart' });
		// The add bar's duplicate warning.
		expect(refusal(add)).toBe('Milk is already on the grocery list (2 gal at Walmart, To order).');

		const update = {
			operation: 'update_grocery_line',
			householdId,
			lineId: line!.id,
			quantity: 3,
			unit: null,
			storeId: null,
			note: 'Organic'
		};
		expect(make(update).current).toEqual([
			{ name: 'Item', value: 'Milk' },
			{ name: 'Amount', value: '2 gal' },
			{ name: 'Store', value: 'Walmart' },
			{ name: 'Status', value: 'To order' },
			{ name: 'Note', value: 'None' }
		]);
		expect(getLine(householdId, line!.id)).toMatchObject({
			quantity: 3,
			unit: null,
			storeId: null,
			note: 'Organic'
		});
		make({ operation: 'delete_grocery_line', householdId, lineId: line!.id });
		expect(listActiveLines(householdId, 'America/Chicago', 1000)).toEqual([]);
	});

	it('keeps the grocery list’s rules: quantities, archived items and history', () => {
		const { householdId } = makeHousehold();
		const add = { operation: 'add_grocery_line', householdId, itemName: 'Saffron', quantity: 0, unit: null, store: 'none' };
		expect(problems(add)).toEqual(['Enter a quantity above 0']);
		const saffron = createItem(householdId, 'Saffron', 0);
		setItemArchived(householdId, saffron.id, true, 0);
		expect(refusal({ ...add, quantity: 1 })).toBe(
			'Saffron is archived. Restore it before adding it to the list.'
		);

		const store = makeStore(householdId, 'Aldi');
		addNeed(householdId, { itemName: 'Eggs', quantity: 1, unit: null, store, resolution: 'none' }, 0);
		const [line] = listActiveLines(householdId, 'America/Chicago', 0);
		markReceived(householdId, line!.id, undefined, 0);
		expect(refusal({ operation: 'delete_grocery_line', householdId, lineId: line!.id })).toBe(
			'Received lines are kept as history'
		);
	});
});

describe('recipes', () => {
	it('adds a recipe checked and stored as the recipe editor does', () => {
		const { householdId } = makeHousehold();
		const planned = make({ operation: 'create_recipe', householdId, recipe: PANCAKES });
		expect(planned.proposed).toContainEqual({
			name: 'Ingredients',
			value: '1 1/2 cup Flour, sifted\nTopping:\nMaple syrup'
		});
		const id = findDishByName(householdId, 'Pancakes')!.id;
		expect(getDish(householdId, id)).toMatchObject({
			servings: 4,
			prepMinutes: 10,
			tags: ['Breakfast', 'Sweet'],
			steps: 'Mix\nCook',
			calories: 250,
			ingredients: [
				{ amount: 1.5, unit: 'cup', itemName: 'Flour', prepNote: 'sifted', section: null },
				{ amount: null, unit: null, itemName: 'Maple syrup', section: 'Topping' }
			]
		});
	});

	it("refuses a recipe the editor wouldn't save, with the editor's messages", () => {
		const recipeWith = (fields: object) => ({
			operation: 'create_recipe',
			householdId: 1,
			recipe: { ...PANCAKES, ...fields }
		});
		expect(
			problems(
				recipeWith({
					servings: 0,
					ingredients: [{ section: null, amount: '2-3', unit: null, item: 'Eggs', prepNote: null }]
				})
			)
		).toEqual([
			'Enter at least 1 serving',
			'Ingredient 1: enter one amount, and put a range like 2 to 3 in the prep note'
		]);
		expect(problems(recipeWith({ prepMinutes: 1.5 }))).toEqual(['Enter the prep time in whole minutes']);
		// Every field is needed, so a change never empties one by leaving it out.
		const { notes: _, ...withoutNotes } = PANCAKES;
		expect(problems({ operation: 'create_recipe', householdId: 1, recipe: withoutNotes })).toHaveLength(1);
	});

	it('saves over a recipe, keeping its photo, and refuses a name another recipe has', () => {
		const { householdId } = makeHousehold();
		const soup = makeDish(householdId, recipe('Soup', { ingredients: [ingredient('Leeks', 2)] }), 0, 'soup-photo');
		makeDish(householdId, recipe('Stew'));
		const planned = make({ operation: 'update_recipe', householdId, recipeId: soup, recipe: PANCAKES });
		expect(planned.current).toContainEqual({ name: 'Ingredients', value: '2 Leeks' });
		expect(getDish(householdId, soup)).toMatchObject({ name: 'Pancakes', photoKey: 'soup-photo' });
		const renamed = { operation: 'update_recipe', householdId, recipeId: soup, recipe: { ...PANCAKES, name: 'stew' } };
		expect(refusal(renamed)).toBe('A recipe is already called stew.');
	});

	it('refuses a recipe that would start using archived items, and archives and restores', () => {
		const { householdId } = makeHousehold();
		const flour = createItem(householdId, 'Flour', 0);
		setItemArchived(householdId, flour.id, true, 0);
		expect(refusal({ operation: 'create_recipe', householdId, recipe: PANCAKES })).toBe(
			'Flour is archived. Restore it before using it in a recipe.'
		);
		const soup = makeDish(householdId, recipe('Soup'));
		make({ operation: 'set_recipe_archived', householdId, recipeId: soup, archived: true });
		expect(getDish(householdId, soup).archivedAt).toBe(1000);
	});
});

describe('dinners', () => {
	const DATE = '2026-11-17';
	const dinner = (fields: object) => ({
		operation: 'save_dinner',
		date: DATE,
		dinnerId: null,
		type: 'cook',
		servings: 4,
		note: null,
		restaurantName: null,
		label: null,
		dishes: [],
		...fields
	});

	it('plans a date with its dishes, adding new names to Recipes as the menu does', () => {
		const { householdId } = makeHousehold();
		makeDish(householdId, recipe('Lasagna'));
		const planned = make(
			dinner({
				householdId,
				note: ' Early ',
				dishes: [
					{ name: 'lasagna', role: 'main' },
					{ name: 'Garlic bread', role: 'side' }
				]
			})
		);
		expect(planned).toMatchObject({ title: 'Plan a dinner', record: 'Tue, Nov 17, 2026, not planned yet' });
		expect(getDay(householdId, DATE)).toMatchObject([
			{
				type: 'cook',
				note: 'Early',
				dishes: [
					{ name: 'Lasagna', role: 'main' },
					{ name: 'Garlic bread', role: 'side' }
				]
			}
		]);
		// A dish typed by name on the menu has no recipe yet (2.3).
		expect(getDish(householdId, findDishByName(householdId, 'Garlic bread')!.id).ingredients).toEqual([]);
	});

	it("gives a dinner exactly the dishes listed, and takes them off a dinner that can't have them", () => {
		const { householdId } = makeHousehold();
		const tacos = makeDish(householdId, recipe('Tacos'));
		const rice = makeDish(householdId, recipe('Rice'));
		makeDish(householdId, recipe('Beans'));
		const dinnerId = makeDinner(householdId, DATE, { dishes: [[tacos, 'main'], [rice, 'side']] });
		const planned = make(
			dinner({
				householdId,
				dinnerId,
				dishes: [
					{ name: 'Tacos', role: 'main' },
					{ name: 'Beans', role: 'side' },
					{ name: 'Rice', role: 'other' }
				]
			})
		);
		expect(planned.current).toContainEqual({ name: 'Dishes', value: 'Tacos (Main), Rice (Side)' });
		expect(getDay(householdId, DATE)[0]!.dishes.map((dish) => [dish.name, dish.role])).toEqual([
			['Tacos', 'main'],
			['Beans', 'side'],
			['Rice', 'other']
		]);

		make(dinner({ householdId, dinnerId, type: 'eat_out', restaurantName: ' Olive  Garden ' }));
		expect(getDay(householdId, DATE)).toMatchObject([
			{ type: 'eat_out', restaurantName: 'Olive Garden', dishes: [] }
		]);
		expect(
			refusal(dinner({ householdId, dinnerId, type: 'leftovers', dishes: [{ name: 'Tacos', role: 'main' }] }))
		).toBe('Switch to Cooking at home or Bringing a dish to add dishes');
	});

	it("won't plan over a date's dinner without naming it, and clears one", () => {
		const { householdId } = makeHousehold();
		const dinnerId = makeDinner(householdId, DATE);
		expect(refusal(dinner({ householdId }))).toBe(`${DATE} already has a dinner. Send its dinnerId to change it.`);
		expect(refusal(dinner({ householdId, dinnerId: dinnerId + 1 }))).toBe(`Dinner ${dinnerId + 1} isn't on ${DATE}`);
		expect(problems(dinner({ householdId, date: '2026-13-01' }))).toEqual(['Enter a date as YYYY-MM-DD']);
		const cleared = make({ operation: 'clear_dinner', householdId, date: DATE, dinnerId });
		expect(cleared.record).toBe(`Dinner ${dinnerId} on Tue, Nov 17, 2026`);
		expect(getDay(householdId, DATE)).toEqual([]);
	});
});

describe('requests', () => {
	it('completes and removes active requests', () => {
		const { householdId, userId } = makeHousehold();
		addRequest(householdId, userId, { name: 'Chili', note: 'Spicy' }, 0);
		addRestaurantRequest(householdId, userId, { name: 'Olive Garden', note: null }, 0);
		const [chili, olive] = listRequests(householdId);
		const completed = make({ operation: 'complete_request', householdId, requestId: chili!.id });
		expect(completed.current).toEqual([
			{ name: 'Dish', value: 'Chili' },
			{ name: 'Note', value: 'Spicy' },
			{ name: 'Asked by', value: 'Person' }
		]);
		make({ operation: 'remove_request', householdId, requestId: olive!.id });
		expect(listRequests(householdId)).toEqual([]);
		expect(listCompletedRequests(householdId).map((request) => request.name)).toEqual(['Chili']);
		expect(refusal({ operation: 'remove_request', householdId, requestId: chili!.id })).toBe(
			`Request ${chili!.id} isn't an active request`
		);
	});
});
