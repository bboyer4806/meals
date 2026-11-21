import { desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../menu.ts';
import { db } from '../db/index.ts';
import { groceryNeeds } from '../db/schema.ts';
import { freshDb, makeDinner, makeDish, makeHousehold, makeStore, recipe } from '../testing.ts';
import { setDishArchived } from './dishes.ts';
import { setItemArchived } from './items.ts';
import { addNeed, markGotFewer, markOrdered, markReceived, undoReceived } from './needs.ts';
import {
	countDinnerTypes,
	listForgottenFavorites,
	rankPlannedDishes,
	rankPurchasedItems,
	rankRestaurants
} from './reports.ts';

// The Reports page's reports (design 7, Reports; MEA-14).

const TZ = 'America/Chicago';
const TODAY = '2026-11-21';
// Sat 2026-11-21 12:00 in Chicago.
const NOON = Date.UTC(2026, 10, 21, 18);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let householdId: number;
let otherId: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	({ householdId: otherId } = makeHousehold(TZ));
});

/** The date some days before today. */
const ago = (days: number) => addDays(TODAY, -days);

const counts = (rows: { name: string; count: number }[]) =>
	rows.map(({ name, count }) => [name, count]);

describe('rankPlannedDishes', () => {
	it('counts the dinners each dish was on, of any type, most first and then by name', () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const rice = makeDish(householdId, recipe('Rice'));
		const salad = makeDish(householdId, recipe('Salad'));
		const beans = makeDish(householdId, recipe('Beans'));
		makeDinner(householdId, ago(1), {
			dishes: [
				[tacos, 'main'],
				[rice, 'side']
			]
		});
		// Each of a date's dinners counts, Bringing a dish too.
		makeDinner(householdId, ago(2), { dishes: [[tacos, 'main']] });
		makeDinner(householdId, ago(2), {
			type: 'going',
			dishes: [
				[salad, 'main'],
				[rice, 'side']
			]
		});
		makeDinner(householdId, ago(3), { dishes: [[beans, 'main']] });
		expect(counts(rankPlannedDishes(householdId, ago(90), TODAY))).toEqual([
			['Rice', 2],
			['Tacos', 2],
			['Beans', 1],
			['Salad', 1]
		]);
	});

	it('counts from the first date through today, and not dinners planned for later', () => {
		const soup = makeDish(householdId, recipe('Soup'));
		for (const date of [ago(31), ago(30), TODAY, addDays(TODAY, 1)]) {
			makeDinner(householdId, date, { dishes: [[soup, 'main']] });
		}
		expect(counts(rankPlannedDishes(householdId, ago(30), TODAY))).toEqual([['Soup', 2]]);
		// All time counts every dinner up to today.
		expect(counts(rankPlannedDishes(householdId, null, TODAY))).toEqual([['Soup', 3]]);
	});

	it("counts archived dishes, and only the household's own dinners", () => {
		const chili = makeDish(householdId, recipe('Chili'));
		makeDinner(householdId, ago(5), { dishes: [[chili, 'main']] });
		setDishArchived(householdId, chili, true, NOON);
		const theirs = makeDish(otherId, recipe('Chili'));
		makeDinner(otherId, ago(5), { dishes: [[theirs, 'main']] });
		makeDinner(otherId, ago(6), { dishes: [[theirs, 'main']] });
		expect(rankPlannedDishes(householdId, ago(90), TODAY)).toEqual([
			{ id: chili, name: 'Chili', count: 1 }
		]);
	});

	it('is empty without dishes on dinners in the period', () => {
		makeDinner(householdId, ago(1), { type: 'eat_out', restaurantName: 'Pho King' });
		makeDinner(householdId, ago(2));
		expect(rankPlannedDishes(householdId, ago(90), TODAY)).toEqual([]);
	});
});

