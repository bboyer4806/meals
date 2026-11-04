import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DinnerType } from '../../menu.ts';
import { db } from '../db/index.ts';
import { dinnerDishes, dinners, dishRequests, dishes, users } from '../db/schema.ts';
import {
	expectHttpError,
	freshDb,
	makeDinner,
	makeDish,
	makeHousehold,
	recipe
} from '../testing.ts';
import {
	clearDinner,
	getDay,
	setDinnerDishRole,
	type DishDestination,
	type NewDinnerLabels
} from './dinners.ts';
import { setDishArchived, updateDish } from './dishes.ts';
import { removeMember } from './households.ts';
import {
	addRequest,
	addRestaurantRequest,
	hasRequest,
	listRequests,
	promoteDishRequest,
	promoteRestaurantRequest,
	removeRequest,
	requestDish,
	restoreAndAddRequest
} from './requests.ts';

const NOW = Date.UTC(2026, 9, 7, 17, 0);

let householdId: number;
let userId: number;
let otherId: number;
let otherUserId: number;
let lasagna: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	({ householdId: otherId, userId: otherUserId } = makeHousehold());
	lasagna = makeDish(householdId, recipe('Lasagna'));
});

function ask(name: string, note: string | null = null, now = NOW, user = userId) {
	return addRequest(householdId, user, { name, note }, now);
}

function askRestaurant(name: string, note: string | null = null, now = NOW, user = userId) {
	addRestaurantRequest(householdId, user, { name, note }, now);
}

/** Another member of the household. */
function addMember(name: string): number {
	return db()
		.insert(users)
		.values({
			householdId,
			googleSub: `sub-${name}`,
			email: `${name}@example.com`,
			name,
			createdAt: 0
		})
		.returning({ id: users.id })
		.get().id;
}

function dishCount(): number {
	return db().select().from(dishes).all().length;
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

function dishNamed(name: string) {
	return db().select().from(dishes).where(eq(dishes.name, name)).get();
}

// Adding a request to a date (6.12).
const DATE = '2026-10-08';
const CHANGED = 'Someone changed this dinner since you opened it.';

/** Dinners of these types on the date, labeled as a date with more than one needs. */
function plan(date: string, types: DinnerType[]): number[] {
	return types.map((type, index) => {
		const dinnerId = makeDinner(householdId, date, { type });
		if (types.length > 1) {
			const label = `Dinner ${index + 1}`;
			db().update(dinners).set({ label }).where(eq(dinners.id, dinnerId)).run();
		}
		return dinnerId;
	});
}

/** Every row a refused addition must leave as it was. */
function everything() {
	return {
		dinners: db().select().from(dinners).all(),
		dinnerDishes: db().select().from(dinnerDishes).all(),
		requests: db().select().from(dishRequests).all(),
		dishes: db().select().from(dishes).all()
	};
}

describe('addRequest', () => {
	it('adds a new name to Recipes at the usual servings, and links to it', () => {
		expect(ask('  Shrimp   boil ', 'With corn')).toEqual({ kind: 'added' });
		const dish = dishNamed('Shrimp boil');
		expect(dish).toMatchObject({ householdId, servings: 4, archivedAt: null, createdAt: NOW });
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				kind: 'dish',
				name: 'Shrimp boil',
				note: 'With corn',
				dishId: dish!.id,
				askedBy: 'Person 1'
			}
		]);
		expect(dishCount()).toBe(2);
	});

	it('links to an active dish with the same name, ignoring case, and adds nothing', () => {
		ask('LASAGNA');
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'LASAGNA',
			dishId: lasagna
		});
		expect(dishCount()).toBe(1);
	});

	it("makes its own dish for a name only another household's dish has", () => {
		const curry = makeDish(otherId, recipe('Curry'));
		ask('Curry');
		const [request] = listRequests(householdId);
		expect(request).toMatchObject({ kind: 'dish', dishId: expect.any(Number) });
		expect(request).not.toMatchObject({ dishId: curry });
		expect(dishCount()).toBe(3);
	});

	it("offers to restore an archived dish's name and changes nothing", () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(ask('lasagna')).toEqual({ kind: 'archived', dishId: lasagna, name: 'Lasagna' });
		expect(listRequests(householdId)).toEqual([]);
		expect(dishCount()).toBe(1);
	});

	it('keeps the link and the name as typed after the dish is renamed or archived', () => {
		ask('lasagna');
		updateDish(householdId, lasagna, recipe('Veggie lasagna'), [], NOW);
		setDishArchived(householdId, lasagna, true, NOW);
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'lasagna',
			dishId: lasagna
		});
	});

	it('refuses a blank name and anything too long', () => {
		expect(refusal(() => ask('   '))).toBe('Enter a dish name');
		expect(refusal(() => ask('a'.repeat(81)))).toBe('Keep a dish name under 80 characters');
		expect(refusal(() => ask('Pie', 'a'.repeat(201)))).toBe('Keep the note under 200 characters');
		ask('a'.repeat(80), 'a'.repeat(200));
		expect(listRequests(householdId)).toHaveLength(1);
	});
});

