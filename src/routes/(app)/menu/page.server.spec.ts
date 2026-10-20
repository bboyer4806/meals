import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDishArchived } from '#lib/server/data/dishes.ts';
import { listMembers } from '#lib/server/data/households.ts';
import { addRequest, listRequests } from '#lib/server/data/requests.ts';
import { freshDb, makeDinner, makeDish, makeHousehold, recipe } from '#lib/server/testing.ts';
import { actions, load } from './+page.server.ts';

// Sat 2026-10-03 22:00 in Chicago, already Sunday Oct 4 in UTC. The household's week runs from
// Sun Sep 27 to Sat Oct 3.
const NOW = Date.UTC(2026, 9, 4, 3, 0);
const TZ = 'America/Chicago';
const THIS_WEEK = [
	'2026-09-27',
	'2026-09-28',
	'2026-09-29',
	'2026-09-30',
	'2026-10-01',
	'2026-10-02',
	'2026-10-03'
];

let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold(TZ));
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** The signed-in person: a member of the household, someone still in setup, or nobody. */
function locals(as: 'member' | 'setup' | 'nobody' = 'member') {
	if (as === 'nobody') return { user: null };
	const user = { id: userId, email: 'a@example.com', name: 'A', isAdmin: false };
	return { user: { ...user, householdId: as === 'member' ? householdId : null } };
}

type Data = ReturnType<typeof load>;

/** Loads /menu, with ?week= when given, giving what it returned or what it threw. */
function open(week?: string, as?: 'member' | 'setup' | 'nobody'): unknown {
	const url = new URL('http://localhost/menu');
	if (week !== undefined) url.searchParams.set('week', week);
	try {
		return load({ locals: locals(as), url } as unknown as Parameters<typeof load>[0]);
	} catch (e) {
		return e;
	}
}

function week(param?: string): Data {
	const data = open(param);
	if (isRedirect(data)) throw new Error(`Redirected to ${data.location}`);
	return data as Data;
}

function expectRedirect(result: unknown, location: string) {
	expect(isRedirect(result) && [result.status, result.location]).toEqual([303, location]);
}

describe('the week', () => {
	it("shows this week, Sunday to Saturday, in the household's time zone", () => {
		const data = week();
		expect(data.days.map((day) => day.date)).toEqual(THIS_WEEK);
		expect(data).toMatchObject({
			today: '2026-10-03',
			label: 'Sep 27 to Oct 3',
			isThisWeek: true,
			previous: '2026-09-20',
			next: '2026-10-04'
		});
	});

	it('shows the week that holds any date', () => {
		for (const date of ['2026-10-04', '2026-10-07', '2026-10-10']) {
			const data = week(date);
			expect(data.days.map((day) => day.date)).toEqual([
				'2026-10-04',
				'2026-10-05',
				'2026-10-06',
				'2026-10-07',
				'2026-10-08',
				'2026-10-09',
				'2026-10-10'
			]);
			expect(data).toMatchObject({
				label: 'Oct 4 to Oct 10',
				isThisWeek: false,
				previous: '2026-09-27',
				next: '2026-10-11'
			});
		}
		expect(week('2026-09-29')).toMatchObject({ isThisWeek: true, label: 'Sep 27 to Oct 3' });
	});

	it("names the year when the week isn't in this one", () => {
		expect(week('2027-03-10').label).toBe('Mar 7 to Mar 13, 2027');
		expect(week('2025-06-04').label).toBe('Jun 1 to Jun 7, 2025');
		expect(week('2026-12-31').label).toBe('Dec 27, 2026 to Jan 2, 2027');
	});

	it('sends a week that is not a date back to this week', () => {
		for (const param of ['', 'today', '2026-10-7', '2026-02-30', '10/07/2026', '9999-12-31']) {
			expectRedirect(open(param), '/menu');
		}
	});

	it('needs a signed-in member of a household', () => {
		expectRedirect(open(undefined, 'nobody'), '/login');
		expectRedirect(open(undefined, 'setup'), '/setup');
	});
});