describe('rankPurchasedItems', () => {
	let storeId: number;

	beforeEach(() => {
		storeId = makeStore(householdId, 'Walmart');
	});

	/** Puts the item on the list at `added`, and returns the line's id. */
	function addLine(
		itemName: string,
		quantity: number,
		added: number,
		household = householdId,
		store = storeId
	) {
		const input = { itemName, quantity, unit: null, store, resolution: 'none' } as const;
		expect(addNeed(household, input, added).kind).toBe('added');
		const line = db()
			.select({ id: groceryNeeds.id })
			.from(groceryNeeds)
			.where(eq(groceryNeeds.householdId, household))
			.orderBy(desc(groceryNeeds.id))
			.get();
		if (!line) throw new Error('No line');
		return line.id;
	}

	/** Puts one of the item on the list a day before `received`, and checks it off then. */
	function buy(itemName: string, received: number, added = received - DAY) {
		const lineId = addLine(itemName, 1, added);
		markReceived(householdId, lineId, undefined, received);
		return lineId;
	}

	it('counts each received line once, whatever its quantity, most first and then by name', () => {
		buy('Milk', NOON - 3 * DAY);
		buy('Milk', NOON - DAY);
		const eggs = addLine('Eggs', 24, NOON - DAY);
		markReceived(householdId, eggs, undefined, NOON);
		buy('Bread', NOON - 2 * DAY);
		expect(counts(rankPurchasedItems(householdId, null))).toEqual([
			['Milk', 2],
			['Bread', 1],
			['Eggs', 1]
		]);
	});

	it('counts the part a Got fewer received as a line of its own', () => {
		const apples = addLine('Apples', 6, NOON - 3 * DAY);
		markGotFewer(householdId, apples, 4, undefined, NOON - 2 * DAY);
		markReceived(householdId, apples, undefined, NOON);
		expect(counts(rankPurchasedItems(householdId, null))).toEqual([['Apples', 2]]);
	});

	it('counts a line by when it was received, from `since` on, not by when it was added', () => {
		const since = NOON - 10 * DAY;
		buy('Flour', since, since - 30 * DAY);
		buy('Sugar', since - 1, since - 2 * DAY);
		buy('Salt', NOON, since - 2 * DAY);
		expect(counts(rankPurchasedItems(householdId, since))).toEqual([
			['Flour', 1],
			['Salt', 1]
		]);
	});

	it('leaves out lines that are not received, or not anymore', () => {
		const butter = addLine('Butter', 1, NOON - HOUR);
		markReceived(householdId, butter, undefined, NOON);
		undoReceived(householdId, butter, TZ, NOON + HOUR);
		const cheese = addLine('Cheese', 1, NOON - HOUR);
		markOrdered(householdId, cheese, undefined, NOON);
		addLine('Jam', 1, NOON);
		expect(rankPurchasedItems(householdId, null)).toEqual([]);
	});

	it("counts archived items, and only the household's own lines", () => {
		const saffron = buy('Saffron', NOON - DAY);
		const [line] = db()
			.select({ itemId: groceryNeeds.itemId })
			.from(groceryNeeds)
			.where(eq(groceryNeeds.id, saffron))
			.all();
		if (!line) throw new Error('No line');
		setItemArchived(householdId, line.itemId, true, NOON);
		const theirStore = makeStore(otherId, 'Aldi');
		for (const day of [1, 2]) {
			const theirs = addLine('Saffron', 1, NOON - 5 * DAY, otherId, theirStore);
			markReceived(otherId, theirs, undefined, NOON - day * DAY);
		}
		expect(rankPurchasedItems(householdId, null)).toEqual([
			{ id: line.itemId, name: 'Saffron', count: 1 }
		]);
	});
});

describe('rankRestaurants', () => {
	const eatOut = (household: number, date: string, restaurantName: string | null) =>
		makeDinner(household, date, { type: 'eat_out', restaurantName });

	it('counts Eating out dinners by restaurant, ignoring case, as the latest one writes it', () => {
		eatOut(householdId, ago(10), 'olive garden');
		eatOut(householdId, ago(5), 'Olive Garden');
		eatOut(householdId, ago(7), 'OLIVE GARDEN');
		eatOut(householdId, ago(3), 'Thai Garden');
		eatOut(householdId, ago(4), 'Café Rio');
		eatOut(householdId, ago(6), 'CAFÉ RIO');
		expect(counts(rankRestaurants(householdId, ago(90), TODAY))).toEqual([
			['Olive Garden', 3],
			['Café Rio', 2],
			['Thai Garden', 1]
		]);
	});

	it('leaves out Eating out dinners without a restaurant', () => {
		eatOut(householdId, ago(2), null);
		eatOut(householdId, ago(2), 'Taqueria');
		eatOut(householdId, ago(3), null);
		expect(counts(rankRestaurants(householdId, ago(90), TODAY))).toEqual([['Taqueria', 1]]);
	});

	it("counts from the first date through today, and only the household's own dinners", () => {
		for (const date of [ago(31), ago(30), addDays(TODAY, 1)]) eatOut(householdId, date, 'Pho');
		eatOut(otherId, ago(1), 'Pho');
		expect(counts(rankRestaurants(householdId, ago(30), TODAY))).toEqual([['Pho', 1]]);
		expect(counts(rankRestaurants(householdId, null, TODAY))).toEqual([['Pho', 2]]);
	});
});

