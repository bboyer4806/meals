import { isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDinner } from '#lib/server/data/dinners.ts';
import { getDish, setDishArchived } from '#lib/server/data/dishes.ts';
import { db } from '#lib/server/db/index.ts';
import { dishes, households } from '#lib/server/db/schema.ts';
import { freshDb, makeDinner, makeDish, makeHousehold, recipe } from '#lib/server/testing.ts';
import { actions, load } from './+page.server.ts';

const TZ = 'America/Chicago';
// Wed 2026-10-07 at 20:00 in Chicago, already Oct 8 in UTC.
const NOW = Date.UTC(2026, 9, 8, 1, 0);
const TODAY = '2026-10-07';
const TOMORROW = '2026-10-08';
const YESTERDAY = '2026-10-06';

let householdId: number;
let otherId: number;
let tacos: number;
let rice: number;
let cake: number;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	freshDb();
	({ householdId } = makeHousehold(TZ));
	({ householdId: otherId } = makeHousehold(TZ));
	// Usual servings that no dinner below has, so tests can tell where servings came from.
	db().update(households).set({ defaultServings: 3 }).where(eq(households.id, householdId)).run();
	tacos = makeDish(householdId, recipe('Tacos'));
	rice = makeDish(householdId, recipe('Rice'));
	cake = makeDish(householdId, recipe('Pound cake'));
});

afterEach(() => {
	vi.useRealTimers();
});

type Who = 'member' | 'setup' | 'nobody';

/** The signed-in person: a member of the household, someone still in setup, or nobody. */
function locals(as: Who = 'member') {
	if (as === 'nobody') return { user: null };
	const user = { id: 1, email: 'a@example.com', name: 'A', isAdmin: false };
	return { user: { ...user, householdId: as === 'member' ? householdId : null } };
}

function loadPage(date: string, as?: Who) {
	try {
		return load({ locals: locals(as), params: { date } } as unknown as Parameters<typeof load>[0]);
	} catch (e) {
		return e;
	}
}

type Action = keyof typeof actions;

/** Posts a form to an action on a date's page, giving what it returned or what it threw. */
async function post(
	action: Action,
	fields: Record<string, string> = {},
	{ date = TOMORROW, as }: { date?: string; as?: Who } = {}
): Promise<unknown> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const request = new Request(`http://localhost/menu/${date}?/${action}`, { method: 'POST', body });
	const event = { locals: locals(as), params: { date }, request } as unknown as Parameters<
		(typeof actions)[Action]
	>[0];
	try {
		return await actions[action](event);
	} catch (e) {
		return e;
	}
}

function expectRedirect(result: unknown, location: string) {
	expect(isRedirect(result) && [result.status, result.location]).toEqual([303, location]);
}

function expectFailure(result: unknown, action: string, error: string) {
	expect(result).toMatchObject({ status: 400, data: { action, error } });
}

function expectNotFound(result: unknown) {
	expect(isHttpError(result, 404)).toBe(true);
}

/** The dinner's dishes as "Name (role)", in the order it lists them. */
function dishesOn(date: string): string[] | undefined {
	return getDinner(householdId, date)?.dishes.map((dish) => `${dish.name} (${dish.role})`);
}