describe("each day's dinner", () => {
	it('gives the type, the dishes by role in the order added, and the note', () => {
		const dish = (name: string) => makeDish(householdId, recipe(name));
		const [roast, beans, rolls, cake, salad] = ['Roast', 'Beans', 'Rolls', 'Cake', 'Salad'].map(
			dish
		) as [number, number, number, number, number];
		makeDinner(householdId, '2026-09-29', {
			note: 'Grandma visits',
			dishes: [
				[cake, 'dessert'],
				[beans, 'side'],
				[roast, 'main'],
				[rolls, 'side']
			]
		});
		makeDinner(householdId, '2026-09-30', { type: 'eat_out', note: 'Tacos on Main St' });
		makeDinner(householdId, '2026-10-01', { type: 'going' });
		// Another week's and another household's dinners stay out.
		makeDinner(householdId, '2026-10-04', { dishes: [[salad, 'main']] });
		makeDinner(makeHousehold(TZ).householdId, '2026-09-28', { type: 'leftovers' });

		expect(week().days).toEqual([
			{ date: '2026-09-27', dinner: null },
			{ date: '2026-09-28', dinner: null },
			{
				date: '2026-09-29',
				dinner: {
					type: 'cook',
					note: 'Grandma visits',
					roles: [
						{ role: 'main', names: ['Roast'] },
						{ role: 'side', names: ['Beans', 'Rolls'] },
						{ role: 'dessert', names: ['Cake'] }
					]
				}
			},
			{
				date: '2026-09-30',
				dinner: { type: 'eat_out', note: 'Tacos on Main St', roles: [] }
			},
			{ date: '2026-10-01', dinner: { type: 'going', note: null, roles: [] } },
			{ date: '2026-10-02', dinner: null },
			{ date: '2026-10-03', dinner: null }
		]);
	});

	it('keeps archived dishes on the dinners that have them (6.10)', () => {
		const pie = makeDish(householdId, recipe('Pie'));
		makeDinner(householdId, '2026-09-27', { dishes: [[pie, 'dessert']] });
		setDishArchived(householdId, pie, true, NOW);
		expect(week().days[0]?.dinner?.roles).toEqual([{ role: 'dessert', names: ['Pie'] }]);
	});
});

type Action = keyof typeof actions;

/** Posts a form to /menu, giving what the action returned or what it threw. */
async function post(action: Action, fields: Record<string, string>): Promise<unknown> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const request = new Request(`http://localhost/menu?/${action}`, { method: 'POST', body });
	const event = { locals: locals(), request } as unknown as Parameters<(typeof actions)[Action]>[0];
	try {
		return await actions[action](event);
	} catch (e) {
		return e;
	}
}

function expectFailure(result: unknown, action: string, error: string) {
	expect(result).toMatchObject({ status: 400, data: { action, error } });
}

describe('requests (6.12)', () => {
	it('are listed on every week, with the dish suggestions', () => {
		makeDish(householdId, recipe('Lasagna'));
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		for (const param of [undefined, '2027-03-10']) {
			const data = week(param);
			expect(data.requests.map((request) => request.name)).toEqual(['Soup']);
			expect(data.dishes.map((dish) => dish.name)).toEqual(['Lasagna']);
		}
	});

	it('come from the signed-in person, with the name and note', async () => {
		expect(
			await post('request', { name: 'Pot pie', note: ' Extra crust ', userId: '999' })
		).toBeUndefined();
		expect(listRequests(householdId)).toMatchObject([
			{ name: 'Pot pie', note: 'Extra crust', askedBy: listMembers(householdId)[0]?.name }
		]);
	});

	it('leave out an empty note', async () => {
		await post('request', { name: 'Pot pie', note: '  ' });
		expect(listRequests(householdId)[0]?.note).toBeNull();
	});

	it('need a dish name', async () => {
		expectFailure(await post('request', { name: '  ', note: '' }), 'request', 'Enter a dish name');
	});

	it('refuse an 81-character name and a 201-character note', async () => {
		expectFailure(
			await post('request', { name: 'a'.repeat(81), note: '' }),
			'request',
			'Keep a dish name under 80 characters'
		);
		expectFailure(
			await post('request', { name: 'Pie', note: 'a'.repeat(201) }),
			'request',
			'Keep the note under 200 characters'
		);
		expect(await post('request', { name: 'a'.repeat(80), note: 'a'.repeat(200) })).toBeUndefined();
		expect(listRequests(householdId)).toHaveLength(1);
	});

	it("remove one, and not another household's", async () => {
		const other = makeHousehold(TZ);
		addRequest(other.householdId, other.userId, { name: 'Curry', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		const [theirs] = listRequests(other.householdId);
		const [ours] = listRequests(householdId);
		expect(await post('removeRequest', { id: String(theirs!.id) })).toMatchObject({ status: 404 });
		expect(await post('removeRequest', { id: String(ours!.id) })).toBeUndefined();
		expect(listRequests(householdId)).toEqual([]);
		expect(listRequests(other.householdId)).toHaveLength(1);
	});
});
