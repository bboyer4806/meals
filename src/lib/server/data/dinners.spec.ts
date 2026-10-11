import { isHttpError } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { dinnerDishes, dinners, dishes, households } from '../db/schema.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDinner,
	makeDish,
	makeHousehold,
	recipe
} from '../testing.ts';
import {
	addDinnerDish,
	clearDinner,
	copyDinner,
	dishSuggestions,
	getDinner,
	getDinners,
	listCopyGroups,
	moveDinner,
	removeDinnerDish,
	restoreAndAddDinnerDish,
	saveDinner,
	setDinnerDishRole
} from './dinners.ts';
import { getDish, listDishes, setDishArchived } from './dishes.ts';

const TZ = 'America/Chicago';
// Wed 2026-10-07 12:00 in Chicago.
const NOW = Date.UTC(2026, 9, 7, 17, 0);
const LATER = NOW + 60 * 60 * 1000;
const TODAY = '2026-10-07';
const TOMORROW = '2026-10-08';

let householdId: number;
let otherId: number;
let tacos: number;
let rice: number;
let salad: number;
let cake: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	({ householdId: otherId } = makeHousehold(TZ));
	// Usual servings that no dish has, so tests can tell where servings came from.
	db().update(households).set({ defaultServings: 3 }).where(eq(households.id, householdId)).run();
	tacos = makeDish(householdId, recipe('Tacos', { servings: 6 }));
	rice = makeDish(householdId, recipe('Rice'));
	salad = makeDish(householdId, recipe('Salad'));
	cake = makeDish(householdId, recipe('Pound cake', { servings: 8 }));
});

function row(date: string, household = householdId) {
	return db()
		.select()
		.from(dinners)
		.where(and(eq(dinners.householdId, household), eq(dinners.date, date)))
		.get();
}

/** The dinner's dishes as "Name (role)", in the order the dinner lists them. */
function dishesOn(date: string, household = householdId): string[] | undefined {
	return getDinner(household, date)?.dishes.map((dish) => `${dish.name} (${dish.role})`);
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

function dishCount(): number {
	return db().select().from(dishes).all().length;
}

function dinnerDishCount(): number {
	return db().select().from(dinnerDishes).all().length;
}

describe('saving a dinner', () => {
	it('plans an unplanned date', () => {
		saveDinner(householdId, TODAY, { type: 'eat_out', note: 'Thai place', servings: 2 }, NOW);
		expect(getDinner(householdId, TODAY)).toEqual({
			id: expect.any(Number),
			date: TODAY,
			type: 'eat_out',
			note: 'Thai place',
			servings: 2,
			dishes: []
		});
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
	});

	it('updates the dinner already on the date', () => {
		const id = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		saveDinner(householdId, TODAY, { type: 'going', note: "At Grandma's", servings: 7 }, LATER);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			id,
			type: 'going',
			note: "At Grandma's",
			servings: 7
		});
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
		expect(db().select().from(dinners).all()).toHaveLength(1);

		saveDinner(householdId, TODAY, { type: 'cook', note: null, servings: 7 }, LATER);
		expect(getDinner(householdId, TODAY)).toMatchObject({ type: 'cook', note: null });
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
	});

	it.each(['eat_out', 'leftovers'] as const)('removes the dishes when it becomes %s', (type) => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main'], [rice, 'side']] });
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		saveDinner(householdId, TODAY, { type, note: 'Full', servings: 4 }, NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({ type, note: 'Full', dishes: [] });
		// Only that dinner's, and the dishes themselves stay.
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(dishCount()).toBe(4);
	});

	it('takes 1 to 100 whole servings and a note up to 2500 characters', () => {
		saveDinner(householdId, TODAY, { type: 'cook', note: 'x'.repeat(2500), servings: 100 }, NOW);
		saveDinner(householdId, TOMORROW, { type: 'cook', note: null, servings: 1 }, NOW);
		expect(getDinner(householdId, TODAY)?.servings).toBe(100);
		expect(getDinner(householdId, TOMORROW)?.servings).toBe(1);
	});

	it('refuses servings out of range, a long note and a date that is not one', () => {
		const save = (fields: { note?: string | null; servings?: number }, date = TODAY) => () =>
			saveDinner(householdId, date, { type: 'cook', note: null, servings: 4, ...fields }, NOW);
		expectHttpError(save({ servings: 0 }), 400);
		expectHttpError(save({ servings: 101 }), 400);
		expectHttpError(save({ servings: 2.5 }), 400);
		expectHttpError(save({ servings: Number.NaN }), 400);
		expectHttpError(save({ note: 'x'.repeat(2501) }), 400);
		expectHttpError(save({}, '2026-02-30'), 400);
		expectHttpError(save({}, 'today'), 400);
		expect(db().select().from(dinners).all()).toEqual([]);
		expect(refusal(save({ servings: 0 }))).toBe('Enter at least 1 serving');
		expect(refusal(save({ servings: 101 }))).toBe('Enter 100 servings or fewer');
		expect(refusal(save({ servings: 2.5 }))).toBe('Enter a whole number of servings');
		expect(refusal(save({ note: 'x'.repeat(2501) }))).toBe('Keep the note under 2500 characters');
	});

	it("keeps each household's dinners apart", () => {
		saveDinner(householdId, TODAY, { type: 'cook', note: 'Ours', servings: 3 }, NOW);
		saveDinner(otherId, TODAY, { type: 'eat_out', note: 'Theirs', servings: 2 }, NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({ type: 'cook', note: 'Ours' });
		expect(getDinner(otherId, TODAY)).toMatchObject({ type: 'eat_out', note: 'Theirs' });
	});
});

