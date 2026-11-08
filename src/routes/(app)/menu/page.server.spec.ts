import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDinner, getDinners } from '#lib/server/data/dinners.ts';
import { setDishArchived } from '#lib/server/data/dishes.ts';
import { listMembers } from '#lib/server/data/households.ts';
import {
	addRequest,
	addRestaurantRequest,
	listCompletedRequests,
	listRequests
} from '#lib/server/data/requests.ts';
import { db } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
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
			start: '2026-09-27',
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

	it('gives the weeks before and after, to show beside it during a swipe (MEA-249)', () => {
		const soup = makeDinner(householdId, '2026-09-24', { note: 'Soup night' });
		const pizza = makeDinner(householdId, '2026-10-06', {
			type: 'eat_out',
			restaurantName: 'Pizza'
		});
		// Another household's dinners stay out.
		makeDinner(makeHousehold(TZ).householdId, '2026-10-06', { type: 'leftovers' });

		const data = week();
		expect(data.previousDays?.map((day) => day.date)).toEqual([
			'2026-09-20',
			'2026-09-21',
			'2026-09-22',
			'2026-09-23',
			'2026-09-24',
			'2026-09-25',
			'2026-09-26'
		]);
		expect(data.previousDays?.[4]?.dinners).toEqual([
			{ id: soup, label: null, type: 'cook', restaurantName: null, note: 'Soup night', roles: [] }
		]);
		expect(data.nextDays?.map((day) => day.date)).toEqual([
			'2026-10-04',
			'2026-10-05',
			'2026-10-06',
			'2026-10-07',
			'2026-10-08',
			'2026-10-09',
			'2026-10-10'
		]);
		expect(data.nextDays?.map((day) => day.dinners)).toEqual([
			[],
			[],
			[{ id: pizza, label: null, type: 'eat_out', restaurantName: 'Pizza', note: null, roles: [] }],
			[],
			[],
			[],
			[]
		]);
		// Neither week's dinners show on this one.
		expect(data.days.every((day) => day.dinners.length === 0)).toBe(true);
	});

	it("gives no week either side that can't be shown, at the ends of the calendar", () => {
		// The week after Dec 19 to 25, 9999 ends in year 10000.
		expect(week('9999-12-25')).toMatchObject({ start: '9999-12-19', nextDays: null });
		expect(week('9999-12-25').previousDays?.[0]?.date).toBe('9999-12-12');
		// The week before Jan 2 to 8, year 0, starts in year -1.
		expect(week('0000-01-08')).toMatchObject({ start: '0000-01-02', previousDays: null });
		expect(week('0000-01-08').nextDays?.[0]?.date).toBe('0000-01-09');
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

describe("each day's dinners", () => {
	it('gives the type, the restaurant or the dishes by role in the order added, and the note', () => {
		const dish = (name: string) => makeDish(householdId, recipe(name));
		const [roast, beans, rolls, cake, salad] = ['Roast', 'Beans', 'Rolls', 'Cake', 'Salad'].map(
			dish
		) as [number, number, number, number, number];
		const grandma = makeDinner(householdId, '2026-09-29', {
			note: 'Grandma visits',
			dishes: [
				[cake, 'dessert'],
				[beans, 'side'],
				[roast, 'main'],
				[rolls, 'side']
			]
		});
		const out = makeDinner(householdId, '2026-09-30', {
			type: 'eat_out',
			restaurantName: 'Taco Bar',
			note: 'Tacos on Main St'
		});
		const going = makeDinner(householdId, '2026-10-01', { type: 'going' });
		// Another week's and another household's dinners stay out.
		makeDinner(householdId, '2026-10-04', { dishes: [[salad, 'main']] });
		makeDinner(makeHousehold(TZ).householdId, '2026-09-28', { type: 'leftovers' });

		expect(week().days).toEqual([
			{ date: '2026-09-27', dinners: [] },
			{ date: '2026-09-28', dinners: [] },
			{
				date: '2026-09-29',
				dinners: [
					{
						id: grandma,
						label: null,
						type: 'cook',
						restaurantName: null,
						note: 'Grandma visits',
						roles: [
							{ role: 'main', names: ['Roast'] },
							{ role: 'side', names: ['Beans', 'Rolls'] },
							{ role: 'dessert', names: ['Cake'] }
						]
					}
				]
			},
			{
				date: '2026-09-30',
				dinners: [
					{
						id: out,
						label: null,
						type: 'eat_out',
						restaurantName: 'Taco Bar',
						note: 'Tacos on Main St',
						roles: []
					}
				]
			},
			{
				date: '2026-10-01',
				dinners: [
					{ id: going, label: null, type: 'going', restaurantName: null, note: null, roles: [] }
				]
			},
			{ date: '2026-10-02', dinners: [] },
			{ date: '2026-10-03', dinners: [] }
		]);
	});

	it("gives each of a day's dinners with its label, in the order they were added (6.9)", () => {
		const adults = makeDinner(householdId, '2026-09-29', { type: 'eat_out' });
		const kids = addDinner(householdId, '2026-09-29', { first: 'Adults', added: 'Kids' }, NOW);
		expect(week().days[2]?.dinners).toEqual([
			{ id: adults, label: 'Adults', type: 'eat_out', restaurantName: null, note: null, roles: [] },
			{ id: kids, label: 'Kids', type: 'cook', restaurantName: null, note: null, roles: [] }
		]);
	});

	it('keeps archived dishes on the dinners that have them (6.10)', () => {
		const pie = makeDish(householdId, recipe('Pie'));
		makeDinner(householdId, '2026-09-27', { dishes: [[pie, 'dessert']] });
		setDishArchived(householdId, pie, true, NOW);
		expect(week().days[0]?.dinners[0]?.roles).toEqual([{ role: 'dessert', names: ['Pie'] }]);
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
			// The request added Soup to Recipes.
			expect(data.dishes.map((dish) => dish.name)).toEqual(['Lasagna', 'Soup']);
		}
	});

	it('come from the signed-in person, with the name and note', async () => {
		expect(
			await post('request', { name: 'Pot pie', note: ' Extra crust ', userId: '999' })
		).toEqual({ action: 'request', archived: null });
		expect(listRequests(householdId)).toMatchObject([
			{ name: 'Pot pie', note: 'Extra crust', askedBy: listMembers(householdId)[0]?.displayName }
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
		expect(await post('request', { name: 'a'.repeat(80), note: 'a'.repeat(200) })).toEqual({
			action: 'request',
			archived: null
		});
		expect(listRequests(householdId)).toHaveLength(1);
	});

	it('offer to restore an archived dish, and restore it with the name and note as typed', async () => {
		const chili = makeDish(householdId, recipe('Chili'));
		setDishArchived(householdId, chili, true, NOW);
		expect(await post('request', { name: 'CHILI', note: '' })).toEqual({
			action: 'request',
			archived: { dishId: chili, name: 'Chili' }
		});
		expect(listRequests(householdId)).toEqual([]);
		expect(
			await post('restoreRequest', { dishId: String(chili), name: 'CHILI', note: ' Spicy ' })
		).toBeUndefined();
		expect(listRequests(householdId)).toMatchObject([
			{ name: 'CHILI', note: 'Spicy', dishId: chili }
		]);
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Chili']);
	});

	it("remove one for good, and not another household's", async () => {
		const other = makeHousehold(TZ);
		addRequest(other.householdId, other.userId, { name: 'Curry', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		const [theirs] = listRequests(other.householdId);
		const [ours] = listRequests(householdId);
		expect(await post('removeRequest', { id: String(theirs!.id) })).toMatchObject({ status: 404 });
		expect(await post('removeRequest', { id: String(ours!.id) })).toBeUndefined();
		expect(listRequests(householdId)).toEqual([]);
		expect(listRequests(other.householdId)).toHaveLength(1);
		// It doesn't go in the completed history.
		expect(week().completed).toEqual([]);
	});

	it('are completed into the history, newest first, dated in the household time zone, on every week', async () => {
		addRequest(householdId, userId, { name: 'Soup', note: 'With crackers' }, NOW);
		addRestaurantRequest(householdId, userId, { name: 'Olive Garden', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Pie', note: null }, NOW);
		const [soup, olive] = listRequests(householdId);
		expect(await post('completeRequest', { id: String(olive!.id), userId: '999' })).toBeUndefined();
		vi.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
		expect(await post('completeRequest', { id: String(soup!.id) })).toBeUndefined();
		for (const param of [undefined, '2027-03-10']) {
			const data = week(param);
			expect(data.requests.map((request) => request.name)).toEqual(['Pie']);
			// Sat Oct 3 in Chicago, though already Oct 4 in UTC.
			expect(data.completed).toEqual([
				{ ...soup, completedAt: NOW + 60_000, completedOn: '2026-10-03' },
				{ ...olive, completedAt: NOW, completedOn: '2026-10-03' }
			]);
		}
	});

	it("complete one once, and not another household's or a removed one", async () => {
		const other = makeHousehold(TZ);
		addRequest(other.householdId, other.userId, { name: 'Curry', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Pie', note: null }, NOW);
		const [theirs] = listRequests(other.householdId);
		const [soup, pie] = listRequests(householdId);
		expect(await post('completeRequest', { id: String(theirs!.id) })).toMatchObject({
			status: 404
		});
		expect(await post('completeRequest', { id: String(soup!.id) })).toBeUndefined();
		await post('removeRequest', { id: String(pie!.id) });
		// A page that still shows them, after someone else completed or removed them.
		vi.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
		for (const request of [soup, pie]) {
			for (const action of ['completeRequest', 'removeRequest'] as const) {
				expect(await post(action, { id: String(request!.id) })).toMatchObject({ status: 404 });
			}
		}
		expect(week().completed).toMatchObject([{ name: 'Soup', completedAt: NOW }]);
		expect(listRequests(other.householdId)).toHaveLength(1);
		expect(listCompletedRequests(other.householdId)).toEqual([]);
	});

	it('need a request to complete', async () => {
		expect(await post('completeRequest', { id: 'soup' })).toMatchObject({
			status: 400,
			data: { action: 'requests' }
		});
	});
});

describe('restaurant requests (6.12)', () => {
	it('are listed with dish requests, oldest first, linked to nothing', () => {
		addRestaurantRequest(householdId, userId, { name: 'Olive Garden', note: null }, NOW + 1);
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		expect(week().requests).toEqual([
			expect.objectContaining({ kind: 'dish', name: 'Soup', dishId: expect.any(Number) }),
			{
				id: expect.any(Number),
				kind: 'restaurant',
				name: 'Olive Garden',
				note: null,
				askedBy: listMembers(householdId)[0]?.displayName
			}
		]);
	});

	it('come from the signed-in person, with the name and note', async () => {
		expect(
			await post('requestRestaurant', {
				name: ' Olive  Garden ',
				note: ' For her birthday ',
				userId: '999'
			})
		).toBeUndefined();
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				kind: 'restaurant',
				name: 'Olive Garden',
				note: 'For her birthday',
				askedBy: listMembers(householdId)[0]?.displayName
			}
		]);
	});

	it('leave out an empty note', async () => {
		await post('requestRestaurant', { name: 'Olive Garden', note: '  ' });
		expect(listRequests(householdId)[0]?.note).toBeNull();
	});

	it('need a restaurant name', async () => {
		expectFailure(
			await post('requestRestaurant', { name: '  ', note: '' }),
			'restaurant',
			'Enter a restaurant name'
		);
		expect(listRequests(householdId)).toEqual([]);
	});

	it('refuse an 81-character name and a 201-character note', async () => {
		expectFailure(
			await post('requestRestaurant', { name: 'a'.repeat(81), note: '' }),
			'restaurant',
			'Keep a restaurant name under 80 characters'
		);
		expectFailure(
			await post('requestRestaurant', { name: 'Diner', note: 'a'.repeat(201) }),
			'restaurant',
			'Keep the note under 200 characters'
		);
		expect(
			await post('requestRestaurant', { name: 'a'.repeat(80), note: 'a'.repeat(200) })
		).toBeUndefined();
		expect(listRequests(householdId)).toHaveLength(1);
	});
});

describe('request edits (6.12, MEA-251)', () => {
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

	/** The id of the household's active request with this name, as the form sends it. */
	function requestId(name: string): string {
		const request = listRequests(householdId).find((candidate) => candidate.name === name);
		if (!request) throw new Error(`No request named ${name}`);
		return String(request.id);
	}

	/** An archived dish of the household. */
	function archivedDish(name: string): number {
		const dishId = makeDish(householdId, recipe(name));
		setDishArchived(householdId, dishId, true, NOW);
		return dishId;
	}

	it("save the name and note on anyone's request, keeping who asked", async () => {
		const sam = addMember('Sam');
		addRequest(householdId, sam, { name: 'Soup', note: 'With crackers' }, NOW);
		addRestaurantRequest(householdId, sam, { name: 'Olive Garden', note: null }, NOW);
		const saved = { action: 'editRequest', archived: null };
		expect(
			await post('editRequest', {
				id: requestId('Soup'),
				name: ' Pot  pie ',
				note: ' Extra crust ',
				userId: String(userId)
			})
		).toEqual(saved);
		expect(
			await post('editRequest', { id: requestId('Olive Garden'), name: 'Taco Bar', note: 'Downtown' })
		).toEqual(saved);
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				kind: 'dish',
				name: 'Pot pie',
				note: 'Extra crust',
				dishId: expect.any(Number),
				askedBy: 'Sam'
			},
			{
				id: expect.any(Number),
				kind: 'restaurant',
				name: 'Taco Bar',
				note: 'Downtown',
				askedBy: 'Sam'
			}
		]);
		// The new name added Pot pie to Recipes, and Soup stays there.
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Pot pie', 'Soup']);
	});

	it('leave out an empty note', async () => {
		addRequest(householdId, userId, { name: 'Soup', note: 'With crackers' }, NOW);
		await post('editRequest', { id: requestId('Soup'), name: 'Soup', note: '  ' });
		expect(listRequests(householdId)[0]?.note).toBeNull();
	});

	it('need a name, and refuse an 81-character name or a 201-character note, saying which name', async () => {
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		addRestaurantRequest(householdId, userId, { name: 'Olive Garden', note: null }, NOW);
		const soup = requestId('Soup');
		const olive = requestId('Olive Garden');
		const tries: [Record<string, string>, string][] = [
			[{ id: soup, name: '  ', note: '' }, 'Enter a dish name'],
			[{ id: olive, name: '  ', note: '' }, 'Enter a restaurant name'],
			[{ id: soup, name: 'a'.repeat(81), note: '' }, 'Keep a dish name under 80 characters'],
			[{ id: olive, name: 'a'.repeat(81), note: '' }, 'Keep a restaurant name under 80 characters'],
			[{ id: soup, name: 'Stew', note: 'a'.repeat(201) }, 'Keep the note under 200 characters'],
			[{ id: olive, name: 'Diner', note: 'a'.repeat(201) }, 'Keep the note under 200 characters']
		];
		for (const [fields, error] of tries) {
			expectFailure(await post('editRequest', fields), 'editRequest', error);
		}
		expect(listRequests(householdId).map(({ name, note }) => [name, note])).toEqual([
			['Soup', null],
			['Olive Garden', null]
		]);
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Soup']);
		for (const id of [soup, olive]) {
			expect(
				await post('editRequest', { id, name: 'a'.repeat(80), note: 'a'.repeat(200) })
			).toEqual({ action: 'editRequest', archived: null });
		}
	});

	it('offer to restore an archived dish, and restore it with the name and note as typed', async () => {
		const chili = archivedDish('Chili');
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		const soup = requestId('Soup');
		expect(await post('editRequest', { id: soup, name: 'CHILI', note: 'Spicy' })).toEqual({
			action: 'editRequest',
			archived: { dishId: chili, name: 'Chili' }
		});
		expect(listRequests(householdId)).toMatchObject([{ name: 'Soup', note: null }]);
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Soup']);

		expect(
			await post('restoreAndEditRequest', {
				id: soup,
				dishId: String(chili),
				name: 'CHILI',
				note: ' Spicy '
			})
		).toBeUndefined();
		expect(listRequests(householdId)).toMatchObject([
			{ name: 'CHILI', note: 'Spicy', dishId: chili }
		]);
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Chili', 'Soup']);
	});

	it("are not found for another household's request, or one someone completed or removed", async () => {
		const other = makeHousehold(TZ);
		addRequest(other.householdId, other.userId, { name: 'Curry', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		addRequest(householdId, userId, { name: 'Pie', note: null }, NOW);
		const theirs = String(listRequests(other.householdId)[0]!.id);
		const soup = requestId('Soup');
		const pie = requestId('Pie');
		await post('completeRequest', { id: soup });
		await post('removeRequest', { id: pie });
		const chili = String(archivedDish('Chili'));
		for (const id of [theirs, soup, pie]) {
			expect(await post('editRequest', { id, name: 'Stew', note: '' })).toMatchObject({
				status: 404
			});
			expect(
				await post('restoreAndEditRequest', { id, dishId: chili, name: 'Chili', note: '' })
			).toMatchObject({ status: 404 });
		}
		expect(listRequests(other.householdId)).toMatchObject([{ name: 'Curry', note: null }]);
		expect(week().completed).toMatchObject([{ name: 'Soup', note: null }]);
		expect(week().requests).toEqual([]);
		expect(week().dishes.map((dish) => dish.name)).toEqual(['Pie', 'Soup']);
	});

	it('need a signed-in member of a household', async () => {
		addRequest(householdId, userId, { name: 'Soup', note: null }, NOW);
		const fields = { id: requestId('Soup'), name: 'Stew', note: '', dishId: '1' };
		for (const action of ['editRequest', 'restoreAndEditRequest'] as const) {
			for (const [as, location] of [
				['setup', '/setup'],
				['nobody', '/login']
			] as const) {
				const body = new FormData();
				for (const [name, value] of Object.entries(fields)) body.set(name, value);
				const request = new Request(`http://localhost/menu?/${action}`, { method: 'POST', body });
				const event = { locals: locals(as), request } as unknown as Parameters<
					(typeof actions)[typeof action]
				>[0];
				await expect(actions[action](event)).rejects.toMatchObject({ status: 303, location });
			}
		}
		expect(listRequests(householdId)).toMatchObject([{ name: 'Soup' }]);
	});
});

describe('dragging a day onto another (2.2.2)', () => {
	/** Each of the week's dates with its dinners' ids, as the week shows them. */
	function ids(): Record<string, number[]> {
		return Object.fromEntries(
			week().days.map((day) => [day.date, day.dinners.map((dinner) => dinner.id)])
		);
	}

	it("swaps two days' dinners, and moves them onto a day with none", async () => {
		const roast = makeDinner(householdId, '2026-09-28');
		const out = makeDinner(householdId, '2026-09-30', { type: 'eat_out' });
		const kids = addDinner(householdId, '2026-09-30', { first: 'Adults', added: 'Kids' }, NOW);

		expect(
			await post('move', { from: '2026-09-28', to: '2026-09-30', dinnerId: String(roast) })
		).toBeUndefined();
		expect(ids()).toMatchObject({ '2026-09-28': [out, kids], '2026-09-30': [roast] });

		expect(
			await post('move', { from: '2026-09-28', to: '2026-10-02', dinnerId: String(kids) })
		).toBeUndefined();
		expect(ids()).toMatchObject({ '2026-09-28': [], '2026-10-02': [out, kids] });
	});

	it('returns 404 when the dinner shown on the dragged day is gone', async () => {
		const roast = makeDinner(householdId, '2026-09-28');
		const out = makeDinner(householdId, '2026-09-30', { type: 'eat_out' });
		await post('move', { from: '2026-09-28', to: '2026-10-01', dinnerId: String(roast) });
		const result = await post('move', {
			from: '2026-09-28',
			to: '2026-09-30',
			dinnerId: String(roast)
		});
		expect(isHttpError(result, 404)).toBe(true);
		expect(ids()).toMatchObject({ '2026-09-28': [], '2026-09-30': [out], '2026-10-01': [roast] });
	});

	it("refuses when another dinner was moved onto the dragged day since, and moves nothing", async () => {
		const roast = makeDinner(householdId, '2026-09-28');
		const out = makeDinner(householdId, '2026-09-30', { type: 'eat_out' });
		const going = makeDinner(householdId, '2026-10-01', { type: 'going' });
		await post('move', { from: '2026-10-01', to: '2026-09-28', dinnerId: String(going) });
		expectFailure(
			await post('move', { from: '2026-10-01', to: '2026-09-30', dinnerId: String(going) }),
			'move',
			'Someone changed this dinner since you opened it.'
		);
		expect(ids()).toMatchObject({
			'2026-09-28': [going],
			'2026-09-30': [out],
			'2026-10-01': [roast]
		});
	});

	it("never moves another household's dinners", async () => {
		const other = makeHousehold(TZ).householdId;
		const theirs = makeDinner(other, '2026-09-28');
		const ours = makeDinner(householdId, '2026-09-30');
		const result = await post('move', {
			from: '2026-09-28',
			to: '2026-09-30',
			dinnerId: String(theirs)
		});
		expect(isHttpError(result, 404)).toBe(true);
		expect(getDinners(other, '2026-09-28', '2026-09-30').map((d) => [d.id, d.date])).toEqual([
			[theirs, '2026-09-28']
		]);
		expect(ids()).toMatchObject({ '2026-09-28': [], '2026-09-30': [ours] });
	});

	it('needs both dates and the dinner shown', async () => {
		const roast = makeDinner(householdId, '2026-09-28');
		expectFailure(
			await post('move', { from: '2026-09-28', to: '2026-02-30', dinnerId: String(roast) }),
			'move',
			'Pick a date'
		);
		expect(await post('move', { from: '2026-09-28', to: '2026-09-30' })).toMatchObject({
			status: 400
		});
		expect(ids()['2026-09-28']).toEqual([roast]);
	});

	it('needs a household', async () => {
		const body = new FormData();
		const request = new Request('http://localhost/menu?/move', { method: 'POST', body });
		const event = { locals: locals('setup'), request } as unknown as Parameters<
			typeof actions.move
		>[0];
		await expect(actions.move(event)).rejects.toMatchObject({ status: 303, location: '/setup' });
	});
});
