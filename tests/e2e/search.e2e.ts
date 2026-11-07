import type Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { addItem, addRecipe, addStore, expect, open, test } from './fixtures.ts';

// Recipes, History and Items search as people type (design 7, "Search").

/** Milk, then Bread, received at Aldi, so both are on Items and History shows Bread first. */
function addReceived(db: Database.Database, householdId: number) {
	const aldi = addStore(db, householdId, 'Aldi');
	const now = Date.now();
	for (const name of ['Milk', 'Bread']) {
		const item = addItem(db, householdId, name, { defaultStoreId: aldi });
		db.prepare(
			"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, 1, ?, 'received', ?, ?, ?)"
		).run(householdId, item, aldi, now, now, now);
	}
}

/** Counts the list's data requests, one per search. */
function countLoads(page: Page) {
	const loads = { count: 0 };
	page.on('request', (request) => {
		if (request.url().includes('__data.json')) loads.count += 1;
	});
	return loads;
}

const lists = [
	{ path: '/recipes', label: 'Search recipes', names: '.recipes .name' },
	{ path: '/groceries/history', label: 'Search history', names: 'section.card strong' },
	{ path: '/groceries/items', label: 'Search items', names: '.list .name' }
];

for (const list of lists) {
	test(`searches ${list.path} as people type`, async ({ page, db, person }) => {
		addRecipe(db, person.householdId, { name: 'Banana bread' });
		addRecipe(db, person.householdId, { name: 'Milkshake' });
		addReceived(db, person.householdId);
		const search = page.getByLabel(list.label);
		const names = page.locator(list.names);
		const all: [string, string] =
			list.path === '/recipes' ? ['Banana bread', 'Milkshake'] : ['Bread', 'Milk'];

		await page.goto('/menu');
		await open(page, list.path);
		await expect(names).toHaveText(all);
		await expect(page.getByRole('button', { name: 'Search' })).toHaveCount(0);

		// One search 300 ms after typing stops, and the box keeps focus for the keyboard.
		const loads = countLoads(page);
		await search.pressSequentially('mil', { delay: 100 });
		await expect(page).toHaveURL(/\?q=mil(&|$)/);
		await expect(names).toHaveText([all[1]]);
		expect(loads.count).toBe(1);
		await expect(search).toBeFocused();

		// Clearing the box shows the list with no search.
		await search.fill('');
		await expect(names).toHaveText(all);
		await expect(search).toBeFocused();

		// Enter searches right away.
		await search.fill('bread');
		await search.press('Enter');
		await expect(names).toHaveText([all[0]]);

		// Typing added no Back steps.
		await page.goBack();
		await expect(page).toHaveURL(/\/menu$/);
	});
}

test('keeps what is typed while the list is updating', async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Apple pie' });
	addRecipe(db, person.householdId, { name: 'Pie crust' });
	addRecipe(db, person.householdId, { name: 'Tacos' });
	const search = page.getByLabel('Search recipes');
	const names = page.locator('.recipes .name');

	await open(page, '/recipes');
	// Holds the first search's data until a space is typed after it.
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	let first = true;
	await page.route('**/__data.json*', async (route) => {
		if (first) {
			first = false;
			await held;
		}
		await route.continue();
	});
	const loading = page.waitForRequest('**/__data.json*');
	await search.fill('pie');
	await loading;
	await search.press(' ');
	// The trimmed "pie" lands while the next search is still waiting to start.
	release();
	await expect(names).toHaveText(['Apple pie', 'Pie crust']);
	await expect(search).toHaveValue('pie ');
	await expect(page).toHaveURL(/\?q=pie\+&sort=name$/);
	await expect(search).toHaveValue('pie ');
	await expect(search).toBeFocused();
});

/**
 * Holds the page's next data request until `release` is called, as on a slow connection, and
 * lets every later one through. `sent` resolves once the held request has gone out.
 */
async function holdNextLoad(page: Page) {
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	let first = true;
	await page.route('**/__data.json*', async (route) => {
		if (first) {
			first = false;
			await held;
		}
		await route.continue();
	});
	return { sent: page.waitForRequest('**/__data.json*'), release };
}