describe('addRestaurantRequest', () => {
	it('asks for the restaurant by name as typed, with the note and who asked, linked to nothing', () => {
		askRestaurant('  Olive   Garden ', 'For her birthday', NOW, addMember('Sam'));
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				kind: 'restaurant',
				name: 'Olive Garden',
				note: 'For her birthday',
				askedBy: 'Sam'
			}
		]);
		expect(db().select().from(dishRequests).get()).toMatchObject({ dishId: null });
	});

	it("looks up and makes no dish, even for a dish's name", () => {
		askRestaurant('LASAGNA');
		expect(listRequests(householdId)).toEqual([
			expect.objectContaining({ kind: 'restaurant', name: 'LASAGNA' })
		]);
		expect(hasRequest(householdId, lasagna)).toBe(false);
		expect(dishCount()).toBe(1);
	});

	it('refuses a blank name and anything too long', () => {
		expect(refusal(() => askRestaurant('   '))).toBe('Enter a restaurant name');
		expect(refusal(() => askRestaurant('a'.repeat(81)))).toBe(
			'Keep a restaurant name under 80 characters'
		);
		expect(refusal(() => askRestaurant('Diner', 'a'.repeat(201)))).toBe(
			'Keep the note under 200 characters'
		);
		askRestaurant('a'.repeat(80), 'a'.repeat(200));
		expect(listRequests(householdId)).toHaveLength(1);
	});
});

describe('restoreAndAddRequest', () => {
	it('restores the dish and adds the request linked to it, with the name as typed', () => {
		setDishArchived(householdId, lasagna, true, NOW);
		restoreAndAddRequest(householdId, userId, lasagna, { name: ' LASAGNA ', note: 'Extra' }, NOW);
		expect(dishNamed('Lasagna')!.archivedAt).toBeNull();
		expect(listRequests(householdId)).toEqual([
			expect.objectContaining({ name: 'LASAGNA', note: 'Extra', dishId: lasagna })
		]);
	});

	it("refuses another household's dish with a 404 and adds nothing", () => {
		const curry = makeDish(otherId, recipe('Curry'));
		setDishArchived(otherId, curry, true, NOW);
		expectHttpError(
			() => restoreAndAddRequest(householdId, userId, curry, { name: 'Curry', note: null }, NOW),
			404
		);
		expect(dishNamed('Curry')!.archivedAt).toBe(NOW);
		expect(listRequests(householdId)).toEqual([]);
	});

	it('refuses a blank name and restores nothing', () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(
			refusal(() =>
				restoreAndAddRequest(householdId, userId, lasagna, { name: ' ', note: null }, NOW)
			)
		).toBe('Enter a dish name');
		expect(dishNamed('Lasagna')!.archivedAt).toBe(NOW);
	});
});

