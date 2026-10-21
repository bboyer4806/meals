import { isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addDinner,
	clearDinner,
	getDay,
	getDinners,
	moveDinners
} from '#lib/server/data/dinners.ts';
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

/** The date's only dinner, or null when it has none. */
function dinnerOn(household: number, date: string) {
	const day = getDay(household, date);
	expect(day.length).toBeLessThanOrEqual(1);
	return day[0] ?? null;
}

/** The id of the date's first dinner, or undefined when it has none. */
function current(date: string): number | undefined {
	return getDay(householdId, date)[0]?.id;
}

/** Clears the date's first dinner, as someone else would. */
function clearOn(date: string): void {
	clearDinner(householdId, date, current(date) ?? null, NOW);
}

/** The dinner's dishes as "Name (role)", in the order it lists them. */
function dishesOn(date: string): string[] | undefined {
	return dinnerOn(householdId, date)?.dishes.map((dish) => `${dish.name} (${dish.role})`);
}

/** The id of the dinner a page shows, as its forms send it. */
function shown(dinnerId: number | undefined): string {
	if (dinnerId === undefined) throw new Error('No dinner to show');
	return String(dinnerId);
}

/** Every dinner the household has in October 2026, to check that nothing changed. */
function october() {
	return getDinners(householdId, '2026-10-01', '2026-10-31');
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
			dinners: [
				{
					id: expect.any(Number),
					date: TOMORROW,
					label: null,
					type: 'cook',
					note: 'Grandma visits',
					servings: 6,
					dishes: [
						{ dishId: tacos, name: 'Tacos', role: 'main', archived: false },
						{ dishId: rice, name: 'Rice', role: 'side', archived: false }
					]
				}
			],
			defaultServings: 3,
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

	it("gives each of the date's dinners, labeled, in the order they were added (6.9)", () => {
		const adults = makeDinner(householdId, TOMORROW, { type: 'eat_out' });
		const kids = addDinner(householdId, TOMORROW, { first: 'Adults', added: 'Kids' }, NOW);
		expect((loadPage(TOMORROW) as { dinners: unknown }).dinners).toMatchObject([
			{ id: adults, label: 'Adults', type: 'eat_out' },
			{ id: kids, label: 'Kids', type: 'cook', servings: 3 }
		]);
	});

	it('gives no dinner for a date that is not planned, and the usual servings to show (Q28)', () => {
		expect(loadPage('2027-01-01')).toMatchObject({
			date: '2027-01-01',
			dinners: [],
			defaultServings: 3
		});
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
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: null,
			servings: 3,
			dishes: []
		});
	});

	it('keeps the note, the servings and the dishes', async () => {
		const dinnerId = shown(
			makeDinner(householdId, TOMORROW, { note: 'Picnic', servings: 6, dishes: [[tacos, 'main']] })
		);
		await post('type', { type: 'going', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: 'Picnic',
			servings: 6
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});

	it('only removes dishes when the person was asked (2.3)', async () => {
		const dinnerId = shown(
			makeDinner(householdId, TOMORROW, { note: 'Busy day', dishes: [[tacos, 'main']] })
		);

		// The page showed this dinner before the dish was added, so it didn't ask.
		expectFailure(
			await post('type', { type: 'eat_out', dinnerId }),
			'type',
			'Someone has added dishes to this dinner since you opened it. To switch to Eating out and remove them, tap it again.'
		);
		expect(dinnerOn(householdId, TOMORROW)?.type).toBe('cook');
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);

		await post('type', { type: 'leftovers', removeDishes: '1', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'leftovers',
			note: 'Busy day',
			dishes: []
		});
		// The dish itself stays in the recipes.
		expect(getDish(householdId, tacos).archivedAt).toBeNull();
	});

	it('switches a dinner without dishes without asking', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW));
		await post('type', { type: 'eat_out', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)?.type).toBe('eat_out');
	});

	it('refuses a type that is not one', async () => {
		expectFailure(await post('type', {}), 'type', 'Pick a type');
		expectFailure(await post('type', { type: 'brunch' }), 'type', 'Pick a type');
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
	});
});