// A tag tapped just before typing is a navigation of its own, which can land after the typing
// (MEA-246).
test("keeps what is typed while a tapped tag's list is loading", async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Apple pie', tags: ['Dessert'] });
	addRecipe(db, person.householdId, { name: 'Brownies', tags: ['Dessert'] });
	addRecipe(db, person.householdId, { name: 'Pot pie', tags: ['Dinner'] });
	const search = page.getByLabel('Search recipes');
	const names = page.locator('.recipes .name');
	const tags = page.getByRole('list', { name: 'Filter by tag' });

	await open(page, '/recipes');
	const { sent, release } = await holdNextLoad(page);
	await tags.getByRole('link', { name: 'Dessert', exact: true }).tap();
	await sent;
	await search.fill('pie');
	// The tag's list lands before the search runs, which then searches with the tag.
	release();
	await expect(page).toHaveURL(/\/recipes\?tag=Dessert&q=pie&sort=name$/);
	await expect(search).toHaveValue('pie');
	await expect(names).toHaveText(['Apple pie']);
});

test('keeps the search when the sort changes while it is loading', async ({ page, db, person }) => {
	const rate = db.prepare(
		'insert into dish_ratings (household_id, dish_id, user_id, stars) values (?, ?, ?, ?)'
	);
	const appleId = addRecipe(db, person.householdId, { name: 'Apple pie' });
	const pecanId = addRecipe(db, person.householdId, { name: 'Pecan pie' });
	addRecipe(db, person.householdId, { name: 'Tacos' });
	rate.run(person.householdId, appleId, person.userId, 3);
	rate.run(person.householdId, pecanId, person.userId, 5);
	const search = page.getByLabel('Search recipes');
	const names = page.locator('.recipes .name');

	await open(page, '/recipes');
	const { sent, release } = await holdNextLoad(page);
	await search.fill('pie');
	await search.press('Enter');
	await sent;
	await page.getByLabel('Sort').selectOption('Rating');
	await expect(page).toHaveURL(/\/recipes\?q=pie&sort=rating$/);
	await expect(names).toHaveText(['Pecan pie', 'Apple pie']);
	// The search's own list, landing late, changes nothing.
	release();
	await expect(page).toHaveURL(/\/recipes\?q=pie&sort=rating$/);
	await expect(search).toHaveValue('pie');
	await expect(names).toHaveText(['Pecan pie', 'Apple pie']);
});

test('keeps the list and what is typed when typing offline', async ({
	page,
	context,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Apple pie' });
	addRecipe(db, person.householdId, { name: 'Tacos' });
	const search = page.getByLabel('Search recipes');
	const names = page.locator('.recipes .name');

	await open(page, '/recipes');
	const loads = countLoads(page);
	await context.setOffline(true);
	await search.pressSequentially('pie', { delay: 100 });
	// Longer than the wait after typing stops.
	await page.waitForTimeout(500);
	await expect(names).toHaveText(['Apple pie', 'Tacos']);
	await expect(search).toHaveValue('pie');
	await expect(search).toBeFocused();
	await expect(page).toHaveURL(/\/recipes$/);
	expect(loads.count).toBe(0);

	// Back online, typing searches again.
	await context.setOffline(false);
	await search.press('Backspace');
	await expect(names).toHaveText(['Apple pie']);
	await expect(page).toHaveURL(/\?q=pi&sort=name$/);
});

test('goes Back from a recipe to the search it was opened from', async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Pound cake' });
	addRecipe(db, person.householdId, { name: 'Tacos' });
	const search = page.getByLabel('Search recipes');
	const names = page.locator('.recipes .name');

	await page.goto('/menu');
	await open(page, '/recipes');
	await search.fill('cake');
	await expect(names).toHaveText(['Pound cake']);
	await page.getByRole('link', { name: /Pound cake/ }).click();
	await expect(page.getByRole('heading', { name: 'Pound cake', level: 1 })).toBeVisible();

	await page.goBack();
	await expect(page).toHaveURL(/\/recipes\?q=cake&sort=name$/);
	await expect(search).toHaveValue('cake');
	await expect(names).toHaveText(['Pound cake']);
	await page.goBack();
	await expect(page).toHaveURL(/\/menu$/);
});

test('sets the box from the address on other navigations', async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Pound cake' });
	addRecipe(db, person.householdId, { name: 'Tacos' });
	const search = page.getByLabel('Search recipes');

	await open(page, '/recipes');
	await search.fill('zzz');
	await expect(page.getByText('No recipes matching “zzz”.')).toBeVisible();
	await page.getByRole('link', { name: 'Show all recipes' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(search).toHaveValue('');
	await page.goBack();
	await expect(search).toHaveValue('zzz');
});