describe('requestDish', () => {
	it('asks for the dish as it is named now, from the person, with no note', () => {
		updateDish(householdId, lasagna, recipe('Veggie lasagna'), [], NOW);
		requestDish(householdId, userId, lasagna, NOW);
		expect(db().select().from(dishRequests).all()).toEqual([
			{
				id: expect.any(Number),
				householdId,
				userId,
				kind: 'dish',
				name: 'Veggie lasagna',
				note: null,
				dishId: lasagna,
				createdAt: NOW
			}
		]);
	});

	it('adds nothing when a request already links to the dish, from either place', () => {
		ask('LASAGNA', 'Extra cheese');
		requestDish(householdId, userId, lasagna, NOW);
		expect(listRequests(householdId)).toEqual([
			expect.objectContaining({ name: 'LASAGNA', note: 'Extra cheese', dishId: lasagna })
		]);

		removeRequest(householdId, listRequests(householdId)[0]!.id);
		requestDish(householdId, userId, lasagna, NOW);
		requestDish(householdId, userId, lasagna, NOW);
		expect(listRequests(householdId)).toEqual([
			expect.objectContaining({ name: 'Lasagna', note: null, dishId: lasagna })
		]);
	});

	it('refuses an archived dish and adds nothing', () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(refusal(() => requestDish(householdId, userId, lasagna, NOW))).toBe(
			'Restore Lasagna before requesting it'
		);
		expect(listRequests(householdId)).toEqual([]);
	});

	it("refuses another household's dish with a 404 and adds nothing", () => {
		const curry = makeDish(otherId, recipe('Curry'));
		expectHttpError(() => requestDish(householdId, userId, curry, NOW), 404);
		expect(db().select().from(dishRequests).all()).toEqual([]);
	});
});

describe('hasRequest', () => {
	it("says whether any request links to the dish, in the household's own requests", () => {
		expect(hasRequest(householdId, lasagna)).toBe(false);
		ask('lasagna');
		expect(hasRequest(householdId, lasagna)).toBe(true);
		expect(hasRequest(otherId, lasagna)).toBe(false);
		removeRequest(householdId, listRequests(householdId)[0]!.id);
		expect(hasRequest(householdId, lasagna)).toBe(false);
	});
});

describe('listRequests', () => {
	it("lists the household's own requests, oldest first", () => {
		ask('Soup', null, NOW + 2);
		ask('Pie', null, NOW);
		ask('Stew', null, NOW + 1);
		addRequest(otherId, otherUserId, { name: 'Curry', note: null }, NOW);
		expect(listRequests(householdId).map((request) => request.name)).toEqual([
			'Pie',
			'Stew',
			'Soup'
		]);
		expect(listRequests(otherId).map((request) => request.name)).toEqual(['Curry']);
	});

	it('lists dish and restaurant requests together, oldest first', () => {
		ask('Soup', null, NOW + 2);
		askRestaurant('Olive Garden', null, NOW);
		ask('Pie', null, NOW + 1);
		askRestaurant('Taco Bar', null, NOW + 3);
		addRestaurantRequest(otherId, otherUserId, { name: 'Diner', note: null }, NOW);
		expect(listRequests(householdId).map(({ kind, name }) => [kind, name])).toEqual([
			['restaurant', 'Olive Garden'],
			['dish', 'Pie'],
			['dish', 'Soup'],
			['restaurant', 'Taco Bar']
		]);
	});
});

describe('removeRequest', () => {
	it('removes the request and keeps its recipe', () => {
		ask('Soup');
		const [request] = listRequests(householdId);
		removeRequest(householdId, request!.id);
		expect(listRequests(householdId)).toEqual([]);
		expect(dishNamed('Soup')).toBeDefined();
	});

	it("refuses another household's request with a 404", () => {
		addRequest(otherId, otherUserId, { name: 'Curry', note: null }, NOW);
		const [request] = listRequests(otherId);
		expectHttpError(() => removeRequest(householdId, request!.id), 404);
		expect(listRequests(otherId)).toHaveLength(1);
	});

	it('removes a restaurant request, as it does a dish request', () => {
		askRestaurant('Olive Garden', null, NOW);
		ask('Soup', null, NOW + 1);
		const [restaurant] = listRequests(householdId);
		removeRequest(householdId, restaurant!.id);
		expect(listRequests(householdId).map((request) => request.name)).toEqual(['Soup']);
	});

	it('is not found for a removed request once a newer one is made, and removes nothing', () => {
		ask('Soup');
		const [soup] = listRequests(householdId);
		removeRequest(householdId, soup!.id);
		ask('Pie');
		expectHttpError(() => removeRequest(householdId, soup!.id), 404);
		expect(listRequests(householdId).map((request) => request.name)).toEqual(['Pie']);
	});
});