describe('saving servings and the note', () => {
	it('saves both, with line breaks as \\n and the note trimmed, then goes to the week', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { note: 'Old', servings: 4 }));
		expectRedirect(
			await post('details', {
				servings: '8',
				note: '  Cousins visit\r\nBring chairs\n ',
				dinnerId
			}),
			`/menu?week=2026-10-04&saved=${current(TOMORROW)}`
		);
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'cook',
			note: 'Cousins visit\nBring chairs',
			servings: 8
		});
	});

	it('goes to the Sunday that starts the week, in an earlier month or year', async () => {
		const weeks: [date: string, sunday: string][] = [
			['2026-10-03', '2026-09-27'],
			['2027-01-01', '2026-12-27'],
			['2026-10-04', '2026-10-04']
		];
		for (const [date, sunday] of weeks) {
			const dinnerId = shown(makeDinner(householdId, date));
			expectRedirect(
				await post('details', { servings: '5', dinnerId }, { date }),
				`/menu?week=${sunday}&saved=${dinnerId}`
			);
		}
	});

	it('clears a blank note', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { note: 'Old' }));
		await post('details', { servings: '4', note: '  \r\n ', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)?.note).toBeNull();
	});

	it('keeps what a form leaves out, such as servings for Eating out', async () => {
		const dinnerId = shown(
			makeDinner(householdId, TOMORROW, { type: 'eat_out', note: 'Old', servings: 5 })
		);
		await post('details', { note: 'Thai place', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'eat_out',
			note: 'Thai place',
			servings: 5
		});
		await post('details', { servings: '2', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ note: 'Thai place', servings: 2 });
	});

	it('takes 1 to 100 whole servings and a note up to 2500 characters', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { servings: 4 }));
		const tries: [Record<string, string>, string][] = [
			[{ servings: '0' }, 'Enter at least 1 serving'],
			[{ servings: '' }, 'Enter at least 1 serving'],
			[{ servings: '101' }, 'Enter 100 servings or fewer'],
			[{ servings: '2.5' }, 'Enter a whole number of servings'],
			[{ servings: '4', note: 'x'.repeat(2501) }, 'Keep the note under 2500 characters']
		];
		for (const [fields, error] of tries) {
			expectFailure(await post('details', { ...fields, dinnerId }), 'details', error);
		}
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ servings: 4, note: null });

		await post('details', { servings: '100', note: 'x'.repeat(2500), dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ servings: 100 });
	});

	it('plans the date again with what was sent when the dinner was cleared meanwhile (6.11)', async () => {
		const cleared = shown(makeDinner(householdId, TOMORROW, { type: 'going' }));
		clearOn(TOMORROW);
		expect(
			await post('details', { type: 'going', servings: '6', note: ' Hello ', dinnerId: cleared })
		).toEqual({
			action: 'details',
			replanned: true
		});
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: 'Hello',
			servings: 6,
			dishes: []
		});
		// Saved again from the reloaded page, it's an ordinary save.
		const dinnerId = shown(dinnerOn(householdId, TOMORROW)?.id);
		expectRedirect(
			await post('details', { type: 'going', note: 'Bring rolls', dinnerId }),
			`/menu?week=2026-10-04&saved=${current(TOMORROW)}`
		);
	});

	it('plans a date with no dinner as the type the page showed, then goes to the week (6.9)', async () => {
		expectRedirect(
			await post('details', { type: 'cook', servings: '5', note: ' Soup ' }),
			`/menu?week=2026-10-04&saved=${current(TOMORROW)}`
		);
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'cook',
			note: 'Soup',
			servings: 5,
			dishes: []
		});
	});

	it('keeps an Eating out dinner Eating out when it was cleared meanwhile', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { type: 'eat_out' }));
		clearOn(TOMORROW);
		await post('details', { type: 'eat_out', note: 'Thai place', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ type: 'eat_out', note: 'Thai place' });
	});

	it("uses the dinner's own type, not the one sent, while it's still there", async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { type: 'leftovers' }));
		await post('details', { type: 'cook', note: 'Soup', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ type: 'leftovers', note: 'Soup' });
	});

	it('starts a dinner planned that way at the usual servings when none were sent (Q28)', async () => {
		// The page of an Eating out dinner sends only the note.
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { type: 'eat_out', servings: 6 }));
		clearOn(TOMORROW);
		await post('details', { note: 'Thai place', dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'cook',
			note: 'Thai place',
			servings: 3
		});
		await post('details', { servings: '5' }, { date: TODAY });
		expect(dinnerOn(householdId, TODAY)).toMatchObject({ type: 'cook', note: null, servings: 5 });
	});

	it('plans nothing when what was sent is not valid', async () => {
		expectFailure(
			await post('details', { servings: '0', note: 'Hello' }),
			'details',
			'Enter at least 1 serving'
		);
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
	});
});