describe('reading dinners', () => {
	it('lists the planned dates in a range by date, both ends included', () => {
		makeDinner(householdId, '2026-10-10', { type: 'leftovers' });
		makeDinner(householdId, '2026-10-04', { type: 'going', note: 'Picnic' });
		makeDinner(householdId, '2026-10-07', { servings: 5 });
		makeDinner(householdId, '2026-10-03');
		makeDinner(householdId, '2026-10-11');
		makeDinner(otherId, '2026-10-05');
		expect(getDinners(householdId, '2026-10-04', '2026-10-10')).toEqual([
			{
				id: expect.any(Number),
				date: '2026-10-04',
				type: 'going',
				note: 'Picnic',
				servings: 4,
				dishes: []
			},
			{
				id: expect.any(Number),
				date: '2026-10-07',
				type: 'cook',
				note: null,
				servings: 5,
				dishes: []
			},
			{
				id: expect.any(Number),
				date: '2026-10-10',
				type: 'leftovers',
				note: null,
				servings: 4,
				dishes: []
			}
		]);
		expect(getDinners(householdId, '2026-10-05', '2026-10-06')).toEqual([]);
		expect(getDinners(otherId, '2026-10-04', '2026-10-10').map((d) => d.date)).toEqual([
			'2026-10-05'
		]);
	});

	it('lists dishes by role, then in the order they were added (6.9)', () => {
		makeDinner(householdId, TODAY, {
			dishes: [
				[cake, 'dessert'],
				[salad, 'side'],
				[tacos, 'main'],
				[rice, 'side']
			]
		});
		const soup = makeDish(householdId, recipe('Soup'));
		makeDinner(householdId, TOMORROW, { dishes: [[soup, 'other'], [rice, 'main']] });
		expect(dishesOn(TODAY)).toEqual([
			'Tacos (main)',
			'Salad (side)',
			'Rice (side)',
			'Pound cake (dessert)'
		]);
		expect(getDinners(householdId, TODAY, TOMORROW).map((d) => d.dishes)).toEqual([
			[
				{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
				{ dishId: salad, name: 'Salad', role: 'side', archived: false },
				{ dishId: rice, name: 'Rice', role: 'side', archived: false },
				{ dishId: cake, name: 'Pound cake', role: 'dessert', archived: false }
			],
			[
				{ dishId: rice, name: 'Rice', role: 'main', archived: false },
				{ dishId: soup, name: 'Soup', role: 'other', archived: false }
			]
		]);
	});

	it('keeps archived dishes on dinners, marked archived (6.10)', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main'], [rice, 'side']] });
		setDishArchived(householdId, rice, true, NOW);
		expect(getDinner(householdId, TODAY)?.dishes).toEqual([
			{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
			{ dishId: rice, name: 'Rice', role: 'side', archived: true }
		]);
	});

	it('gives null for an unplanned date', () => {
		makeDinner(otherId, TODAY);
		expect(getDinner(householdId, TODAY)).toBeNull();
	});
});

describe('adding a dish', () => {
	it('adds an existing dish to the dinner and marks the dinner changed', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		expect(addDinnerDish(householdId, TODAY, { id: rice }, 'side', LATER)).toEqual({
			kind: 'added'
		});
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Rice (side)']);
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
	});

	it('plans an unplanned date as Cooking at home at the usual servings', () => {
		addDinnerDish(householdId, TODAY, { id: tacos }, 'main', NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			type: 'cook',
			note: null,
			servings: 3,
			dishes: [{ dishId: tacos, name: 'Tacos', role: 'main', archived: false }]
		});
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
	});

	it('adds dishes to a Going somewhere dinner', () => {
		makeDinner(householdId, TODAY, { type: 'going' });
		addDinnerDish(householdId, TODAY, { id: salad }, 'side', NOW);
		expect(dishesOn(TODAY)).toEqual(['Salad (side)']);
	});

	it('finds a dish by name ignoring case and spacing', () => {
		addDinnerDish(householdId, TODAY, { name: '  pound   CAKE ' }, 'dessert', NOW);
		expect(dishesOn(TODAY)).toEqual(['Pound cake (dessert)']);
		expect(getDinner(householdId, TODAY)?.dishes[0]?.dishId).toBe(cake);
		expect(dishCount()).toBe(4);
	});

	it('makes a new dish from a new name, with the usual servings and no recipe (2.3)', () => {
		addDinnerDish(householdId, TODAY, { name: ' Garlic   bread ' }, 'side', NOW);
		const added = getDinner(householdId, TODAY)?.dishes[0];
		expect(added).toMatchObject({ name: 'Garlic bread', role: 'side', archived: false });
		const dish = getDish(householdId, added?.dishId ?? 0);
		expect(dish).toMatchObject({
			name: 'Garlic bread',
			servings: 3,
			steps: null,
			archivedAt: null,
			tags: [],
			ingredients: []
		});
		expect(db().select().from(dishes).where(eq(dishes.id, dish.id)).get()).toMatchObject({
			householdId,
			createdAt: NOW,
			updatedAt: NOW
		});
		expect(listDishes(householdId, { search: 'garlic', tag: null, archived: false })).toEqual([
			expect.objectContaining({ name: 'Garlic bread', hasRecipe: false })
		]);
	});

	it("uses this household's dishes only; another's name is new here", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		addDinnerDish(householdId, TODAY, { name: 'lasagna' }, 'main', NOW);
		const added = getDinner(householdId, TODAY)?.dishes[0];
		expect(added?.name).toBe('lasagna');
		expect(added?.dishId).not.toBe(theirs);
	});

	it("can't point a dinner at another household's dish, even in the database (4.5)", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		const dinnerId = makeDinner(householdId, TODAY);
		expect(() =>
			db().insert(dinnerDishes).values({ householdId, dinnerId, dishId: theirs, role: 'main' }).run()
		).toThrow(/FOREIGN KEY/);
		const theirDinner = makeDinner(otherId, TODAY);
		expect(() =>
			db()
				.insert(dinnerDishes)
				.values({ householdId, dinnerId: theirDinner, dishId: tacos, role: 'main' })
				.run()
		).toThrow(/FOREIGN KEY/);
	});

	it("refuses another household's dish by id", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		expectHttpError(() => addDinnerDish(householdId, TODAY, { id: theirs }, 'main', NOW), 404);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { id: 9999 }, 'main', NOW), 404);
		expect(row(TODAY)).toBeUndefined();
	});

	it.each(['eat_out', 'leftovers'] as const)('refuses a %s dinner', (type) => {
		makeDinner(householdId, TODAY, { type }, NOW);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { id: tacos }, 'main', LATER), 400);
		expectHttpError(
			() => addDinnerDish(householdId, TODAY, { name: 'Brand new' }, 'main', LATER),
			400
		);
		expect(getDinner(householdId, TODAY)?.dishes).toEqual([]);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
		expect(dishCount()).toBe(4);
	});

	it('refuses a dish that is already on the dinner, by id or by name', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { id: tacos }, 'side', LATER), 400);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { name: 'TACOS' }, 'side', LATER), 400);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});

	it('tells the person what to do', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, TOMORROW, { type: 'eat_out' });
		setDishArchived(householdId, rice, true, NOW);
		const add = (dish: { id: number } | { name: string }, date = TODAY) => () =>
			addDinnerDish(householdId, date, dish, 'side', NOW);
		expect(refusal(add({ name: 'tacos' }))).toBe('Tacos is already on this dinner');
		expect(refusal(add({ id: rice }))).toBe('Restore Rice before adding it');
		expect(refusal(add({ id: salad }, TOMORROW))).toBe(
			'Switch to Cooking at home or Going somewhere to add dishes'
		);
		expect(refusal(add({ name: ' ' }))).toBe('Enter a dish name');
		expect(refusal(add({ name: 'x'.repeat(81) }))).toBe('Keep a dish name under 80 characters');
		expect(refusal(add({ id: salad }, 'someday'))).toBe('Pick a date');
	});

	it('refuses an archived dish by id', () => {
		setDishArchived(householdId, rice, true, NOW);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { id: rice }, 'side', NOW), 400);
		expect(row(TODAY)).toBeUndefined();
	});

	it('offers to restore an archived dish typed by name, changing nothing (6.10)', () => {
		setDishArchived(householdId, rice, true, NOW);
		expect(addDinnerDish(householdId, TODAY, { name: 'RICE' }, 'side', LATER)).toEqual({
			kind: 'archived',
			dishId: rice,
			name: 'Rice'
		});
		expect(row(TODAY)).toBeUndefined();
		expect(getDish(householdId, rice).archivedAt).toBe(NOW);
		expect(dishCount()).toBe(4);

		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] }, NOW);
		expect(addDinnerDish(householdId, TOMORROW, { name: 'rice' }, 'side', LATER).kind).toBe(
			'archived'
		);
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(row(TOMORROW)?.updatedAt).toBe(NOW);
	});

	it('says an archived dish typed by name is already there when it is', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		setDishArchived(householdId, rice, true, NOW);
		expectHttpError(() => addDinnerDish(householdId, TODAY, { name: 'Rice' }, 'side', NOW), 400);
	});

	it('refuses a blank name or one over 80 characters', () => {
		expectHttpError(() => addDinnerDish(householdId, TODAY, { name: '   ' }, 'main', NOW), 400);
		expectHttpError(
			() => addDinnerDish(householdId, TODAY, { name: 'x'.repeat(81) }, 'main', NOW),
			400
		);
		expect(row(TODAY)).toBeUndefined();
		expect(dishCount()).toBe(4);
		addDinnerDish(householdId, TODAY, { name: `${'x'.repeat(80)}  ` }, 'main', NOW);
		expect(getDinner(householdId, TODAY)?.dishes[0]?.name).toBe('x'.repeat(80));
	});

	it('refuses a date that is not one', () => {
		expectHttpError(() => addDinnerDish(householdId, '2026-13-01', { id: rice }, 'side', NOW), 400);
		expectHttpError(() => addDinnerDish(householdId, '', { name: 'New' }, 'side', NOW), 400);
		expect(db().select().from(dinners).all()).toEqual([]);
		expect(dishCount()).toBe(4);
	});
});