describe('loading a date', () => {
	it('gives the dinner, today in the household time zone, past dinners to copy and dishes', () => {
		makeDinner(householdId, YESTERDAY, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, TOMORROW, {
			servings: 6,
			note: 'Grandma visits',
			dishes: [
				[rice, 'side'],
				[tacos, 'main']
			]
		});
		makeDinner(otherId, TOMORROW, { type: 'eat_out' });
		setDishArchived(householdId, cake, true, NOW);

		expect(loadPage(TOMORROW)).toEqual({
			date: TOMORROW,
			today: TODAY,
			dinner: {
				id: expect.any(Number),
				date: TOMORROW,
				type: 'cook',
				note: 'Grandma visits',
				servings: 6,
				dishes: [
					{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
					{ dishId: rice, name: 'Rice', role: 'side', archived: false }
				]
			},
			// Tomorrow's dinner isn't made yet (assumption 1).
			copyGroups: [
				{
					dinnerId: expect.any(Number),
					dishes: [{ name: 'Tacos', role: 'main' }],
					timesMade: 1,
					lastMade: YESTERDAY
				}
			],
			// The archived dish isn't suggested (6.10).
			dishes: [
				{ id: tacos, name: 'Tacos', timesAdded: 2 },
				{ id: rice, name: 'Rice', timesAdded: 1 }
			]
		});
	});

	it('gives no dinner for a date that is not planned', () => {
		expect(loadPage('2027-01-01')).toMatchObject({ date: '2027-01-01', dinner: null });
	});

	it('is not found for a date that is not one', () => {
		for (const date of ['2026-02-30', '2026-1-5', 'today', '2026-10-07x']) {
			expectNotFound(loadPage(date));
		}
	});

	it('needs a signed-in member of a household', () => {
		expectRedirect(loadPage(TOMORROW, 'nobody'), '/login');
		expectRedirect(loadPage(TOMORROW, 'setup'), '/setup');
	});
});

describe('picking a type', () => {
	it('plans a date at the usual servings (Q28)', async () => {
		expect(await post('type', { type: 'going' })).toBeUndefined();
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: null,
			servings: 3,
			dishes: []
		});
	});

	it('keeps the note, the servings and the dishes', async () => {
		makeDinner(householdId, TOMORROW, { note: 'Picnic', servings: 6, dishes: [[tacos, 'main']] });
		await post('type', { type: 'going' });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: 'Picnic',
			servings: 6
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});

	it('only removes dishes when the person was asked (2.3)', async () => {
		makeDinner(householdId, TOMORROW, { note: 'Busy day', dishes: [[tacos, 'main']] });

		expectFailure(
			await post('type', { type: 'eat_out' }),
			'type',
			'Someone has added dishes to this dinner since you opened it. To switch to Eating out and remove them, tap it again.'
		);
		expect(getDinner(householdId, TOMORROW)?.type).toBe('cook');
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);

		await post('type', { type: 'leftovers', removeDishes: '1' });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'leftovers',
			note: 'Busy day',
			dishes: []
		});
		// The dish itself stays in the recipes.
		expect(getDish(householdId, tacos).archivedAt).toBeNull();
	});

	it('switches a dinner without dishes without asking', async () => {
		makeDinner(householdId, TOMORROW);
		await post('type', { type: 'eat_out' });
		expect(getDinner(householdId, TOMORROW)?.type).toBe('eat_out');
	});

	it('refuses a type that is not one', async () => {
		expectFailure(await post('type', {}), 'type', 'Pick a type');
		expectFailure(await post('type', { type: 'brunch' }), 'type', 'Pick a type');
		expect(getDinner(householdId, TOMORROW)).toBeNull();
	});
});

describe('saving servings and the note', () => {
	it('saves both, with line breaks as \\n and the note trimmed', async () => {
		makeDinner(householdId, TOMORROW, { note: 'Old', servings: 4 });
		expect(
			await post('details', { servings: '8', note: '  Cousins visit\r\nBring chairs\n ' })
		).toBeUndefined();
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'cook',
			note: 'Cousins visit\nBring chairs',
			servings: 8
		});
	});

	it('clears a blank note', async () => {
		makeDinner(householdId, TOMORROW, { note: 'Old' });
		await post('details', { servings: '4', note: '  \r\n ' });
		expect(getDinner(householdId, TOMORROW)?.note).toBeNull();
	});

	it('keeps what a form leaves out, such as servings for Eating out', async () => {
		makeDinner(householdId, TOMORROW, { type: 'eat_out', note: 'Old', servings: 5 });
		await post('details', { note: 'Thai place' });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'eat_out',
			note: 'Thai place',
			servings: 5
		});
		await post('details', { servings: '2' });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({ note: 'Thai place', servings: 2 });
	});

	it('takes 1 to 100 whole servings and a note up to 2500 characters', async () => {
		makeDinner(householdId, TOMORROW, { servings: 4 });
		const tries: [Record<string, string>, string][] = [
			[{ servings: '0' }, 'Enter at least 1 serving'],
			[{ servings: '' }, 'Enter at least 1 serving'],
			[{ servings: '101' }, 'Enter 100 servings or fewer'],
			[{ servings: '2.5' }, 'Enter a whole number of servings'],
			[{ servings: '4', note: 'x'.repeat(2501) }, 'Keep the note under 2500 characters']
		];
		for (const [fields, error] of tries) {
			expectFailure(await post('details', fields), 'details', error);
		}
		expect(getDinner(householdId, TOMORROW)).toMatchObject({ servings: 4, note: null });

		await post('details', { servings: '100', note: 'x'.repeat(2500) });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({ servings: 100 });
	});

	it('says so when the dinner was cleared meanwhile', async () => {
		expectFailure(
			await post('details', { servings: '4', note: 'Hello' }),
			'details',
			'This dinner has been cleared. Pick a type to plan it again.'
		);
		expect(getDinner(householdId, TOMORROW)).toBeNull();
	});
});