describe('adding a dish', () => {
	it('adds an existing dish by name, ignoring case', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		const dinnerId = shown(current(TOMORROW));
		expect(await post('addDish', { name: '  rice ', role: 'side', dinnerId })).toEqual({
			action: 'dish',
			archived: null
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('plans a date as Cooking at home and makes a new dish from a new name (2.3)', async () => {
		await post('addDish', { name: 'Garlic bread', role: 'main' });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ type: 'cook', servings: 3 });
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
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
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
				'Switch to Cooking at home or Bringing a dish to add dishes',
				TODAY
			]
		];
		for (const [fields, error, date] of tries) {
			const dinnerId = shown(current(date ?? TOMORROW));
			expectFailure(await post('addDish', { ...fields, dinnerId }, { date }), 'dish', error);
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
			await post('restoreDish', {
				dishId: String(cake),
				role: 'dessert',
				dinnerId: shown(current(TOMORROW))
			})
		).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Pound cake (dessert)']);
		expect(getDish(householdId, cake).archivedAt).toBeNull();
	});

	it("is not found for another household's dish", async () => {
		const theirs = makeDish(otherId, recipe('Stew'));
		expectNotFound(await post('restoreDish', { dishId: String(theirs), role: 'main' }));
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
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
		const dinnerId = shown(current(TOMORROW));
		expect(await post('role', { dishId: String(tacos), role: 'other', dinnerId })).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Rice (side)', 'Tacos (other)']);
	});

	it('refuses a role that is not one', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		const dinnerId = shown(current(TOMORROW));
		expectFailure(
			await post('role', { dishId: String(tacos), role: 'x', dinnerId }),
			'dishes',
			'Pick a role'
		);
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)']);
	});

	it('is not found for a dish that is not on the dinner', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		const dinnerId = shown(current(TOMORROW));
		expectNotFound(await post('role', { dishId: String(rice), role: 'side', dinnerId }));
		// Its dinner isn't on that date.
		expectNotFound(
			await post('role', { dishId: String(tacos), role: 'side', dinnerId }, { date: TODAY })
		);
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
		const dinnerId = shown(current(TOMORROW));
		expect(await post('removeDish', { dishId: String(tacos), dinnerId })).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Rice (side)']);
	});

	it('is not found for a dish that is not on the dinner', async () => {
		makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] });
		const dinnerId = shown(current(TOMORROW));
		expectNotFound(await post('removeDish', { dishId: String(rice), dinnerId }));
		expectNotFound(await post('removeDish', { dishId: String(tacos), dinnerId }, { date: TODAY }));
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
		expect(await post('copy', { sourceId: String(past) })).toBeUndefined();
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: null,
			servings: 3
		});
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('keeps the note and servings of a dinner without dishes, without asking', async () => {
		const dinnerId = shown(
			makeDinner(householdId, TOMORROW, { type: 'eat_out', note: 'Maybe', servings: 2 })
		);
		await post('copy', { sourceId: String(past), dinnerId });
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			type: 'going',
			note: 'Maybe',
			servings: 2
		});
	});

	it('only replaces dishes when the person was asked', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { dishes: [[cake, 'dessert']] }));

		// The page showed this dinner before the dish was added, so it didn't ask.
		expectFailure(
			await post('copy', { sourceId: String(past), dinnerId }),
			'copy',
			'Someone has added dishes to this dinner since you opened it. To replace them, pick the dinner to copy again.'
		);
		expect(dishesOn(TOMORROW)).toEqual(['Pound cake (dessert)']);

		await post('copy', { sourceId: String(past), replaceDishes: '1', dinnerId });
		expect(dishesOn(TOMORROW)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it('changes nothing when copied onto itself', async () => {
		expect(
			await post('copy', { sourceId: String(past), dinnerId: String(past) }, { date: YESTERDAY })
		).toBeUndefined();
		expect(dishesOn(YESTERDAY)).toEqual(['Tacos (main)', 'Rice (side)']);
	});

	it("is not found for another household's dinner", async () => {
		const theirs = makeDinner(otherId, YESTERDAY, { dishes: [] });
		expectNotFound(await post('copy', { sourceId: String(theirs) }));
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
	});
});

