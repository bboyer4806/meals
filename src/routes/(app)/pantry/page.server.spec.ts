import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { findItemByName } from '#lib/server/data/items.ts';
import { listActiveLines } from '#lib/server/data/needs.ts';
import { getChecklist, markHave, startRecipeChecklist } from '#lib/server/data/pantry.ts';
import { db } from '#lib/server/db/index.ts';
import { dinnerDishes, dinners } from '#lib/server/db/schema.ts';
import { freshDb, ingredient, makeDish, makeHousehold, recipe } from '#lib/server/testing.ts';
import { actions, load } from './+page.server.ts';

// Sat 2026-10-03 12:00 in Chicago. Oct 4 is a Sunday.
const NOW = Date.UTC(2026, 9, 3, 17, 0);
const TZ = 'America/Chicago';
const MENU_CHECKED =
	'Someone has checked items on this pantry check since you opened the menu. To replace it, go back to the menu and tap Check pantry again.';

let householdId: number;
let cake: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	cake = makeDish(
		householdId,
		recipe('Pound cake', {
			servings: 4,
			ingredients: [ingredient('Butter', 1, 'cup'), ingredient('Sugar', 2, 'cup')]
		})
	);
	// Tuesday's dinner, at twice the recipe's servings.
	const { id } = db()
		.insert(dinners)
		.values({
			householdId,
			date: '2026-10-06',
			type: 'cook',
			note: null,
			servings: 8,
			createdAt: NOW,
			updatedAt: NOW
		})
		.returning({ id: dinners.id })
		.get();
	db().insert(dinnerDishes).values({ householdId, dinnerId: id, dishId: cake, role: 'main' }).run();
});

function itemId(name: string): number {
	const item = findItemByName(householdId, name);
	if (!item) throw new Error(`No item called ${name}`);
	return item.id;
}

/** The signed-in person: a member of the household, someone still in setup, or nobody. */
function locals(as: 'member' | 'setup' | 'nobody' = 'member') {
	if (as === 'nobody') return { user: null };
	const user = { id: 1, email: 'a@example.com', name: 'A', isAdmin: false };
	return { user: { ...user, householdId: as === 'member' ? householdId : null } };
}

/** Posts a form to an action, giving what it returned or what it threw. */
async function post(
	action: 'startMenu' | 'need',
	fields: Record<string, string>,
	as?: 'member' | 'setup' | 'nobody'
): Promise<unknown> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const request = new Request(`http://localhost/pantry?/${action}`, { method: 'POST', body });
	const event = { locals: locals(as), request } as unknown as Parameters<
		(typeof actions)[typeof action]
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

function expectFailure(result: unknown, error: string) {
	expect(result).toMatchObject({ status: 400, data: { action: 'start', error } });
}

describe('startMenu', () => {
	it('starts a check for the dates and opens it', async () => {
		expectRedirect(
			await post('startMenu', { startDate: '2026-10-04', endDate: '2026-10-10' }),
			'/pantry'
		);
		expect(getChecklist(householdId)).toMatchObject({
			source: { kind: 'range', startDate: '2026-10-04', endDate: '2026-10-10' },
			dishCount: 1
		});
	});

	it('says what is wrong with the dates', async () => {
		const tries: [Record<string, string>, string][] = [
			[{ endDate: '2026-10-10' }, 'Pick a start date'],
			[{ startDate: '', endDate: '2026-10-10' }, 'Pick a start date'],
			[{ startDate: 'today', endDate: '2026-10-10' }, 'Pick a start date'],
			[{ startDate: '2026-10-04' }, 'Pick an end date'],
			[{ startDate: '2026-10-04', endDate: '2026-02-30' }, 'Pick an end date'],
			[
				{ startDate: '2026-10-10', endDate: '2026-10-04' },
				'Pick an end date on or after the start date'
			],
			[{ startDate: '2026-10-04', endDate: '2026-10-18' }, 'Pick 14 days or fewer']
		];
		for (const [fields, error] of tries) expectFailure(await post('startMenu', fields), error);
		expect(getChecklist(householdId)).toBeNull();
	});

	it('only replaces a check with checked items when the person was asked (6.8)', async () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		const week = { startDate: '2026-10-04', endDate: '2026-10-10' };

		expectFailure(await post('startMenu', week), MENU_CHECKED);
		expect(getChecklist(householdId)).toMatchObject({
			source: { kind: 'recipe', dishId: cake },
			markedCount: 1
		});

		expectRedirect(await post('startMenu', { ...week, replaceChecked: '1' }), '/pantry');
		expect(getChecklist(householdId)).toMatchObject({
			source: { kind: 'range', ...week },
			markedCount: 0
		});
	});

	it('needs a signed-in member of a household', async () => {
		const week = { startDate: '2026-10-04', endDate: '2026-10-10' };
		expectRedirect(await post('startMenu', week, 'nobody'), '/login');
		expectRedirect(await post('startMenu', week, 'setup'), '/setup');
		expect(getChecklist(householdId)).toBeNull();
	});
});

describe('a check from the menu', () => {
	it('loads with its dates, and the amounts for each dish and day', async () => {
		await post('startMenu', { startDate: '2026-10-04', endDate: '2026-10-10' });
		const data = load({ locals: locals() } as unknown as Parameters<typeof load>[0]);
		expect(data.checklist).toMatchObject({
			source: { kind: 'range', startDate: '2026-10-04', endDate: '2026-10-10' },
			noIngredients: [],
			dishCount: 1,
			markedCount: 0,
			items: [
				{
					itemName: 'Butter',
					amounts: {
						totals: ['2 cups'],
						breakdown: [{ source: 'Pound cake (Tue)', amount: '2 cups' }]
					}
				},
				{ itemName: 'Sugar', amounts: { totals: ['4 cups'] } }
			]
		});
	});

	it('puts a Need on the list with a note naming the dish and its day', async () => {
		await post('startMenu', { startDate: '2026-10-04', endDate: '2026-10-10' });
		await post('need', { itemId: String(itemId('Butter')) });
		expect(listActiveLines(householdId, TZ, NOW)).toMatchObject([
			{ itemName: 'Butter', quantity: 1, status: 'to_order', note: '2 cups for Pound cake (Tue)' }
		]);
	});
});