describe('promoteDishRequest', () => {
	let rice: number;

	beforeEach(() => {
		rice = makeDish(householdId, recipe('Rice'));
	});

	/** Asks for the dish, and gives the request's id. */
	function requested(name: string, note: string | null = null): number {
		ask(name, note);
		const request = listRequests(householdId).find((candidate) => candidate.name === name);
		if (!request) throw new Error(`No request for ${name}`);
		return request.id;
	}

	function promote(requestId: number, to: DishDestination, date = DATE): number {
		return promoteDishRequest(householdId, date, requestId, to, NOW);
	}

	/** A new dinner, with the labels the page asked for. */
	function newDinner(first: string | null = null, added: string | null = null): DishDestination {
		return { labels: { first, added } };
	}

	/** The date's dinners as "Label: type, note, dishes", in the order they were added. */
	function day(date = DATE) {
		return getDay(householdId, date).map(
			(dinner) =>
				`${dinner.label}: ${dinner.type}, ${dinner.note}, ` +
				dinner.dishes.map((dish) => `${dish.name} (${dish.role})`).join(' ')
		);
	}

	it('puts the recipe on the dinner the page picked, as Main, and removes only that request', () => {
		const dinnerId = makeDinner(householdId, DATE);
		const request = requested('Lasagna');
		requested('Soup');
		expect(promote(request, { dinnerId })).toBe(dinnerId);
		expect(day()).toEqual(['null: cook, null, Lasagna (main)']);
		expect(listRequests(householdId).map((other) => other.name)).toEqual(['Soup']);
		// Its recipe stays in Recipes.
		expect(dishNamed('Lasagna')).toMatchObject({ id: lasagna, archivedAt: null });
		expect(db().select().from(dinners).get()?.updatedAt).toBe(NOW);
	});

	it('adds it as Side to a dinner with dishes, whose role can change after (6.9)', () => {
		const dinnerId = makeDinner(householdId, DATE, { dishes: [[rice, 'main']] });
		promote(requested('Lasagna'), { dinnerId });
		expect(day()).toEqual(['null: cook, null, Rice (main) Lasagna (side)']);
		setDinnerDishRole(householdId, DATE, dinnerId, lasagna, 'dessert', NOW);
		expect(day()).toEqual(['null: cook, null, Rice (main) Lasagna (dessert)']);

		// Bringing a dish has dishes too (Q26).
		const going = makeDinner(householdId, '2026-10-09', { type: 'going' });
		promote(requested('Soup'), { dinnerId: going }, '2026-10-09');
		expect(day('2026-10-09')).toEqual(['null: going, null, Soup (main)']);
	});

	it('plans a date with no dinner as Cooking at home at the usual servings (6.9, Q28)', () => {
		const dinnerId = promote(requested('Lasagna', 'Extra cheese'), newDinner());
		expect(getDay(householdId, DATE)).toEqual([
			{
				id: dinnerId,
				date: DATE,
				label: null,
				type: 'cook',
				restaurantName: null,
				note: 'Extra cheese',
				servings: 4,
				dishes: [{ dishId: lasagna, name: 'Lasagna', role: 'main', archived: false }]
			}
		]);
		expect(listRequests(householdId)).toEqual([]);
	});

	it("adds a labeled Cooking at home dinner when none of the date's can have dishes (6.9)", () => {
		makeDinner(householdId, DATE, { type: 'eat_out', note: 'Pizza' });
		const kids = promote(requested('Lasagna', 'For the kids'), newDinner(' Adults ', 'Kids'));
		expect(day()).toEqual(['Adults: eat_out, Pizza, ', 'Kids: cook, For the kids, Lasagna (main)']);
		expect(getDay(householdId, DATE)[1]).toMatchObject({ id: kids, servings: 4 });

		// Later dinners need only their own label.
		plan('2026-10-09', ['leftovers', 'eat_out']);
		promote(requested('Soup'), newDinner(null, 'Guests'), '2026-10-09');
		expect(day('2026-10-09')).toEqual([
			'Dinner 1: leftovers, null, ',
			'Dinner 2: eat_out, null, ',
			'Guests: cook, null, Soup (main)'
		]);
	});

	it('needs the labels Add a dinner needs, and changes nothing until they are right', () => {
		makeDinner(householdId, DATE, { type: 'eat_out' });
		const request = requested('Lasagna');
		const before = everything();
		const tries: [DishDestination, string][] = [
			[newDinner('Adults', ''), 'Enter a label for each dinner'],
			[newDinner(' ', 'Kids'), 'Enter a label for each dinner'],
			// The first dinner's label is set before the new one's is checked.
			[newDinner('Kids', 'KIDS'), 'Give each dinner on this day a different label'],
			[newDinner('Adults', 'x'.repeat(31)), 'Keep a label under 30 characters'],
			// The page showed the date with no dinner, or with more than one.
			[newDinner(), CHANGED],
			[newDinner(null, 'Kids'), CHANGED]
		];
		for (const [to, message] of tries) expect(refusal(() => promote(request, to))).toBe(message);
		expect(everything()).toEqual(before);
	});

	it('adds a fifth dinner but not a sixth, and still adds to a full day that can take it', () => {
		plan(DATE, ['eat_out', 'eat_out', 'leftovers', 'eat_out']);
		promote(requested('Soup'), newDinner(null, 'Fifth'), DATE);
		expect(day().at(-1)).toBe('Fifth: cook, null, Soup (main)');

		const full = '2026-10-09';
		plan(full, ['eat_out', 'eat_out', 'leftovers', 'eat_out', 'leftovers']);
		const request = requested('Lasagna');
		const before = everything();
		expect(refusal(() => promote(request, newDinner(null, 'Sixth'), full))).toBe(
			'This day already has 5 dinners, and none can have dishes. Switch one to Cooking at home or Bringing a dish to add dishes.'
		);
		expect(everything()).toEqual(before);

		const last = plan('2026-10-10', ['eat_out', 'eat_out', 'eat_out', 'eat_out', 'cook']).at(-1);
		promote(request, { dinnerId: last ?? 0 }, '2026-10-10');
		expect(day('2026-10-10').at(-1)).toBe('Dinner 5: cook, null, Lasagna (main)');
	});

	it("puts the request's note on the end of the dinner's, on a line of its own", () => {
		const noted = makeDinner(householdId, DATE, { note: 'Grandma visits' });
		promote(requested('Lasagna', 'Extra cheese'), { dinnerId: noted });
		expect(getDay(householdId, DATE)[0]?.note).toBe('Grandma visits\nExtra cheese');

		const empty = makeDinner(householdId, '2026-10-09');
		promote(requested('Soup', 'Spicy'), { dinnerId: empty }, '2026-10-09');
		expect(getDay(householdId, '2026-10-09')[0]?.note).toBe('Spicy');

		// A request without a note leaves the dinner's as it was.
		promote(requested('Stew'), { dinnerId: noted });
		expect(getDay(householdId, DATE)[0]?.note).toBe('Grandma visits\nExtra cheese');
	});

	it("refuses a note that would take the dinner's past 2500 characters, changing nothing", () => {
		const dinnerId = makeDinner(householdId, DATE, { note: 'a'.repeat(2489) });
		const tooLong = requested('Lasagna', 'b'.repeat(11));
		const before = everything();
		expect(refusal(() => promote(tooLong, { dinnerId }))).toBe(
			"The request's note would make this dinner's note longer than 2500 characters. Shorten the dinner's note first."
		);
		expect(everything()).toEqual(before);

		promote(requested('Soup', 'b'.repeat(10)), { dinnerId });
		expect(getDay(householdId, DATE)[0]?.note).toHaveLength(2500);
	});

	it('refuses a dish already on the dinner and an archived recipe, changing nothing', () => {
		const dinnerId = makeDinner(householdId, DATE, { dishes: [[lasagna, 'main']] });
		const again = requested('Lasagna');
		const riceRequest = requested('Rice');
		// The request keeps its recipe after it's archived (6.12).
		setDishArchived(householdId, rice, true, NOW);
		const before = everything();
		expect(refusal(() => promote(again, { dinnerId }))).toBe('Lasagna is already on this dinner');
		expect(refusal(() => promote(riceRequest, { dinnerId }))).toBe('Restore Rice before adding it');
		expect(refusal(() => promote(riceRequest, newDinner(), '2026-10-09'))).toBe(
			'Restore Rice before adding it'
		);
		expect(everything()).toEqual(before);
	});

	it("refuses a dinner that can't have dishes, or that isn't on the date while others are (6.11)", () => {
		const eatOut = makeDinner(householdId, DATE, { type: 'eat_out' });
		const elsewhere = makeDinner(householdId, '2026-10-09');
		const theirs = makeDinner(otherId, DATE, { note: 'Theirs' });
		// The page showed no dinner that can have dishes, and someone switched one since.
		makeDinner(householdId, '2026-10-10');
		const request = requested('Lasagna');
		const before = everything();
		expect(refusal(() => promote(request, { dinnerId: eatOut }))).toBe(
			'Switch to Cooking at home or Bringing a dish to add dishes'
		);
		expect(refusal(() => promote(request, { dinnerId: elsewhere }))).toBe(CHANGED);
		expect(refusal(() => promote(request, { dinnerId: theirs }))).toBe(CHANGED);
		expect(refusal(() => promote(request, newDinner(), '2026-10-10'))).toBe(CHANGED);
		expect(refusal(() => promote(request, newDinner(null, 'Kids'), '2026-10-10'))).toBe(CHANGED);
		expect(everything()).toEqual(before);
	});

	it('plans the date again when the dinner the page picked is gone and none is left (6.11)', () => {
		const gone = makeDinner(householdId, DATE, { note: 'Busy day' });
		clearDinner(householdId, DATE, gone, NOW);
		const dinnerId = promote(requested('Lasagna', 'Extra cheese'), { dinnerId: gone });
		expect(dinnerId).not.toBe(gone);
		expect(day()).toEqual(['null: cook, Extra cheese, Lasagna (main)']);

		// Labels asked for while the date had dinners, which someone cleared since.
		const cleared = makeDinner(householdId, '2026-10-09', { type: 'eat_out' });
		clearDinner(householdId, '2026-10-09', cleared, NOW);
		promote(requested('Soup'), newDinner('Adults', 'Kids'), '2026-10-09');
		expect(day('2026-10-09')).toEqual(['null: cook, null, Soup (main)']);
	});

	it("is not found for a removed request, a restaurant request or another household's", () => {
		const dinnerId = makeDinner(householdId, DATE);
		const removed = requested('Lasagna');
		removeRequest(householdId, removed);
		askRestaurant('Olive Garden');
		const restaurant = listRequests(householdId)[0]?.id ?? 0;
		addRequest(otherId, otherUserId, { name: 'Curry', note: null }, NOW);
		const theirs = listRequests(otherId)[0]?.id ?? 0;
		const before = everything();
		for (const requestId of [removed, restaurant, theirs]) {
			expectHttpError(() => promote(requestId, { dinnerId }), 404);
		}
		expect(everything()).toEqual(before);
	});

	it('is not found for a removed request once a newer one is made, changing nothing (6.11)', () => {
		const dinnerId = makeDinner(householdId, DATE);
		const removed = requested('Lasagna');
		removeRequest(householdId, removed);
		requested('Rice');
		const before = everything();
		expectHttpError(() => promote(removed, { dinnerId }), 404);
		expect(everything()).toEqual(before);
	});
});