describe('moving a dinner', () => {
	it('moves it and opens the new date', async () => {
		const dinnerId = shown(
			makeDinner(householdId, TOMORROW, { note: 'Tacos night', dishes: [[tacos, 'main']] })
		);
		expectRedirect(await post('move', { to: '2026-10-09', dinnerId }), '/menu/2026-10-09');
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
		expect(dinnerOn(householdId, '2026-10-09')).toMatchObject({ note: 'Tacos night' });
	});

	it('swaps with a dinner already on that date (2.2.2)', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { note: 'First' }));
		makeDinner(householdId, TODAY, { note: 'Second', type: 'eat_out' });
		expectRedirect(await post('move', { to: TODAY, dinnerId }), `/menu/${TODAY}`);
		expect(dinnerOn(householdId, TODAY)?.note).toBe('First');
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ note: 'Second', type: 'eat_out' });
	});

	it('says what is wrong with the date', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW));
		expectFailure(await post('move', { dinnerId }), 'move', 'Pick a date');
		expectFailure(await post('move', { to: '2026-02-30', dinnerId }), 'move', 'Pick a date');
		expectFailure(
			await post('move', { to: TOMORROW, dinnerId }),
			'move',
			'Pick a different date'
		);
		expect(dinnerOn(householdId, TOMORROW)).not.toBeNull();
	});

	it('is not found when the date has no dinner', async () => {
		expectNotFound(await post('move', { to: TODAY }));
	});
});

describe('clearing a dinner', () => {
	it('deletes the dinner, leaving the date unplanned', async () => {
		const dinnerId = shown(makeDinner(householdId, TOMORROW, { dishes: [[tacos, 'main']] }));
		makeDinner(otherId, TOMORROW);
		expect(await post('clear', { dinnerId })).toBeUndefined();
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
		expect(dinnerOn(otherId, TOMORROW)).not.toBeNull();
		expect(getDish(householdId, tacos).archivedAt).toBeNull();
	});
});

