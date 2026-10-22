import { isHttpError } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DinnerType, DishRole } from '../../menu.ts';
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
	addDinner,
	getDay,
	getDinners,
	listCopyGroups,
	moveDinners,
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

/** The date's only dinner, or null when it has none. */
function dinnerOn(household: number, date: string) {
	const day = getDay(household, date);
	expect(day.length).toBeLessThanOrEqual(1);
	return day[0] ?? null;
}

/** The id of the date's first dinner, as a page showing it sends it, or null for none. */
function current(date: string, household = householdId): number | null {
	return getDay(household, date)[0]?.id ?? null;
}

/** Saves the date's first dinner as a page showing it would, or plans the date. */
function save(
	date: string,
	fields: { label?: string | null; type: DinnerType; note: string | null; servings: number },
	now: number,
	household = householdId
): number {
	return saveDinner(household, date, current(date, household), { label: null, ...fields }, now);
}

// Changes to the date's first dinner, as a page showing it sends them.

function addDish(
	date: string,
	dish: { id: number } | { name: string },
	role: DishRole,
	now: number
) {
	return addDinnerDish(householdId, date, current(date), dish, role, now);
}

function restoreAndAdd(date: string, dishId: number, role: DishRole, now: number): void {
	restoreAndAddDinnerDish(householdId, date, current(date), dishId, role, now);
}

/** A date with no dinner sends an id no dinner has. */
function setRole(date: string, dishId: number, role: DishRole, now: number): void {
	setDinnerDishRole(householdId, date, current(date) ?? 0, dishId, role, now);
}

function removeDish(date: string, dishId: number, now: number): void {
	removeDinnerDish(householdId, date, current(date) ?? 0, dishId, now);
}

function copyOnto(date: string, sourceId: number, now: number): void {
	copyDinner(householdId, date, current(date), sourceId, now);
}

/** The dinner's dishes as "Name (role)", in the order the dinner lists them. */
function dishesOn(date: string, household = householdId): string[] | undefined {
	return dinnerOn(household, date)?.dishes.map((dish) => `${dish.name} (${dish.role})`);
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
		save(TODAY, { type: 'eat_out', note: 'Thai place', servings: 2 }, NOW);
		expect(dinnerOn(householdId, TODAY)).toEqual({
			id: expect.any(Number),
			date: TODAY,
			label: null,
			type: 'eat_out',
			note: 'Thai place',
			servings: 2,
			dishes: []
		});
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
	});

	it('updates the dinner already on the date', () => {
		const id = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		save(TODAY, { type: 'going', note: "At Grandma's", servings: 7 }, LATER);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
			id,
			type: 'going',
			note: "At Grandma's",
			servings: 7
		});
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
		expect(db().select().from(dinners).all()).toHaveLength(1);

		save(TODAY, { type: 'cook', note: null, servings: 7 }, LATER);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type: 'cook', note: null });
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
	});

	it.each(['eat_out', 'leftovers'] as const)('removes the dishes when it becomes %s', (type) => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main'], [rice, 'side']] });
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		save(TODAY, { type, note: 'Full', servings: 4 }, NOW);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type, note: 'Full', dishes: [] });
		// Only that dinner's, and the dishes themselves stay.
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(dishCount()).toBe(4);
	});

	it('takes 1 to 100 whole servings and a note up to 2500 characters', () => {
		save(TODAY, { type: 'cook', note: 'x'.repeat(2500), servings: 100 }, NOW);
		save(TOMORROW, { type: 'cook', note: null, servings: 1 }, NOW);
		expect(dinnerOn(householdId, TODAY)?.servings).toBe(100);
		expect(dinnerOn(householdId, TOMORROW)?.servings).toBe(1);
	});

	it('refuses servings out of range, a long note and a date that is not one', () => {
		const trySave = (fields: { note?: string | null; servings?: number }, date = TODAY) => () =>
			save(date, { type: 'cook', note: null, servings: 4, ...fields }, NOW);
		expectHttpError(trySave({ servings: 0 }), 400);
		expectHttpError(trySave({ servings: 101 }), 400);
		expectHttpError(trySave({ servings: 2.5 }), 400);
		expectHttpError(trySave({ servings: Number.NaN }), 400);
		expectHttpError(trySave({ note: 'x'.repeat(2501) }), 400);
		expectHttpError(trySave({}, '2026-02-30'), 400);
		expectHttpError(trySave({}, 'today'), 400);
		expect(db().select().from(dinners).all()).toEqual([]);
		expect(refusal(trySave({ servings: 0 }))).toBe('Enter at least 1 serving');
		expect(refusal(trySave({ servings: 101 }))).toBe('Enter 100 servings or fewer');
		expect(refusal(trySave({ servings: 2.5 }))).toBe('Enter a whole number of servings');
		expect(refusal(trySave({ note: 'x'.repeat(2501) }))).toBe('Keep the note under 2500 characters');
	});

	it("keeps each household's dinners apart", () => {
		save(TODAY, { type: 'cook', note: 'Ours', servings: 3 }, NOW);
		save(TODAY, { type: 'eat_out', note: 'Theirs', servings: 2 }, NOW, otherId);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type: 'cook', note: 'Ours' });
		expect(dinnerOn(otherId, TODAY)).toMatchObject({ type: 'eat_out', note: 'Theirs' });
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
				label: null,
				type: 'going',
				note: 'Picnic',
				servings: 4,
				dishes: []
			},
			{
				id: expect.any(Number),
				date: '2026-10-07',
				label: null,
				type: 'cook',
				note: null,
				servings: 5,
				dishes: []
			},
			{
				id: expect.any(Number),
				date: '2026-10-10',
				label: null,
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
		expect(dinnerOn(householdId, TODAY)?.dishes).toEqual([
			{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
			{ dishId: rice, name: 'Rice', role: 'side', archived: true }
		]);
	});

	it('gives null for an unplanned date', () => {
		makeDinner(otherId, TODAY);
		expect(dinnerOn(householdId, TODAY)).toBeNull();
	});
});

