import { isRedirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/server/db/index.ts';
import { groceryNeeds } from '#lib/server/db/schema.ts';
import { addNeed, markReceived } from '#lib/server/data/needs.ts';
import {
	freshDb,
	makeDinner,
	makeDish,
	makeHousehold,
	makeStore,
	recipe
} from '#lib/server/testing.ts';
import { load } from './+page.server.ts';

// Reports' periods, in the household's dates (design 7, Reports; MEA-14).

// Sat 2026-11-21 22:00 in Chicago, already Sunday Nov 22 in UTC and in Auckland.
const NOW = Date.UTC(2026, 10, 22, 4, 0);

let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold('America/Chicago'));
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
	vi.restoreAllMocks();
});

type Member = { householdId: number; userId: number };

/** Loads /reports with the query as a member of the household. */
function open(query = '', member: Member = { householdId, userId }) {
	const url = new URL(`http://localhost/reports${query}`);
	const user = { id: member.userId, email: 'a@example.com', name: 'A', isAdmin: false };
	const locals = { user: { ...user, householdId: member.householdId } };
	return load({ locals, url } as unknown as Parameters<typeof load>[0]);
}

const counts = (rows: { name: string; count: number }[]) =>
	rows.map(({ name, count }) => [name, count]);

/** Puts the item on the household's list and checks it off at `received`. */
function buy(member: Member, store: number, itemName: string, received: number) {
	const input = { itemName, quantity: 1, unit: null, store, resolution: 'none' } as const;
	expect(addNeed(member.householdId, input, received - 1).kind).toBe('added');
	const line = db()
		.select({ id: groceryNeeds.id })
		.from(groceryNeeds)
		.where(eq(groceryNeeds.householdId, member.householdId))
		.orderBy(desc(groceryNeeds.id))
		.get();
	if (!line) throw new Error('No line');
	markReceived(member.householdId, line.id, undefined, received);
}

describe('the period', () => {
	it('is Last 90 days to start with, and for a missing or unknown period', () => {
		for (const query of ['', '?period=', '?period=week', '?period=90D']) {
			expect(open(query).period, query).toBe('90d');
		}
		expect(open('?period=12m').period).toBe('12m');
	});

	it("counts dinners from its first date through the household's today", () => {
		const soup = makeDish(householdId, recipe('Soup'));
		// Tomorrow in Chicago, though already today in UTC; then 30 and 31 days before today.
		for (const date of ['2026-11-22', '2026-10-22', '2026-10-21']) {
			makeDinner(householdId, date, { type: 'eat_out', restaurantName: 'Pho' });
			makeDinner(householdId, date, { dishes: [[soup, 'main']] });
		}
		const data = open('?period=30d');
		expect(data.today).toBe('2026-11-21');
		expect(counts(data.dishes)).toEqual([['Soup', 1]]);
		expect(counts(data.restaurants)).toEqual([['Pho', 1]]);
		expect(data.dinnerTypes).toEqual({ cook: 1, eat_out: 1, going: 0, leftovers: 0 });

		// In Auckland it's already Sunday, so its dinner that day counts, and 30 days before is a
		// day later.
		const auckland = makeHousehold('Pacific/Auckland');
		const theirSoup = makeDish(auckland.householdId, recipe('Soup'));
		for (const date of ['2026-11-22', '2026-10-23', '2026-10-22']) {
			makeDinner(auckland.householdId, date, { dishes: [[theirSoup, 'main']] });
		}
		const theirs = open('?period=30d', auckland);
		expect(theirs.today).toBe('2026-11-22');
		expect(counts(theirs.dishes)).toEqual([['Soup', 2]]);
	});

	it('counts each period from its own first date, and All time from the first dinner', () => {
		const chili = makeDish(householdId, recipe('Chili'));
		// The first dates of Last 30 days, Last 90 days and Last 12 months, the days before the
		// last two, and two years before today.
		const dates = ['2026-10-22', '2026-08-23', '2025-11-21', '2026-08-22', '2025-11-20'];
		for (const date of [...dates, '2024-11-21']) {
			makeDinner(householdId, date, { dishes: [[chili, 'main']] });
		}
		const timesIn = (period: string) => open(`?period=${period}`).dishes[0]?.count;
		expect(timesIn('30d')).toBe(1);
		expect(timesIn('90d')).toBe(2);
		expect(timesIn('12m')).toBe(4);
		expect(timesIn('all')).toBe(6);
	});

	it("counts grocery lines from when its first date starts in the household's time zone", () => {
		const store = makeStore(householdId, 'Walmart');
		const member = { householdId, userId };
		// Oct 22, 30 days before today, starts at 05:00 UTC in Chicago's daylight time.
		buy(member, store, 'Milk', Date.UTC(2026, 9, 22, 5, 0));
		buy(member, store, 'Eggs', Date.UTC(2026, 9, 22, 4, 59, 59, 999));
		expect(counts(open('?period=30d').groceries)).toEqual([['Milk', 1]]);
		expect(counts(open('?period=all').groceries)).toEqual([
			['Eggs', 1],
			['Milk', 1]
		]);
	});

	it("doesn't change Forgotten Favorites", () => {
		const roast = makeDish(householdId, recipe('Pot roast'));
		for (const date of ['2026-01-04', '2026-03-01', '2026-05-03']) {
			makeDinner(householdId, date, { dishes: [[roast, 'main']] });
		}
		for (const period of ['30d', '90d', '12m', 'all']) {
			expect(open(`?period=${period}`).forgotten, period).toEqual([
				{ id: roast, name: 'Pot roast', count: 3, lastPlanned: '2026-05-03' }
			]);
		}
	});
});

describe('who can see it', () => {
	it("shows only the signed-in member's household", () => {
		const other = makeHousehold('America/Chicago');
		const theirs = makeDish(other.householdId, recipe('Paella'));
		for (const date of ['2026-01-04', '2026-03-01', '2026-11-20']) {
			makeDinner(other.householdId, date, { dishes: [[theirs, 'main']] });
		}
		makeDinner(other.householdId, '2026-11-20', { type: 'eat_out', restaurantName: 'Pho' });
		buy(other, makeStore(other.householdId, 'Aldi'), 'Milk', NOW - 1000);

		const data = open('?period=all');
		expect(data.dishes).toEqual([]);
		expect(data.groceries).toEqual([]);
		expect(data.restaurants).toEqual([]);
		expect(data.dinnerTypes).toEqual({ cook: 0, eat_out: 0, going: 0, leftovers: 0 });
		expect(data.forgotten).toEqual([]);
		expect(counts(open('?period=all', other).dishes)).toEqual([['Paella', 3]]);
	});

	it('sends someone signed out to sign in', () => {
		const url = new URL('http://localhost/reports');
		try {
			load({ locals: { user: null }, url } as unknown as Parameters<typeof load>[0]);
		} catch (e) {
			expect(isRedirect(e) && e.location).toBe('/login');
			return;
		}
		expect.fail('expected a redirect');
	});
});