describe('adding a dish', () => {
	it('adds an existing dish by name, ignoring case', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		expect(await post('addDish', { name: '  rice ', role: 'side' })).toEqual({
			action: 'dish',
			archived: null
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('plans a date as Cooking at home and makes a new dish from a new name (2.3)', async () => {
		await post('addDish', { name: 'Garlic bread', role: 'main' });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({ type: 'cook', servings: 3 });
		expect(dishesOn(TOMORROW)).toEqual(['Garlic bread (main)']);
		const made = db().select().from(dishes).where(eq(dishes.name, 'Garlic bread')).get();
		expect(made).toMatchObject({ householdId, servings: 3 });
	});

	it('offers to restore an archived dish typed by name, changing nothing (6.10)', async () => {
		setDishArchived(householdId, cake, true, NOW);
		expect(await post('addDish', { name: 'POUND CAKE', role: 'dessert' })).toEqual({
			action: 'dish',
			archived: { dishId: cake, name: 'Pound cake', role: 'dessert' }
		});
		expect(getDinner(householdId, TOMORROW)).toBeNull();
		expect(getDish(householdId, cake).archivedAt).not.toBeNull();
	});

	it('says what is wrong', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		makeDinner(householdId, TODAY, { type: 'leftovers' });
		const tries: [Record<string, string>, string, string?][] = [
			[{ role: 'main' }, 'Enter a dish name'],
			[{ name: '   ', role: 'main' }, 'Enter a dish name'],
			[{ name: 'x'.repeat(81), role: 'main' }, 'Keep a dish name under 80 characters'],
			[{ name: 'Rice' }, 'Pick a role'],
			[{ name: 'Rice', role: 'starter' }, 'Pick a role'],
			[{ name: 'tacos', role: 'side' }, 'Tacos is already on this dinner'],
			[
				{ name: 'Rice', role: 'side' },
				'Switch to Cooking at home or Going somewhere to add dishes',
				TODAY
			]
		];
		for (const [fields, error, date] of tries) {
			expectFailure(await post('addDish', fields, { date }), 'dish', error);
		}
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
		expect(dishesOn(TODAY)).toEqual([]);
	});
});

describe('restoring a dish and adding it', () => {
	it('restores the dish and adds it with its role', async () => {
		setDishArchived(householdId, cake, true, NOW);
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		expect(
			await post('restoreDish', { dishId: String(cake), role: 'dessert' })
		).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Pound cake (dessert)']);
		expect(getDish(householdId, cake).archivedAt).toBeNull();
	});

	it("is not found for another household's dish", async () => {
		const theirs = makeDish(otherId, recipe('Stew'));
		expectNotFound(await post('restoreDish', { dishId: String(theirs), role: 'main' }));
		expect(getDinner(householdId, TOMORROW)).toBeNull();
	});
});

describe("changing a dish's role", () => {
	it('changes it, and the dinner lists it in its new place', async () => {
		makeDinner(householdId, TOMORROW, {
			dishes: [
				[tacos, 'main'],
				[rice, 'side']
			]
		});
		expect(await post('role', { dishId: String(tacos), role: 'other' })).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Rice (side)', 'Tacos (other)']);
	});

	it('refuses a role that is not one', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		expectFailure(await post('role', { dishId: String(tacos), role: 'x' }), 'dishes', 'Pick a role');
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});

	it('is not found for a dish that is not on the dinner', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		expectNotFound(await post('role', { dishId: String(rice), role: 'side' }));
		expectNotFound(await post('role', { dishId: String(tacos), role: 'side' }, { date: TODAY }));
	});
});

describe('removing a dish', () => {
	it('takes it off the dinner and keeps the dinner', async () => {
		makeDinner(householdId, TOMORROW, {
			dishes: [
				[tacos, 'main'],
				[rice, 'side']
			]
		});
		expect(await post('removeDish', { dishId: String(tacos) })).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Rice (side)']);
	});

	it('is not found for a dish that is not on the dinner', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		expectNotFound(await post('removeDish', { dishId: String(rice) }));
		expectNotFound(await post('removeDish', { dishId: String(tacos) }, { date: TODAY }));
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});
});

