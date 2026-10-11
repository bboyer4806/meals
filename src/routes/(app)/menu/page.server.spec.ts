import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDishArchived } from '#lib/server/data/dishes.ts';
import { findItemByName } from '#lib/server/data/items.ts';
import { markHave, startMenuChecklist } from '#lib/server/data/pantry.ts';
import {
	freshDb,
	ingredient,
	makeDinner,
	makeDish,
	makeHousehold,
	recipe
} from '#lib/server/testing.ts';
import { load } from './+page.server.ts';

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

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** The signed-in person: a member of the household, someone still in setup, or nobody. */
function locals(as: 'member' | 'setup' | 'nobody' = 'member') {
	if (as === 'nobody') return { user: null };
	const user = { id: 1, email: 'a@example.com', name: 'A', isAdmin: false };
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

describe('Check pantry', () => {
	it('starts with today and the 6 days after it, in any week', () => {
		const expected = { startDate: '2026-10-03', endDate: '2026-10-09' };
		expect(week().check).toEqual(expected);
		expect(week('2026-11-20').check).toEqual(expected);
	});

	it('says how many items the current check has checked', () => {
		expect(week().pantryMarked).toBe(0);
		const cake = makeDish(
			householdId,
			recipe('Cake', { ingredients: [ingredient('Butter', 1, 'cup'), ingredient('Sugar')] })
		);
		makeDinner(householdId, '2026-10-03', { dishes: [[cake, 'dessert']] });
		startMenuChecklist(householdId, '2026-10-03', '2026-10-09', false, NOW);
		expect(week().pantryMarked).toBe(0);
		const butter = findItemByName(householdId, 'Butter');
		if (!butter) throw new Error('No butter');
		markHave(householdId, butter.id);
		expect(week().pantryMarked).toBe(1);
	});
});