describe('restoring and adding a dish', () => {
	beforeEach(() => {
		setDishArchived(householdId, rice, true, NOW);
	});

	it('restores the dish and adds it', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		restoreAndAddDinnerDish(householdId, TODAY, rice, 'side', LATER);
		expect(getDish(householdId, rice).archivedAt).toBeNull();
		expect(getDinner(householdId, TODAY)?.dishes).toEqual([
			{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
			{ dishId: rice, name: 'Rice', role: 'side', archived: false }
		]);
		expect(row(TODAY)?.updatedAt).toBe(LATER);
	});

	it('plans an unplanned date as Cooking at home', () => {
		restoreAndAddDinnerDish(householdId, TODAY, rice, 'main', NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			type: 'cook',
			servings: 3,
			dishes: [{ dishId: rice, role: 'main' }]
		});
	});

	it('adds a dish someone already restored', () => {
		setDishArchived(householdId, rice, false, NOW);
		restoreAndAddDinnerDish(householdId, TODAY, rice, 'side', NOW);
		expect(dishesOn(TODAY)).toEqual(['Rice (side)']);
	});

	it('leaves the dish archived when it cannot be added', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		makeDinner(householdId, TOMORROW, { type: 'leftovers' });
		expectHttpError(() => restoreAndAddDinnerDish(householdId, TODAY, rice, 'main', LATER), 400);
		expectHttpError(() => restoreAndAddDinnerDish(householdId, TOMORROW, rice, 'main', LATER), 400);
		expectHttpError(() => restoreAndAddDinnerDish(householdId, 'soon', rice, 'main', LATER), 400);
		expect(getDish(householdId, rice).archivedAt).toBe(NOW);
		expect(dishesOn(TOMORROW)).toEqual([]);
	});

	it("refuses another household's dish", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		setDishArchived(otherId, theirs, true, NOW);
		expectHttpError(() => restoreAndAddDinnerDish(householdId, TODAY, theirs, 'main', NOW), 404);
		expect(getDish(otherId, theirs).archivedAt).toBe(NOW);
		expect(row(TODAY)).toBeUndefined();
	});
});