describe('adding a dish', () => {
	it('adds an existing dish to the dinner and marks the dinner changed', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		expect(addDish(TODAY, { id: rice }, 'side', LATER)).toEqual({
			kind: 'added'
		});
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Rice (side)']);
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: LATER });
	});

	it('plans an unplanned date as Cooking at home at the usual servings', () => {
		addDish(TODAY, { id: tacos }, 'main', NOW);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
			type: 'cook',
			note: null,
			servings: 3,
			dishes: [{ dishId: tacos, name: 'Tacos', role: 'main', archived: false }]
		});
		expect(row(TODAY)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
	});

	it('adds dishes to a Bringing a dish dinner', () => {
		makeDinner(householdId, TODAY, { type: 'going' });
		addDish(TODAY, { id: salad }, 'side', NOW);
		expect(dishesOn(TODAY)).toEqual(['Salad (side)']);
	});

	it('finds a dish by name ignoring case and spacing', () => {
		addDish(TODAY, { name: '  pound   CAKE ' }, 'dessert', NOW);
		expect(dishesOn(TODAY)).toEqual(['Pound cake (dessert)']);
		expect(dinnerOn(householdId, TODAY)?.dishes[0]?.dishId).toBe(cake);
		expect(dishCount()).toBe(4);
	});

	it('makes a new dish from a new name, with the usual servings and no recipe (2.3)', () => {
		addDish(TODAY, { name: ' Garlic   bread ' }, 'side', NOW);
		const added = dinnerOn(householdId, TODAY)?.dishes[0];
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
		const filter = { search: 'garlic', tag: null, archived: false, sort: 'name' } as const;
		expect(listDishes(householdId, filter)).toEqual([
			expect.objectContaining({ name: 'Garlic bread', hasRecipe: false })
		]);
	});

	it("uses this household's dishes only; another's name is new here", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		addDish(TODAY, { name: 'lasagna' }, 'main', NOW);
		const added = dinnerOn(householdId, TODAY)?.dishes[0];
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
		expectHttpError(() => addDish(TODAY, { id: theirs }, 'main', NOW), 404);
		expectHttpError(() => addDish(TODAY, { id: 9999 }, 'main', NOW), 404);
		expect(row(TODAY)).toBeUndefined();
	});

	it.each(['eat_out', 'leftovers'] as const)('refuses a %s dinner', (type) => {
		makeDinner(householdId, TODAY, { type }, NOW);
		expectHttpError(() => addDish(TODAY, { id: tacos }, 'main', LATER), 400);
		expectHttpError(
			() => addDish(TODAY, { name: 'Brand new' }, 'main', LATER),
			400
		);
		expect(dinnerOn(householdId, TODAY)?.dishes).toEqual([]);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
		expect(dishCount()).toBe(4);
	});

	it('refuses a dish that is already on the dinner, by id or by name', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		expectHttpError(() => addDish(TODAY, { id: tacos }, 'side', LATER), 400);
		expectHttpError(() => addDish(TODAY, { name: 'TACOS' }, 'side', LATER), 400);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});

	it('tells the person what to do', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, TOMORROW, { type: 'eat_out' });
		setDishArchived(householdId, rice, true, NOW);
		const add = (dish: { id: number } | { name: string }, date = TODAY) => () =>
			addDish(date, dish, 'side', NOW);
		expect(refusal(add({ name: 'tacos' }))).toBe('Tacos is already on this dinner');
		expect(refusal(add({ id: rice }))).toBe('Restore Rice before adding it');
		expect(refusal(add({ id: salad }, TOMORROW))).toBe(
			'Switch to Cooking at home or Bringing a dish to add dishes'
		);
		expect(refusal(add({ name: ' ' }))).toBe('Enter a dish name');
		expect(refusal(add({ name: 'x'.repeat(81) }))).toBe('Keep a dish name under 80 characters');
		expect(refusal(add({ id: salad }, 'someday'))).toBe('Pick a date');
	});

	it('refuses an archived dish by id', () => {
		setDishArchived(householdId, rice, true, NOW);
		expectHttpError(() => addDish(TODAY, { id: rice }, 'side', NOW), 400);
		expect(row(TODAY)).toBeUndefined();
	});

	it('offers to restore an archived dish typed by name, changing nothing (6.10)', () => {
		setDishArchived(householdId, rice, true, NOW);
		expect(addDish(TODAY, { name: 'RICE' }, 'side', LATER)).toEqual({
			kind: 'archived',
			dishId: rice,
			name: 'Rice'
		});
		expect(row(TODAY)).toBeUndefined();
		expect(getDish(householdId, rice).archivedAt).toBe(NOW);
		expect(dishCount()).toBe(4);

		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] }, NOW);
		expect(addDish(TOMORROW, { name: 'rice' }, 'side', LATER).kind).toBe(
			'archived'
		);
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(row(TOMORROW)?.updatedAt).toBe(NOW);
	});

	it('says an archived dish typed by name is already there when it is', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		setDishArchived(householdId, rice, true, NOW);
		expectHttpError(() => addDish(TODAY, { name: 'Rice' }, 'side', NOW), 400);
	});

	it('refuses a blank name or one over 80 characters', () => {
		expectHttpError(() => addDish(TODAY, { name: '   ' }, 'main', NOW), 400);
		expectHttpError(
			() => addDish(TODAY, { name: 'x'.repeat(81) }, 'main', NOW),
			400
		);
		expect(row(TODAY)).toBeUndefined();
		expect(dishCount()).toBe(4);
		addDish(TODAY, { name: `${'x'.repeat(80)}  ` }, 'main', NOW);
		expect(dinnerOn(householdId, TODAY)?.dishes[0]?.name).toBe('x'.repeat(80));
	});

	it('refuses a date that is not one', () => {
		expectHttpError(() => addDish('2026-13-01', { id: rice }, 'side', NOW), 400);
		expectHttpError(() => addDish('', { name: 'New' }, 'side', NOW), 400);
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
		restoreAndAdd(TODAY, rice, 'side', LATER);
		expect(getDish(householdId, rice).archivedAt).toBeNull();
		expect(dinnerOn(householdId, TODAY)?.dishes).toEqual([
			{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
			{ dishId: rice, name: 'Rice', role: 'side', archived: false }
		]);
		expect(row(TODAY)?.updatedAt).toBe(LATER);
	});

	it('plans an unplanned date as Cooking at home', () => {
		restoreAndAdd(TODAY, rice, 'main', NOW);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
			type: 'cook',
			servings: 3,
			dishes: [{ dishId: rice, role: 'main' }]
		});
	});

	it('adds a dish someone already restored', () => {
		setDishArchived(householdId, rice, false, NOW);
		restoreAndAdd(TODAY, rice, 'side', NOW);
		expect(dishesOn(TODAY)).toEqual(['Rice (side)']);
	});

	it('leaves the dish archived when it cannot be added', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		makeDinner(householdId, TOMORROW, { type: 'leftovers' });
		expectHttpError(() => restoreAndAdd(TODAY, rice, 'main', LATER), 400);
		expectHttpError(() => restoreAndAdd(TOMORROW, rice, 'main', LATER), 400);
		expectHttpError(() => restoreAndAdd('soon', rice, 'main', LATER), 400);
		expect(getDish(householdId, rice).archivedAt).toBe(NOW);
		expect(dishesOn(TOMORROW)).toEqual([]);
	});

	it("refuses another household's dish", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		setDishArchived(otherId, theirs, true, NOW);
		expectHttpError(() => restoreAndAdd(TODAY, theirs, 'main', NOW), 404);
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
		setRole(TODAY, salad, 'main', LATER);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Salad (main)', 'Rice (side)']);
		setRole(TODAY, tacos, 'other', LATER);
		expect(dishesOn(TODAY)).toEqual(['Salad (main)', 'Rice (side)', 'Tacos (other)']);
		expect(row(TODAY)?.updatedAt).toBe(LATER);
	});

	it('works for archived dishes still on the dinner', () => {
		makeDinner(householdId, TODAY, { dishes: [[rice, 'side']] });
		setDishArchived(householdId, rice, true, NOW);
		setRole(TODAY, rice, 'main', NOW);
		expect(dishesOn(TODAY)).toEqual(['Rice (main)']);
	});

	it("is not found for a dish not on the dinner, an unplanned date or another household's", () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, TOMORROW, { dishes: [[theirs, 'main']] });
		expectHttpError(() => setRole(TODAY, rice, 'side', LATER), 404);
		expectHttpError(() => setRole(TOMORROW, tacos, 'side', LATER), 404);
		expectHttpError(() => setRole(TOMORROW, theirs, 'side', LATER), 404);
		expect(dishesOn(TOMORROW, otherId)).toEqual(['Lasagna (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});
});