describe('promoteRestaurantRequest', () => {
	/** Asks for the restaurant, and gives the request's id. */
	function requested(name: string, note: string | null = null): number {
		askRestaurant(name, note);
		const request = listRequests(householdId).find((candidate) => candidate.name === name);
		if (!request) throw new Error(`No request for ${name}`);
		return request.id;
	}

	function promote(
		requestId: number,
		labels: NewDinnerLabels = { first: null, added: null },
		date = DATE
	): number {
		return promoteRestaurantRequest(householdId, date, requestId, labels, NOW);
	}

	/** The date's dinners as "Label: type, restaurant, note, dishes", in the order they were added. */
	function day(date = DATE) {
		return getDay(householdId, date).map(
			(dinner) =>
				`${dinner.label}: ${dinner.type}, ${dinner.restaurantName}, ${dinner.note}, ` +
				dinner.dishes.map((dish) => dish.name).join(' ')
		);
	}

	it('plans a date with no dinner as Eating out there, with the note, and removes only that request', () => {
		const request = requested('Olive Garden', 'For her birthday');
		requested('Taco Bar');
		ask('Soup');
		const dinnerId = promote(request);
		expect(getDay(householdId, DATE)).toEqual([
			{
				id: dinnerId,
				date: DATE,
				label: null,
				type: 'eat_out',
				restaurantName: 'Olive Garden',
				note: 'For her birthday',
				servings: 4,
				dishes: []
			}
		]);
		expect(db().select().from(dinners).get()).toMatchObject({ createdAt: NOW, updatedAt: NOW });
		expect(listRequests(householdId).map((other) => other.name)).toEqual(['Taco Bar', 'Soup']);

		// A request without a note makes a dinner without one.
		promote(requested('Diner'), undefined, '2026-10-09');
		expect(day('2026-10-09')).toEqual(['null: eat_out, Diner, null, ']);
	});

	it('adds a separate dinner to a day with one, labeling both, and leaves the first as it was', () => {
		const first = makeDinner(householdId, DATE, { note: 'Busy', dishes: [[lasagna, 'main']] });
		const before = getDay(householdId, DATE)[0];
		const dinnerId = promote(requested('Olive Garden', 'At 7'), { first: ' Kids ', added: 'Adults' });
		expect(getDay(householdId, DATE)).toEqual([
			{ ...before, id: first, label: 'Kids' },
			{
				id: dinnerId,
				date: DATE,
				label: 'Adults',
				type: 'eat_out',
				restaurantName: 'Olive Garden',
				note: 'At 7',
				servings: 4,
				dishes: []
			}
		]);

		// Even an Eating out dinner with no restaurant yet stays as it is.
		makeDinner(householdId, '2026-10-09', { type: 'eat_out', note: 'Somewhere' });
		promote(requested('Taco Bar'), { first: 'Us', added: 'Them' }, '2026-10-09');
		expect(day('2026-10-09')).toEqual([
			'Us: eat_out, null, Somewhere, ',
			'Them: eat_out, Taco Bar, null, '
		]);
		expect(listRequests(householdId)).toEqual([]);
	});

	it('adds a fifth dinner with its own label, but not a sixth, changing nothing', () => {
		plan(DATE, ['cook', 'eat_out', 'going', 'leftovers']);
		promote(requested('Olive Garden'), { first: null, added: 'Fifth' });
		expect(day()).toHaveLength(5);
		expect(day().at(-1)).toBe('Fifth: eat_out, Olive Garden, null, ');

		const full = '2026-10-09';
		plan(full, ['cook', 'eat_out', 'going', 'leftovers', 'cook']);
		const request = requested('Taco Bar', 'Tuesday deal');
		const before = everything();
		// The page doesn't ask for labels on a full day, so it sends none.
		for (const labels of [
			{ first: null, added: null },
			{ first: null, added: 'Sixth' }
		]) {
			expect(refusal(() => promote(request, labels, full))).toBe(
				'This day already has 5 dinners. Clear one to add another.'
			);
		}
		expect(everything()).toEqual(before);
	});

	it('needs the labels Add a dinner needs, and changes nothing until they are right', () => {
		makeDinner(householdId, DATE, { type: 'eat_out' });
		const request = requested('Olive Garden');
		const before = everything();
		const tries: [NewDinnerLabels, string][] = [
			[{ first: 'Adults', added: '' }, 'Enter a label for each dinner'],
			[{ first: ' ', added: 'Kids' }, 'Enter a label for each dinner'],
			[{ first: 'Kids', added: 'KIDS' }, 'Give each dinner on this day a different label'],
			[{ first: 'Adults', added: 'x'.repeat(31) }, 'Keep a label under 30 characters'],
			// The page showed the date with no dinner, or with more than one.
			[{ first: null, added: null }, CHANGED],
			[{ first: null, added: 'Kids' }, CHANGED]
		];
		for (const [labels, message] of tries) {
			expect(refusal(() => promote(request, labels))).toBe(message);
		}
		expect(refusal(() => promote(request, undefined, '2026-02-30'))).toBe('Pick a date');
		expect(everything()).toEqual(before);
	});

	it('plans the date when the dinners the page showed were cleared meanwhile (6.11)', () => {
		const cleared = makeDinner(householdId, DATE, { type: 'cook' });
		clearDinner(householdId, DATE, cleared, NOW);
		promote(requested('Olive Garden'), { first: 'Adults', added: 'Kids' });
		expect(day()).toEqual(['null: eat_out, Olive Garden, null, ']);
	});

	it("is not found for a removed request, a dish request or another household's, changing nothing", () => {
		makeDinner(householdId, DATE);
		const removed = requested('Olive Garden');
		removeRequest(householdId, removed);
		ask('Soup');
		const dish = listRequests(householdId)[0]?.id ?? 0;
		addRestaurantRequest(otherId, otherUserId, { name: 'Diner', note: null }, NOW);
		const theirs = listRequests(otherId)[0]?.id ?? 0;
		const before = everything();
		for (const requestId of [removed, dish, theirs]) {
			expectHttpError(() => promote(requestId, { first: 'Adults', added: 'Kids' }), 404);
		}
		expect(everything()).toEqual(before);
	});
});