describe('changing a role', () => {
	it('moves the dish to its new place and marks the dinner changed', () => {
		makeDinner(
			householdId,
			TODAY,
			{ dishes: [[tacos, 'main'], [rice, 'side'], [salad, 'side']] },
			NOW
		);
		setDinnerDishRole(householdId, TODAY, salad, 'main', LATER);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Salad (main)', 'Rice (side)']);
		setDinnerDishRole(householdId, TODAY, tacos, 'other', LATER);
		expect(dishesOn(TODAY)).toEqual(['Salad (main)', 'Rice (side)', 'Tacos (other)']);
		expect(row(TODAY)?.updatedAt).toBe(LATER);
	});

	it('works for archived dishes still on the dinner', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		setDishArchived(householdId, rice, true, NOW);
		setDinnerDishRole(householdId, TODAY, rice, 'main', NOW);
		expect(dishesOn(TODAY)).toEqual(['Rice (main)']);
	});

	it("is not found for a dish not on the dinner, an unplanned date or another household's", () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, TOMORROW, { dishes: [[theirs, 'main']] });
		expectHttpError(() => setDinnerDishRole(householdId, TODAY, rice, 'side', LATER), 404);
		expectHttpError(() => setDinnerDishRole(householdId, TOMORROW, tacos, 'side', LATER), 404);
		expectHttpError(() => setDinnerDishRole(householdId, TOMORROW, theirs, 'side', LATER), 404);
		expect(dishesOn(TOMORROW, otherId)).toEqual(['Lasagna (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});
});

describe('removing a dish', () => {
	it('takes it off the dinner, keeping the dinner and the dish', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main'], [rice, 'side']] }, NOW);
		removeDinnerDish(householdId, TODAY, tacos, LATER);
		expect(dishesOn(TODAY)).toEqual(['Rice (side)']);
		removeDinnerDish(householdId, TODAY, rice, LATER);
		expect(getDinner(householdId, TODAY)).toMatchObject({ type: 'cook', dishes: [] });
		expect(row(TODAY)?.updatedAt).toBe(LATER);
		expect(dishCount()).toBe(4);
	});

	it("is not found for a dish not on the dinner, an unplanned date or another household's", () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, TOMORROW, { dishes: [[theirs, 'main']] });
		expectHttpError(() => removeDinnerDish(householdId, TODAY, rice, LATER), 404);
		expectHttpError(() => removeDinnerDish(householdId, TOMORROW, theirs, LATER), 404);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(dishesOn(TOMORROW, otherId)).toEqual(['Lasagna (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});
});

describe('clearing a dinner', () => {
	it('deletes the dinner and its dishes, but not the dishes themselves', () => {
		makeDinner(householdId, TODAY, { note: 'Busy', dishes: [[tacos, 'main'], [rice, 'side']] });
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		clearDinner(householdId, TODAY);
		expect(getDinner(householdId, TODAY)).toBeNull();
		expect(dinnerDishCount()).toBe(1);
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(dishCount()).toBe(4);
	});

	it("does nothing for an unplanned date, and never touches another household's", () => {
		makeDinner(otherId, TODAY, { note: 'Theirs' });
		clearDinner(householdId, TODAY);
		expect(getDinner(otherId, TODAY)?.note).toBe('Theirs');
	});
});

describe('moving a dinner (2.2.2)', () => {
	it('moves it to an unplanned date with its dishes', () => {
		const id = makeDinner(
			householdId,
			TODAY,
			{ type: 'going', note: 'Picnic', servings: 6, dishes: [[salad, 'side']] },
			NOW
		);
		moveDinner(householdId, TODAY, TOMORROW, LATER);
		expect(getDinner(householdId, TODAY)).toBeNull();
		expect(getDinner(householdId, TOMORROW)).toEqual({
			id,
			date: TOMORROW,
			type: 'going',
			note: 'Picnic',
			servings: 6,
			dishes: [{ dishId: salad, name: 'Salad', role: 'side', archived: false }]
		});
		expect(row(TOMORROW)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
	});

	it('swaps two dinners, and swaps them back', () => {
		const first = makeDinner(householdId, TODAY, { note: 'First', dishes: [[tacos, 'main']] }, NOW);
		const second = makeDinner(
			householdId,
			'2026-10-12',
			{ type: 'eat_out', note: 'Second' },
			NOW
		);
		moveDinner(householdId, TODAY, '2026-10-12', LATER);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			id: second,
			type: 'eat_out',
			note: 'Second',
			dishes: []
		});
		expect(getDinner(householdId, '2026-10-12')).toMatchObject({
			id: first,
			note: 'First',
			dishes: [{ dishId: tacos }]
		});
		expect(row(TODAY)?.updatedAt).toBe(LATER);
		expect(row('2026-10-12')?.updatedAt).toBe(LATER);

		moveDinner(householdId, TODAY, '2026-10-12', LATER);
		expect(getDinner(householdId, TODAY)?.id).toBe(first);
		expect(getDinner(householdId, '2026-10-12')?.id).toBe(second);
		expect(db().select().from(dinners).all()).toHaveLength(2);
	});

	it('changes nothing when moved to its own date', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		moveDinner(householdId, TODAY, TODAY, LATER);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});

	it('is not found when the date has no dinner', () => {
		makeDinner(householdId, TOMORROW);
		expectHttpError(() => moveDinner(householdId, TODAY, TOMORROW, NOW), 404);
		expect(row(TOMORROW)).toBeDefined();
	});

	it("never moves or swaps with another household's dinners", () => {
		makeDinner(otherId, TODAY, { note: 'Theirs today' });
		makeDinner(otherId, TOMORROW, { note: 'Theirs tomorrow' });
		expectHttpError(() => moveDinner(householdId, TODAY, TOMORROW, NOW), 404);

		makeDinner(householdId, TODAY, { note: 'Ours' });
		moveDinner(householdId, TODAY, TOMORROW, NOW);
		expect(getDinner(householdId, TOMORROW)?.note).toBe('Ours');
		expect(getDinner(householdId, TODAY)).toBeNull();
		expect(getDinner(otherId, TODAY)?.note).toBe('Theirs today');
		expect(getDinner(otherId, TOMORROW)?.note).toBe('Theirs tomorrow');
	});

	it('refuses a date that is not one', () => {
		makeDinner(householdId, TODAY);
		expectHttpError(() => moveDinner(householdId, TODAY, '2026-10-32', NOW), 400);
		expectHttpError(() => moveDinner(householdId, TODAY, 'moving', NOW), 400);
		expect(row(TODAY)).toBeDefined();
	});
});