describe('removing a dish', () => {
	it('takes it off the dinner, keeping the dinner and the dish', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main'], [rice, 'side']] }, NOW);
		removeDish(TODAY, tacos, LATER);
		expect(dishesOn(TODAY)).toEqual(['Rice (side)']);
		removeDish(TODAY, rice, LATER);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type: 'cook', dishes: [] });
		expect(row(TODAY)?.updatedAt).toBe(LATER);
		expect(dishCount()).toBe(4);
	});

	it("is not found for a dish not on the dinner, an unplanned date or another household's", () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		const theirs = makeDish(otherId, recipe('Lasagna'));
		makeDinner(otherId, TOMORROW, { dishes: [[theirs, 'main']] });
		expectHttpError(() => removeDish(TODAY, rice, LATER), 404);
		expectHttpError(() => removeDish(TOMORROW, theirs, LATER), 404);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(dishesOn(TOMORROW, otherId)).toEqual(['Lasagna (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});
});

describe('clearing a dinner', () => {
	it('deletes the dinner and its dishes, but not the dishes themselves', () => {
		makeDinner(householdId, TODAY, { note: 'Busy', dishes: [[tacos, 'main'], [rice, 'side']] });
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		clearDinner(householdId, TODAY, current(TODAY), NOW);
		expect(dinnerOn(householdId, TODAY)).toBeNull();
		expect(dinnerDishCount()).toBe(1);
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(dishCount()).toBe(4);
	});

	it("does nothing for an unplanned date, and never touches another household's", () => {
		makeDinner(otherId, TODAY, { note: 'Theirs' });
		clearDinner(householdId, TODAY, current(TODAY), NOW);
		expect(dinnerOn(otherId, TODAY)?.note).toBe('Theirs');
	});
});

describe('more than one dinner on a date (6.9)', () => {
	/** The date's dinners as "Label: type", in the order they were added. */
	function labelsOn(date: string, household = householdId): string[] {
		return getDay(household, date).map((dinner) => `${dinner.label}: ${dinner.type}`);
	}

	it('adds a dinner and labels both, starting it as Cooking at home at the usual servings', () => {
		const first = makeDinner(householdId, TODAY, { type: 'eat_out', note: 'Thai', servings: 2 });
		const added = addDinner(householdId, TODAY, { first: ' Adults ', added: 'Kids' }, LATER);
		expect(getDay(householdId, TODAY)).toEqual([
			{
				id: first,
				date: TODAY,
				label: 'Adults',
				type: 'eat_out',
				note: 'Thai',
				servings: 2,
				dishes: []
			},
			{
				id: added,
				date: TODAY,
				label: 'Kids',
				type: 'cook',
				note: null,
				servings: 3,
				dishes: []
			}
		]);
		expect(row(TODAY)).toMatchObject({ updatedAt: LATER });
		addDinner(householdId, TODAY, { first: null, added: 'Guests' }, LATER);
		expect(labelsOn(TODAY)).toEqual(['Adults: eat_out', 'Kids: cook', 'Guests: cook']);
	});

	it('refuses a sixth dinner and a date that is not planned', () => {
		makeDinner(householdId, TODAY);
		addDinner(householdId, TODAY, { first: 'One', added: 'Two' }, NOW);
		for (const label of ['Three', 'Four', 'Five']) {
			addDinner(householdId, TODAY, { first: null, added: label }, NOW);
		}
		expect(refusal(() => addDinner(householdId, TODAY, { first: null, added: 'Six' }, NOW))).toBe(
			'A day can have up to 5 dinners'
		);
		expect(getDay(householdId, TODAY)).toHaveLength(5);
		expect(refusal(() => addDinner(householdId, TOMORROW, { first: null, added: 'Kids' }, NOW))).toBe(
			'Plan this date before adding another dinner'
		);
		makeDinner(otherId, TOMORROW);
		expectHttpError(() => addDinner(householdId, TOMORROW, { first: 'A', added: 'B' }, NOW), 400);
		expect(getDay(householdId, TOMORROW)).toEqual([]);
	});

	it('refuses a missing, long or repeated label, ignoring case and spacing', () => {
		makeDinner(householdId, TODAY);
		const add = (first: string | null, added: string) => () =>
			addDinner(householdId, TODAY, { first, added }, NOW);
		expect(refusal(add(' ', 'Kids'))).toBe('Enter a label for each dinner');
		expect(refusal(add('Adults', ''))).toBe('Enter a label for each dinner');
		expect(refusal(add('Adults', 'x'.repeat(31)))).toBe('Keep a label under 30 characters');
		expect(refusal(add('Kids', ' KIDS'))).toBe('Give each dinner on this day a different label');
		expect(getDay(householdId, TODAY).map((dinner) => dinner.label)).toEqual([null]);

		addDinner(householdId, TODAY, { first: 'x'.repeat(30), added: 'Big   kids' }, NOW);
		expect(refusal(add(null, 'big kids'))).toBe('Give each dinner on this day a different label');
		expect(getDay(householdId, TODAY).map((dinner) => dinner.label)).toEqual([
			'x'.repeat(30),
			'Big kids'
		]);
	});

	it("refuses an add from a page that didn't show the date's dinners as they are", () => {
		makeDinner(householdId, TODAY);
		// The page showed two dinners, but now there's one: it asks for no first label.
		expect(refusal(() => addDinner(householdId, TODAY, { first: null, added: 'Kids' }, NOW))).toBe(
			'Someone changed this dinner since you opened it.'
		);
		addDinner(householdId, TODAY, { first: 'Adults', added: 'Kids' }, NOW);
		// The page showed one dinner, but now there are two.
		expectHttpError(
			() => addDinner(householdId, TODAY, { first: 'Grown-ups', added: 'Guests' }, NOW),
			400
		);
		expect(labelsOn(TODAY)).toEqual(['Adults: cook', 'Kids: cook']);
	});

	it('needs a label on each dinner of a date with more than one, unlike the others', () => {
		makeDinner(householdId, TODAY);
		addDinner(householdId, TODAY, { first: 'Adults', added: 'Kids' }, NOW);
		const [adults, kids] = getDay(householdId, TODAY).map((dinner) => dinner.id);
		const saveKids = (label: string | null) => () =>
			saveDinner(
				householdId,
				TODAY,
				kids ?? 0,
				{ label, type: 'eat_out', note: 'Pizza', servings: 2 },
				LATER
			);
		expect(refusal(saveKids(null))).toBe('Enter a label for each dinner');
		expect(refusal(saveKids('  '))).toBe('Enter a label for each dinner');
		expect(refusal(saveKids('ADULTS'))).toBe('Give each dinner on this day a different label');
		expect(refusal(saveKids('x'.repeat(31)))).toBe('Keep a label under 30 characters');

		expect(saveKids(' Little  ones ')()).toBe(kids);
		expect(getDay(householdId, TODAY)).toMatchObject([
			{ id: adults, label: 'Adults', type: 'cook', note: null },
			{ id: kids, label: 'Little ones', type: 'eat_out', note: 'Pizza', servings: 2 }
		]);
	});

	it('changes only the dinner it names', () => {
		const adults = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		const kids = addDinner(householdId, TODAY, { first: 'Adults', added: 'Kids' }, NOW);
		addDinnerDish(householdId, TODAY, kids, { name: 'Rice' }, 'main', LATER);
		addDinnerDish(householdId, TODAY, kids, { id: tacos }, 'side', LATER);
		setDinnerDishRole(householdId, TODAY, kids, tacos, 'other', LATER);
		removeDinnerDish(householdId, TODAY, kids, rice, LATER);
		const past = makeDinner(householdId, '2026-09-01', { dishes: [[cake, 'dessert']] });
		copyDinner(householdId, TODAY, adults, past, LATER);
		const [first, second] = getDay(householdId, TODAY);
		expect(first?.dishes.map((dish) => `${dish.name} (${dish.role})`)).toEqual([
			'Pound cake (dessert)'
		]);
		expect(second?.dishes.map((dish) => `${dish.name} (${dish.role})`)).toEqual(['Tacos (other)']);
		expect([first?.label, second?.label]).toEqual(['Adults', 'Kids']);
	});

	it('refuses a change for a dinner gone from a date with others, and plans an empty one', () => {
		const moved = makeDinner(householdId, TODAY);
		makeDinner(householdId, TOMORROW);
		moveDinners(householdId, TODAY, TOMORROW, moved, NOW);
		const fields = { label: null, type: 'cook' as const, note: 'Hi', servings: 2 };
		const changed = 'Someone changed this dinner since you opened it.';
		// A page still showing it, now that another dinner is on the date.
		expect(refusal(() => saveDinner(householdId, TODAY, moved, fields, NOW))).toBe(changed);
		expect(refusal(() => saveDinner(householdId, TODAY, null, fields, NOW))).toBe(changed);
		expect(refusal(() => addDinnerDish(householdId, TODAY, null, { id: rice }, 'main', NOW))).toBe(
			changed
		);
		expect(refusal(() => clearDinner(householdId, TODAY, moved, NOW))).toBe(changed);
		expectHttpError(() => setDinnerDishRole(householdId, TODAY, moved, rice, 'main', NOW), 404);
		expect(getDay(householdId, TODAY)).toHaveLength(1);

		// The dinner on a date with none left plans it again.
		const replanned = saveDinner(householdId, '2026-10-20', moved, fields, NOW);
		expect(replanned).not.toBe(moved);
		expect(getDay(householdId, '2026-10-20')).toMatchObject([{ id: replanned, note: 'Hi' }]);
	});

	it('clears only that dinner, and the last one left loses its label', () => {
		const adults = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		const kids = addDinner(householdId, TODAY, { first: 'Adults', added: 'Kids' }, NOW);
		const guests = addDinner(householdId, TODAY, { first: null, added: 'Guests' }, NOW);
		clearDinner(householdId, TODAY, adults, LATER);
		expect(labelsOn(TODAY)).toEqual(['Kids: cook', 'Guests: cook']);
		expect(dinnerDishCount()).toBe(0);
		clearDinner(householdId, TODAY, guests, LATER);
		expect(getDay(householdId, TODAY)).toMatchObject([{ id: kids, label: null }]);
		expect(row(TODAY)?.updatedAt).toBe(LATER);
	});

	it("moves all of a date's dinners, swapping with every dinner on the other date (2.2.2)", () => {
		const adults = makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		const kids = addDinner(householdId, TODAY, { first: 'Adults', added: 'Kids' }, NOW);
		const other = makeDinner(householdId, TOMORROW);
		const second = addDinner(householdId, TOMORROW, { first: 'Kids', added: 'Grandma' }, NOW);
		const third = addDinner(householdId, TOMORROW, { first: null, added: 'Guests' }, NOW);
		makeDinner(otherId, TOMORROW);

		moveDinners(householdId, TODAY, TOMORROW, kids, LATER);
		expect(getDay(householdId, TOMORROW).map((dinner) => dinner.id)).toEqual([adults, kids]);
		expect(getDay(householdId, TODAY).map((dinner) => dinner.id)).toEqual([other, second, third]);
		expect(labelsOn(TOMORROW)).toEqual(['Adults: cook', 'Kids: cook']);
		expect(getDay(householdId, TOMORROW)[0]?.dishes).toHaveLength(1);
		expect(getDay(otherId, TOMORROW)).toHaveLength(1);

		moveDinners(householdId, TODAY, '2026-10-20', third, LATER);
		expect(getDay(householdId, TODAY)).toEqual([]);
		expect(labelsOn('2026-10-20')).toEqual(['Kids: cook', 'Grandma: cook', 'Guests: cook']);
	});

	it('counts each dinner separately for Copy a dinner', () => {
		makeDinner(householdId, '2026-10-01', { dishes: [[tacos, 'main']] });
		addDinner(householdId, '2026-10-01', { first: 'Adults', added: 'Kids' }, NOW);
		const kids = getDay(householdId, '2026-10-01')[1]?.id ?? 0;
		addDinnerDish(householdId, '2026-10-01', kids, { id: rice }, 'main', NOW);
		makeDinner(householdId, '2026-10-02', { dishes: [[tacos, 'main']] });
		expect(listCopyGroups(householdId, TODAY)).toEqual([
			{
				dinnerId: expect.any(Number),
				dishes: [{ name: 'Tacos', role: 'main' }],
				timesMade: 2,
				lastMade: '2026-10-02'
			},
			{
				dinnerId: kids,
				dishes: [{ name: 'Rice', role: 'main' }],
				timesMade: 1,
				lastMade: '2026-10-01'
			}
		]);
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
		moveDinners(householdId, TODAY, TOMORROW, current(TODAY), LATER);
		expect(dinnerOn(householdId, TODAY)).toBeNull();
		expect(dinnerOn(householdId, TOMORROW)).toEqual({
			id,
			date: TOMORROW,
			label: null,
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
		moveDinners(householdId, TODAY, '2026-10-12', current(TODAY), LATER);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
			id: second,
			type: 'eat_out',
			note: 'Second',
			dishes: []
		});
		expect(dinnerOn(householdId, '2026-10-12')).toMatchObject({
			id: first,
			note: 'First',
			dishes: [{ dishId: tacos }]
		});
		expect(row(TODAY)?.updatedAt).toBe(LATER);
		expect(row('2026-10-12')?.updatedAt).toBe(LATER);

		moveDinners(householdId, TODAY, '2026-10-12', current(TODAY), LATER);
		expect(dinnerOn(householdId, TODAY)?.id).toBe(first);
		expect(dinnerOn(householdId, '2026-10-12')?.id).toBe(second);
		expect(db().select().from(dinners).all()).toHaveLength(2);
	});

	it('changes nothing when moved to its own date', () => {
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] }, NOW);
		moveDinners(householdId, TODAY, TODAY, current(TODAY), LATER);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)']);
		expect(row(TODAY)?.updatedAt).toBe(NOW);
	});

	it('is not found when the date has no dinner', () => {
		makeDinner(householdId, TOMORROW);
		expectHttpError(() => moveDinners(householdId, TODAY, TOMORROW, current(TODAY), NOW), 404);
		expect(row(TOMORROW)).toBeDefined();
	});

	it("never moves or swaps with another household's dinners", () => {
		makeDinner(otherId, TODAY, { note: 'Theirs today' });
		makeDinner(otherId, TOMORROW, { note: 'Theirs tomorrow' });
		expectHttpError(() => moveDinners(householdId, TODAY, TOMORROW, current(TODAY), NOW), 404);

		makeDinner(householdId, TODAY, { note: 'Ours' });
		moveDinners(householdId, TODAY, TOMORROW, current(TODAY), NOW);
		expect(dinnerOn(householdId, TOMORROW)?.note).toBe('Ours');
		expect(dinnerOn(householdId, TODAY)).toBeNull();
		expect(dinnerOn(otherId, TODAY)?.note).toBe('Theirs today');
		expect(dinnerOn(otherId, TOMORROW)?.note).toBe('Theirs tomorrow');
	});

	it('refuses a date that is not one', () => {
		makeDinner(householdId, TODAY);
		expectHttpError(() => moveDinners(householdId, TODAY, '2026-10-32', current(TODAY), NOW), 400);
		expectHttpError(() => moveDinners(householdId, TODAY, 'moving', current(TODAY), NOW), 400);
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
		copyOnto(TODAY, source, NOW);
		expect(dinnerOn(householdId, TODAY)).toEqual({
			id: expect.any(Number),
			date: TODAY,
			label: null,
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
		expect(dinnerOn(householdId, '2026-09-30')?.dishes).toHaveLength(4);
	});

	it("replaces the date's type and dishes, keeping its note and servings", () => {
		const soup = makeDish(householdId, recipe('Soup'));
		const id = makeDinner(
			householdId,
			TODAY,
			{ type: 'cook', note: 'Early', servings: 2, dishes: [[soup, 'main'], [tacos, 'side']] },
			NOW
		);
		copyOnto(TODAY, source, LATER);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
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
		copyOnto(TODAY, source, NOW);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type: 'going', note: 'Fridge' });
		expect(dinnerOn(householdId, TODAY)?.dishes).toHaveLength(4);
	});

	it("doesn't copy archived dishes", () => {
		setDishArchived(householdId, rice, true, NOW);
		setDishArchived(householdId, cake, true, NOW);
		copyOnto(TODAY, source, NOW);
		expect(dishesOn(TODAY)).toEqual(['Tacos (main)', 'Salad (side)']);
	});

	it('copies the type of a dinner without dishes', () => {
		const out = makeDinner(householdId, '2026-10-01', { type: 'eat_out', note: 'Thai' });
		makeDinner(householdId, TODAY, { dishes: [[tacos, 'main']] });
		copyOnto(TODAY, out, NOW);
		expect(dinnerOn(householdId, TODAY)).toMatchObject({
			type: 'eat_out',
			note: null,
			dishes: []
		});
	});

	it('changes nothing when a dinner is copied onto itself', () => {
		setDishArchived(householdId, rice, true, NOW);
		copyOnto('2026-09-30', source, LATER);
		expect(dinnerOn(householdId, '2026-09-30')?.dishes).toHaveLength(4);
		expect(row('2026-09-30')?.updatedAt).toBe(0);
	});

	it("refuses another household's dinner or one that doesn't exist", () => {
		const theirs = makeDish(otherId, recipe('Lasagna'));
		const theirDinner = makeDinner(otherId, '2026-10-01', { dishes: [[theirs, 'main']] });
		expectHttpError(() => copyOnto(TODAY, theirDinner, NOW), 404);
		expectHttpError(() => copyOnto(TODAY, 9999, NOW), 404);
		expect(row(TODAY)).toBeUndefined();
	});

	it('refuses a date that is not one', () => {
		expectHttpError(() => copyOnto('2026-9-30', source, NOW), 400);
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
