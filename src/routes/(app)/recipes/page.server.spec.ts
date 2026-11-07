import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDishArchived } from '#lib/server/data/dishes.ts';
import { freshDb, makeDinner, makeDish, makeHousehold, recipe } from '#lib/server/testing.ts';
import { load } from './+page.server.ts';

// The Recipes page's List and Grouped views (section 7, "Recipes"; MEA-246).

// Sat 2026-10-03 22:00 in Chicago, already Sunday Oct 4 in UTC and Sunday afternoon in Auckland.
const NOW = Date.UTC(2026, 9, 4, 3, 0);

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

/** Loads /recipes with the query as a member of the household. */
function open(query = '', member = { householdId, userId }) {
	const url = new URL(`http://localhost/recipes${query}`);
	const user = { id: member.userId, email: 'a@example.com', name: 'A', isAdmin: false };
	const locals = { user: { ...user, householdId: member.householdId } };
	return load({ locals, url } as unknown as Parameters<typeof load>[0]);
}

function grouped(query: string, member = { householdId, userId }) {
	const data = open(query, member);
	if (data.view !== 'grouped') throw new Error(`Not grouped: ${query}`);
	return data;
}

const names = (dishes: { name: string }[]) => dishes.map((dish) => dish.name);

describe('the view', () => {
	it('lists recipes by default, and for a missing or unknown view', () => {
		makeDish(householdId, recipe('Tacos'));
		for (const query of ['', '?view=list', '?view=', '?view=cards', '?view=GROUPED']) {
			const data = open(query);
			expect(data.view === 'list' && names(data.recipes), query).toEqual(['Tacos']);
		}
	});

	it("groups recipes by their last date on the Menu up to the household's today", () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const chili = makeDish(householdId, recipe('Chili'));
		const soup = makeDish(householdId, recipe('Soup'));
		// Tomorrow in Chicago, though already today in UTC.
		makeDinner(householdId, '2026-10-04', { dishes: [[tacos, 'main']] });
		// 60 and 61 days before Sat Oct 3.
		makeDinner(householdId, '2026-08-04', { dishes: [[chili, 'main']] });
		makeDinner(householdId, '2026-08-03', { dishes: [[soup, 'main']] });

		const data = grouped('?view=grouped');
		expect(data.today).toBe('2026-10-03');
		expect(names(data.groups.recent)).toEqual(['Chili']);
		expect(names(data.groups.longAgo)).toEqual(['Soup']);
		expect(names(data.groups.never)).toEqual(['Tacos']);

		// In Auckland it's already Sunday, so the same Menu there has Sunday's dinner made, and
		// 60 days ago is a day later.
		const auckland = makeHousehold('Pacific/Auckland');
		const theirTacos = makeDish(auckland.householdId, recipe('Tacos'));
		const theirChili = makeDish(auckland.householdId, recipe('Chili'));
		makeDinner(auckland.householdId, '2026-10-04', { dishes: [[theirTacos, 'main']] });
		makeDinner(auckland.householdId, '2026-08-04', { dishes: [[theirChili, 'main']] });
		const theirs = grouped('?view=grouped', auckland);
		expect(theirs.today).toBe('2026-10-04');
		expect(names(theirs.groups.recent)).toEqual(['Tacos']);
		expect(names(theirs.groups.longAgo)).toEqual(['Chili']);
		expect(names(theirs.groups.never)).toEqual([]);
	});

	it('applies the search and tags to the groups, and keeps the sort for the list', () => {
		const apple = makeDish(householdId, recipe('Apple pie', { tags: ['Dessert'] }));
		makeDish(householdId, recipe('Pecan pie', { tags: ['Dessert'] }));
		makeDish(householdId, recipe('Brownies', { tags: ['Dessert'] }));
		makeDish(householdId, recipe('Pot pie'));
		makeDinner(householdId, '2026-09-30', { dishes: [[apple, 'dessert']] });

		const data = grouped('?view=grouped&q=+PIE+&tag=dessert&sort=rating');
		expect(data).toMatchObject({ search: 'PIE', selectedTags: ['dessert'], sort: 'rating' });
		expect(names(data.groups.recent)).toEqual(['Apple pie']);
		expect(names(data.groups.longAgo)).toEqual([]);
		expect(names(data.groups.never)).toEqual(['Pecan pie']);
	});

	it('only lists archived recipes', () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		makeDish(householdId, recipe('Chili'));
		makeDinner(householdId, '2026-09-30', { dishes: [[tacos, 'main']] });
		setDishArchived(householdId, tacos, true, NOW);

		const data = open('?archived=1&view=grouped');
		expect(data.view === 'list' && names(data.recipes)).toEqual(['Tacos']);
		expect(names(grouped('?view=grouped').groups.never)).toEqual(['Chili']);
		expect(grouped('?view=grouped').groups.recent).toEqual([]);
	});
});