describe('copy groups (6.9)', () => {
	it('groups dinners with exactly the same dishes, most made first, then most recent', () => {
		// Tacos and rice three times, in any order and with any roles.
		makeDinner(householdId, '2026-09-01', { dishes: [[tacos, 'main'], [rice, 'side']] });
		makeDinner(householdId, '2026-09-15', { dishes: [[rice, 'side'], [tacos, 'main']] });
		const lastTacos = makeDinner(householdId, '2026-09-29', {
			type: 'going',
			dishes: [[rice, 'main'], [tacos, 'side']]
		});
		// Tacos alone isn't the same set.
		makeDinner(householdId, '2026-10-01', { dishes: [[tacos, 'main']] });
		// Cake twice, last made before tacos alone.
		makeDinner(householdId, '2026-08-01', { dishes: [[cake, 'dessert']] });
		const lastCake = makeDinner(householdId, '2026-09-30', { dishes: [[cake, 'dessert']] });
		// Salad once, most recently of all.
		const lastSalad = makeDinner(householdId, '2026-10-05', {
			dishes: [[salad, 'main'], [cake, 'dessert']]
		});

		const groups = listCopyGroups(householdId, TODAY);
		expect(groups).toEqual([
			{
				dinnerId: lastTacos,
				// From the most recent dinner, in role order.
				dishes: [
					{ name: 'Rice', role: 'main' },
					{ name: 'Tacos', role: 'side' }
				],
				timesMade: 3,
				lastMade: '2026-09-29'
			},
			{
				dinnerId: lastCake,
				dishes: [{ name: 'Pound cake', role: 'dessert' }],
				timesMade: 2,
				lastMade: '2026-09-30'
			},
			{
				dinnerId: lastSalad,
				dishes: [
					{ name: 'Salad', role: 'main' },
					{ name: 'Pound cake', role: 'dessert' }
				],
				timesMade: 1,
				lastMade: '2026-10-05'
			},
			{
				dinnerId: expect.any(Number),
				dishes: [{ name: 'Tacos', role: 'main' }],
				timesMade: 1,
				lastMade: '2026-10-01'
			}
		]);
	});

	it('counts dinners up to today only (assumption 1)', () => {
		const today = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, '2026-10-20', { dishes: [[rice, 'main']] });
		expect(listCopyGroups(householdId, TODAY)).toEqual([
			{
				dinnerId: today,
				dishes: [{ name: 'Tacos', role: 'main' }],
				timesMade: 1,
				lastMade: TODAY
			}
		]);
		expect(listCopyGroups(householdId, '2026-10-06')).toEqual([]);
	});

	it('leaves out dinners without dishes', () => {
		makeDinner(householdId, '2026-10-01');
		makeDinner(householdId, '2026-10-02', { type: 'eat_out', note: 'Pizza' });
		makeDinner(householdId, '2026-10-03', { type: 'leftovers' });
		makeDinner(householdId, '2026-10-04', { type: 'going' });
		expect(listCopyGroups(householdId, TODAY)).toEqual([]);
	});

	it('groups by the dishes that are not archived, and lists only those', () => {
		makeDinner(householdId, '2026-09-01', { dishes: [[tacos, 'main']] });
		const last = makeDinner(householdId, '2026-09-08', {
			dishes: [[tacos, 'main'], [rice, 'side']]
		});
		// Only archived dishes leaves nothing to copy.
		makeDinner(householdId, '2026-09-10', { dishes: [[rice, 'main']] });
		setDishArchived(householdId, rice, true, NOW);
		expect(listCopyGroups(householdId, TODAY)).toEqual([
			{
				dinnerId: last,
				dishes: [{ name: 'Tacos', role: 'main' }],
				timesMade: 2,
				lastMade: '2026-09-08'
			}
		]);
	});

	it("lists only the household's own dinners", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, '2026-10-01', { dishes: [[theirs, 'main']] });
		expect(listCopyGroups(householdId, TODAY)).toEqual([]);
		expect(listCopyGroups(otherId, TODAY)).toHaveLength(1);
	});
});