describe('more than one dinner on a date (6.9)', () => {
	let adults: number;
	let kids: number;

	beforeEach(() => {
		adults = makeDinner(householdId, TOMORROW, { note: 'Late', dishes: [[tacos, 'main']] });
		kids = addDinner(householdId, TOMORROW, { first: 'Adults', added: 'Kids' }, NOW);
	});

	/** The date's dinners as "Label: type, note, servings, dishes", in the order added. */
	function day() {
		return getDay(householdId, TOMORROW).map(
			(dinner) =>
				`${dinner.label}: ${dinner.type}, ${dinner.note}, ${dinner.servings}, ` +
				dinner.dishes.map((dish) => `${dish.name} (${dish.role})`).join(' ')
		);
	}

	it('adds the second dinner with both labels, and later ones with their own', async () => {
		clearDinner(householdId, TOMORROW, kids, NOW);
		expect(await post('addDinner', { firstLabel: ' Grown-ups ', label: 'Kids' })).toBeUndefined();
		expect(await post('addDinner', { label: 'Guests' })).toBeUndefined();
		expect(day()).toEqual([
			'Grown-ups: cook, Late, 4, Tacos (main)',
			'Kids: cook, null, 3, ',
			'Guests: cook, null, 3, '
		]);
	});

	it('says what is wrong with a label, or with the number of dinners', async () => {
		const tries: [Record<string, string>, string][] = [
			[{}, 'Enter a label for each dinner'],
			[{ label: '' }, 'Enter a label for each dinner'],
			[{ label: 'x'.repeat(31) }, 'Keep a label under 30 characters'],
			[{ label: 'kids' }, 'Give each dinner on this day a different label'],
			// The page showed one dinner, but there are two now.
			[{ firstLabel: 'Adults', label: 'Guests' }, 'Someone changed this dinner since you opened it.']
		];
		for (const [fields, error] of tries) {
			expectFailure(await post('addDinner', fields), 'addDinner', error);
		}
		for (const label of ['Three', 'Four', 'Five']) await post('addDinner', { label });
		expectFailure(
			await post('addDinner', { label: 'Six' }),
			'addDinner',
			'A day can have up to 5 dinners'
		);
		expectFailure(
			await post('addDinner', { firstLabel: 'A', label: 'B' }, { date: TODAY }),
			'addDinner',
			'Plan this date before adding another dinner'
		);
	});

	it('changes only the dinner whose id it posted', async () => {
		const dinnerId = String(kids);
		await post('type', { type: 'going', dinnerId });
		await post('addDish', { name: 'Rice', role: 'main', dinnerId });
		await post('addDish', { name: 'Tacos', role: 'side', dinnerId });
		await post('role', { dishId: String(tacos), role: 'other', dinnerId });
		await post('removeDish', { dishId: String(rice), dinnerId });
		expectRedirect(
			await post('details', { label: ' Little  ones ', servings: '2', note: 'Early', dinnerId }),
			`/menu?week=2026-10-04&saved=${kids}`
		);
		expect(day()).toEqual([
			'Adults: cook, Late, 4, Tacos (main)',
			'Little ones: going, Early, 2, Tacos (other)'
		]);

		const past = makeDinner(householdId, YESTERDAY, { dishes: [[cake, 'dessert']] });
		await post('copy', { sourceId: String(past), dinnerId: String(adults), replaceDishes: '1' });
		await post('type', { type: 'eat_out', removeDishes: '1', dinnerId });
		expect(day()).toEqual([
			'Adults: cook, Late, 4, Pound cake (dessert)',
			'Little ones: eat_out, Early, 2, '
		]);

		// Clearing one leaves the other, which loses its label.
		expect(await post('clear', { dinnerId: String(adults) })).toBeUndefined();
		expect(day()).toEqual(['null: eat_out, Early, 2, ']);
	});

	it('needs a label on each dinner, and keeps it when the form leaves it out', async () => {
		const dinnerId = String(kids);
		expectFailure(
			await post('details', { label: ' ', note: 'Early', dinnerId }),
			'details',
			'Enter a label for each dinner'
		);
		expectFailure(
			await post('details', { label: 'ADULTS', dinnerId }),
			'details',
			'Give each dinner on this day a different label'
		);
		await post('details', { note: 'Early', dinnerId });
		expect(day()[1]).toBe('Kids: cook, Early, 3, ');
	});

	it('moves every dinner on the date, and swaps with every dinner on the other', async () => {
		const other = makeDinner(householdId, TODAY, { type: 'leftovers' });
		expectRedirect(await post('move', { to: TODAY, dinnerId: String(kids) }), `/menu/${TODAY}`);
		expect(getDay(householdId, TODAY).map((dinner) => dinner.id)).toEqual([adults, kids]);
		expect(getDay(householdId, TOMORROW).map((dinner) => dinner.id)).toEqual([other]);
	});
});