describe('copying a dinner', () => {
	let past: number;

	beforeEach(() => {
		past = makeDinner(householdId, YESTERDAY, {
			type: 'going',
			note: 'Beach',
			servings: 8,
			dishes: [
				[rice, 'side'],
				[tacos, 'main']
			]
		});
	});

	it("plans a date with the dinner's type and dishes, at the usual servings (2.3)", async () => {
		expect(await post('copy', { dinnerId: String(past) })).toBeUndefined();
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: null,
			servings: 3
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('keeps the note and servings of a dinner without dishes, without asking', async () => {
		makeDinner(householdId, TOMORROW, { type: 'eat_out', note: 'Maybe', servings: 2 });
		await post('copy', { dinnerId: String(past) });
		expect(getDinner(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: 'Maybe',
			servings: 2
		});
	});

	it('only replaces dishes when the person was asked', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[cake, 'dessert']] });

		expectFailure(
			await post('copy', { dinnerId: String(past) }),
			'copy',
			'Someone has added dishes to this dinner since you opened it. To replace them, pick the dinner to copy again.'
		);
		expect(dishesOn(TOMORROW)).toEqual(['Pound cake (dessert)']);

		await post('copy', { dinnerId: String(past), replaceDishes: '1' });
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('changes nothing when copied onto itself', async () => {
		expect(await post('copy', { dinnerId: String(past) }, { date: YESTERDAY })).toBeUndefined();
		expect(dishesOn(YESTERDAY)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it("is not found for another household's dinner", async () => {
		const theirs = makeDinner(otherId, YESTERDAY, { dishes: [] });
		expectNotFound(await post('copy', { dinnerId: String(theirs) }));
		expect(getDinner(householdId, TOMORROW)).toBeNull();
	});
});

describe('moving a dinner', () => {
	it('moves it and opens the new date', async () => {
		makeDinner(householdId, TOMORROW, { note: 'Tacos night', dishes: [[tacos, 'main']] });
		expectRedirect(await post('move', { to: '2026-10-09' }), '/menu/2026-10-09');
		expect(getDinner(householdId, TOMORROW)).toBeNull();
		expect(getDinner(householdId, '2026-10-09')).toMatchObject({ note: 'Tacos night' });
	});

	it('swaps with a dinner already on that date (2.2.2)', async () => {
		makeDinner(householdId, TOMORROW, { note: 'First' });
		makeDinner(householdId, TODAY, { note: 'Second', type: 'eat_out' });
		expectRedirect(await post('move', { to: TODAY }), `/menu/${TODAY}`);
		expect(getDinner(householdId, TODAY)?.note).toBe('First');
		expect(getDinner(householdId, TOMORROW)).toMatchObject({ note: 'Second', type: 'eat_out' });
	});

	it('says what is wrong with the date', async () => {
		makeDinner(householdId, TOMORROW);
		expectFailure(await post('move', {}), 'move', 'Pick a date');
		expectFailure(await post('move', { to: '2026-02-30' }), 'move', 'Pick a date');
		expectFailure(await post('move', { to: TOMORROW }), 'move', 'Pick a different date');
		expect(getDinner(householdId, TOMORROW)).not.toBeNull();
	});

	it('is not found when the date has no dinner', async () => {
		expectNotFound(await post('move', { to: TODAY }));
	});
});

describe('clearing a dinner', () => {
	it('deletes the dinner, leaving the date unplanned', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		makeDinner(otherId, TOMORROW);
		expect(await post('clear')).toBeUndefined();
		expect(getDinner(householdId, TOMORROW)).toBeNull();
		expect(getDinner(otherId, TOMORROW)).not.toBeNull();
		expect(getDish(householdId, tacos).archivedAt).toBeNull();
	});
});

describe('every action', () => {
	const forms: Record<Action, Record<string, string>> = {
		type: { type: 'cook' },
		details: { servings: '4' },
		addDish: { name: 'Rice', role: 'main' },
		restoreDish: { dishId: '1', role: 'main' },
		role: { dishId: '1', role: 'main' },
		removeDish: { dishId: '1' },
		copy: { dinnerId: '1' },
		move: { to: TODAY },
		clear: {}
	};

	it('needs a signed-in member of a household', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		for (const [action, fields] of Object.entries(forms) as [Action, Record<string, string>][]) {
			expectRedirect(await post(action, fields, { as: 'nobody' }), '/login');
			expectRedirect(await post(action, fields, { as: 'setup' }), '/setup');
		}
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});

	it('is not found for a date that is not one', async () => {
		for (const [action, fields] of Object.entries(forms) as [Action, Record<string, string>][]) {
			expectNotFound(await post(action, fields, { date: '2026-02-30' }));
		}
	});
});