describe('copying a dinner', () => {
	let source: number;

	beforeEach(() => {
		source = makeDinner(householdId, '2026-09-30', {
			type: 'going',
			note: 'Potluck',
			servings: 10,
			dishes: [
				[cake, 'dessert'],
				[tacos, 'main'],
				[rice, 'other'],
				[salad, 'side']
			]
		});
	});

	it('plans an unplanned date with the type, dishes and roles, at the usual servings (2.3)', () => {
		copyDinner(householdId, TODAY, source, NOW);
		expect(getDinner(householdId, TODAY)).toEqual({
			id: expect.any(Number),
			date: TODAY,
			type: 'going',
			note: null,
			servings: 3,
			dishes: [
				{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
				{ dishId: salad, name: 'Salad', role: 'side', archived: false },
				{ dishId: cake, name: 'Pound cake', role: 'dessert', archived: false },
				{ dishId: rice, name: 'Rice', role: 'other', archived: false }
			]
		});
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
		// The source doesn't change.
		expect(getDinner(householdId, '2026-09-30')?.dishes).toHaveLength(4);
	});

	it("replaces the date's type and dishes, keeping its note and servings", () => {
		const soup = makeDish(householdId, recipe('Soup'));
		const id = makeDinner(
			householdId,
			TODAY,
			{ type: 'cook', note: 'Early', servings: 2, dishes: [[soup, 'main'], [tacos, 'side']] },
			NOW
		);
		copyDinner(householdId, TODAY, source, LATER);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			id,
			type: 'going',
			note: 'Early',
			servings: 2
		});
		expect(dishesOn(TODAY)).toEqual([
			'Tacos (main)',
			'Salad (side)',
			'Pound cake (dessert)',
			'Rice (other)'
		]);
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
	});

	it('turns a dinner without dishes into one with them', () => {
		makeDinner(householdId, TODAY, { type: 'leftovers', note: 'Fridge' });
		copyDinner(householdId, TODAY, source, NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({ type: 'going', note: 'Fridge' });
		expect(getDinner(householdId, TODAY)?.dishes).toHaveLength(4);
	});

	it("doesn't copy archived dishes", () => {
		setDishArchived(householdId, rice, true, NOW);
		setDishArchived(householdId, cake, true, NOW);
		copyDinner(householdId, TODAY, source, NOW);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Salad (side)']);
	});

	it('copies the type of a dinner without dishes', () => {
		const out = makeDinner(householdId, '2026-10-01', { type: 'eat_out', note: 'Thai' });
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		copyDinner(householdId, TODAY, out, NOW);
		expect(getDinner(householdId, TODAY)).toMatchObject({
			type: 'eat_out',
			note: null,
			dishes: []
		});
	});

	it('changes nothing when a dinner is copied onto itself', () => {
		setDishArchived(householdId, rice, true, NOW);
		copyDinner(householdId, '2026-09-30', source, LATER);
		expect(getDinner(householdId, '2026-09-30')?.dishes).toHaveLength(4);
		expect(row('2026-09-30')?.updatedAt).toBe(0);
	});

	it("refuses another household's dinner or one that doesn't exist", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		const theirDinner = makeDinner(otherId, '2026-10-01', { dishes: [[theirs, 'main']] });
		expectHttpError(() => copyDinner(householdId, TODAY, theirDinner, NOW), 404);
		expectHttpError(() => copyDinner(householdId, TODAY, 9999, NOW), 404);
		expect(row(TODAY)).toBeUndefined();
	});

	it('refuses a date that is not one', () => {
		expectHttpError(() => copyDinner(householdId, '2026-9-30', source, NOW), 400);
		expect(db().select().from(dinners).all()).toHaveLength(1);
	});
});

describe('dish suggestions', () => {
	it('lists active dishes with how many dinners use each, most first', () => {
		makeDish(householdId, recipe('Apple pie', { ingredients: [ingredient('Apples', 6)] }));
		makeDinner(householdId, '2026-09-01', { dishes: [[rice, 'side'], [tacos, 'main']] });
		makeDinner(householdId, '2026-09-02', { dishes: [[rice, 'side']] });
		makeDinner(householdId, '2026-10-20', { dishes: [[rice, 'side'], [cake, 'dessert']] });
		setDishArchived(householdId, cake, true, NOW);
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, '2026-09-01', { dishes: [[theirs, 'main']] });

		expect(dishSuggestions(householdId)).toEqual([
			{ id: rice, name: 'Rice', timesAdded: 3 },
			{ id: tacos, name: 'Tacos', timesAdded: 1 },
			{ id: expect.any(Number), name: 'Apple pie', timesAdded: 0 },
			{ id: salad, name: 'Salad', timesAdded: 0 }
		]);
	});
});