describe('a page left open while someone changed its date (6.11)', () => {
	const CHANGED = 'Someone changed this dinner since you opened it.';
	const LATER = '2026-10-09';
	let past: number;

	beforeEach(() => {
		past = makeDinner(householdId, YESTERDAY, { dishes: [[cake, 'dessert']] });
	});

	it("refuses to change or remove a dinner moved onto the date, which the page didn't show", async () => {
		// The page shows a rice dinner. Someone else then moves the birthday dinner onto the date, so the
		// two swap.
		const riceDinner = makeDinner(householdId, TOMORROW, { dishes: [[rice, 'main']] });
		const birthday = makeDinner(householdId, LATER, {
			note: "Grandma's birthday",
			servings: 6,
			dishes: [[tacos, 'main']]
		});
		moveDinners(householdId, LATER, TOMORROW, birthday, NOW);
		const before = october();

		const tries: [Action, Record<string, string>, string][] = [
			['clear', {}, 'clear'],
			['type', { type: 'eat_out', removeDishes: '1' }, 'type'],
			['type', { type: 'going' }, 'type'],
			['details', { type: 'cook', servings: '2', note: 'Bring candles' }, 'details'],
			['copy', { sourceId: String(past), replaceDishes: '1' }, 'copy'],
			['move', { to: '2026-10-12' }, 'move']
		];
		for (const [action, fields, name] of tries) {
			expectFailure(await post(action, { ...fields, dinnerId: shown(riceDinner) }), name, CHANGED);
		}
		expect(october()).toEqual(before);

		// Once the page shows the dinner that's there now, its changes go through.
		expectRedirect(
			await post('details', { note: 'Bring candles', dinnerId: shown(birthday) }),
			`/menu?week=2026-10-04&saved=${current(TOMORROW)}`
		);
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({
			id: birthday,
			note: 'Bring candles',
			servings: 6
		});
		expect(await post('clear', { dinnerId: shown(birthday) })).toBeUndefined();
		expect(dinnerOn(householdId, TOMORROW)).toBeNull();
		expect(dinnerOn(householdId, LATER)?.id).toBe(riceDinner);
	});

	it('refuses a change from a page that showed no dinner, once there is one', async () => {
		// The page shows the date as not planned. Someone else then plans it.
		makeDinner(householdId, TOMORROW, { type: 'going', note: 'Picnic' });
		const before = october();

		const tries: [Action, Record<string, string>, string][] = [
			['clear', {}, 'clear'],
			['type', { type: 'eat_out' }, 'type'],
			['details', { type: 'cook', servings: '2', note: 'Soup' }, 'details'],
			['addDish', { name: 'Rice', role: 'side' }, 'dish'],
			['restoreDish', { dishId: String(rice), role: 'side' }, 'dish'],
			['copy', { sourceId: String(past) }, 'copy'],
			['move', { to: '2026-10-12' }, 'move']
		];
		for (const [action, fields, name] of tries) {
			expectFailure(await post(action, fields), name, CHANGED);
		}
		expect(october()).toEqual(before);
	});

	it('plans the date again, or has nothing to clear or move, when the dinner shown is gone', async () => {
		const gone = shown(makeDinner(householdId, TOMORROW, { type: 'going', note: 'Picnic' }));
		clearOn(TOMORROW);

		expect(await post('clear', { dinnerId: gone })).toBeUndefined();
		expectNotFound(await post('move', { to: '2026-10-12', dinnerId: gone }));
		expect(october().map((dinner) => dinner.date)).toEqual([YESTERDAY]);

		expect(await post('type', { type: 'eat_out', dinnerId: gone })).toBeUndefined();
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ type: 'eat_out', servings: 3 });
		clearOn(TOMORROW);

		expect(await post('copy', { sourceId: String(past), dinnerId: gone })).toBeUndefined();
		expect(dishesOn(TOMORROW)).toEqual(['Pound cake (dessert)']);
		clearOn(TOMORROW);

		expect(await post('details', { type: 'going', note: 'Picnic', dinnerId: gone })).toEqual({
			action: 'details',
			replanned: true
		});
		expect(dinnerOn(householdId, TOMORROW)).toMatchObject({ type: 'going', note: 'Picnic' });
	});
});

describe('every action', () => {
	const forms: Record<Action, Record<string, string>> = {
		type: { type: 'cook' },
		details: { servings: '4' },
		addDinner: { firstLabel: 'Adults', label: 'Kids' },
		addDish: { name: 'Rice', role: 'main' },
		restoreDish: { dishId: '1', role: 'main' },
		role: { dishId: '1', role: 'main', dinnerId: '1' },
		removeDish: { dishId: '1', dinnerId: '1' },
		copy: { sourceId: '1' },
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