it("removing a member removes their requests, dish and restaurant, and keeps everyone else's", () => {
	const memberId = addMember('Sam');
	ask('Soup', null, NOW, memberId);
	askRestaurant('Olive Garden', null, NOW, memberId);
	ask('Pie', null, NOW + 1);
	askRestaurant('Taco Bar', null, NOW + 2);
	removeMember(householdId, userId, memberId);
	expect(listRequests(householdId).map((request) => request.name)).toEqual(['Pie', 'Taco Bar']);
});

it('the database rejects a dish from another household', () => {
	const curry = makeDish(otherId, recipe('Curry'));
	expect(() =>
		db()
			.insert(dishRequests)
			.values({
				householdId,
				userId,
				name: 'Curry',
				note: null,
				dishId: curry,
				createdAt: NOW
			})
			.run()
	).toThrow(/FOREIGN KEY/);
});

it('the database refuses a restaurant request with a dish, and a dish request without one', () => {
	const insert = (kind: 'dish' | 'restaurant', dishId: number | null) => () =>
		db()
			.insert(dishRequests)
			.values({ householdId, userId, kind, name: 'Lasagna', note: null, dishId, createdAt: NOW })
			.run();
	expect(insert('restaurant', lasagna)).toThrow(/CHECK constraint failed: dish_requests_kind_dish/);
	expect(insert('dish', null)).toThrow(/CHECK constraint failed: dish_requests_kind_dish/);
	expect(listRequests(householdId)).toEqual([]);
});