describe('countDinnerTypes', () => {
	it("counts each of the period's dinners by its type, a date's dinners each on their own", () => {
		makeDinner(householdId, ago(1), { type: 'cook' });
		makeDinner(householdId, ago(1), { type: 'eat_out' });
		makeDinner(householdId, ago(2), { type: 'cook' });
		makeDinner(householdId, ago(30), { type: 'going' });
		makeDinner(householdId, ago(31), { type: 'leftovers' });
		makeDinner(householdId, addDays(TODAY, 1), { type: 'leftovers' });
		makeDinner(otherId, ago(1), { type: 'leftovers' });
		expect(countDinnerTypes(householdId, ago(30), TODAY)).toEqual({
			cook: 2,
			eat_out: 1,
			going: 1,
			leftovers: 0
		});
		expect(countDinnerTypes(householdId, null, TODAY)).toEqual({
			cook: 2,
			eat_out: 1,
			going: 1,
			leftovers: 1
		});
	});
});

describe('listForgottenFavorites', () => {
	function plan(dishId: number, daysAgo: number[], household = householdId) {
		for (const days of daysAgo) makeDinner(household, ago(days), { dishes: [[dishId, 'main']] });
	}

	it('lists active dishes planned 3 times or more, but not from 90 days before today on', () => {
		const roast = makeDish(householdId, recipe('Pot roast'));
		const stew = makeDish(householdId, recipe('Stew'));
		const goulash = makeDish(householdId, recipe('Goulash'));
		const pie = makeDish(householdId, recipe('Pie'));
		const lasagna = makeDish(householdId, recipe('Lasagna'));
		plan(roast, [91, 120, 200, 400]);
		plan(stew, [100, 150, 300]);
		plan(goulash, [95, 160, 310]);
		// Planned twice, so not a favorite.
		plan(pie, [100, 200]);
		// Planned 90 days before today, which Last 90 days counts.
		plan(lasagna, [90, 200, 300]);
		expect(listForgottenFavorites(householdId, TODAY)).toEqual([
			{ id: roast, name: 'Pot roast', count: 4, lastPlanned: ago(91) },
			{ id: goulash, name: 'Goulash', count: 3, lastPlanned: ago(95) },
			{ id: stew, name: 'Stew', count: 3, lastPlanned: ago(100) }
		]);
	});

	it("counts each dinner a dish was on, a date's dinners each on their own", () => {
		const curry = makeDish(householdId, recipe('Curry'));
		plan(curry, [200, 200, 300]);
		expect(counts(listForgottenFavorites(householdId, TODAY))).toEqual([['Curry', 3]]);
	});

	it('leaves out dishes already planned for a later date, which are not forgotten', () => {
		const chili = makeDish(householdId, recipe('Chili'));
		plan(chili, [200, 300, 400, -1]);
		const tacos = makeDish(householdId, recipe('Tacos'));
		plan(tacos, [200, 300, -30]);
		const stew = makeDish(householdId, recipe('Stew'));
		plan(stew, [200, 300, 400]);
		expect(listForgottenFavorites(householdId, TODAY)).toEqual([
			{ id: stew, name: 'Stew', count: 3, lastPlanned: ago(200) }
		]);
	});

	it("leaves out archived dishes and other households' dishes", () => {
		const meatloaf = makeDish(householdId, recipe('Meatloaf'));
		plan(meatloaf, [100, 200, 300]);
		setDishArchived(householdId, meatloaf, true, NOON);
		const theirs = makeDish(otherId, recipe('Paella'));
		plan(theirs, [100, 200, 300], otherId);
		expect(listForgottenFavorites(householdId, TODAY)).toEqual([]);
	});
});
