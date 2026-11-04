import type Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { addItem, addStore, expect, open, test } from './fixtures.ts';

// Coming back to the app reloads the page only once the server answers, so without a
// connection the page and what was typed stay (design 6.11, MEA-80).

/** Someone else puts an item on the household's list, with no store unless one is given. */
function addLine(
	db: Database.Database,
	householdId: number,
	name: string,
	storeId: number | null = null
) {
	const item = addItem(db, householdId, name);
	db.prepare(
		"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at) values (?, ?, 1, ?, 'to_order', ?)"
	).run(householdId, item, storeId, Date.now());
}

/** Coming back to the tab or app (Q11). */
async function comeBack(page: Page) {
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

function line(page: Page, name: string) {
	return page.getByRole('button', { name: `Mark received: ${name}` });
}

function couldntRefresh(page: Page) {
	return page.getByRole('status').filter({ hasText: "Couldn't refresh" });
}

/** Counts the page's requests whose address includes `path`. */
function countRequests(page: Page, path: string) {
	const requests = { count: 0 };
	page.on('request', (request) => {
		if (request.url().includes(path)) requests.count += 1;
	});
	return requests;
}

test('keeps the list and what was typed when coming back offline', async ({
	page,
	context,
	db,
	person
}) => {
	addLine(db, person.householdId, 'Milk');
	await open(page, '/groceries');
	const item = page.getByRole('combobox', { name: 'Item' });
	await item.fill('Eggs');
	const checks = countRequests(page, '/healthz');
	const loads = countRequests(page, '/__data.json');

	// No signal in the store, and meanwhile someone at home adds bread.
	await context.setOffline(true);
	addLine(db, person.householdId, 'Bread');
	await comeBack(page);
	await expect(couldntRefresh(page)).toBeVisible();
	await expect(line(page, 'Milk')).toBeVisible();
	await expect(line(page, 'Bread')).toHaveCount(0);
	await expect(item).toHaveValue('Eggs');
	// The device knows it's offline, so nothing was asked.
	expect(checks.count).toBe(0);
	expect(loads.count).toBe(0);

	// The connection comes back, and the list reloads with what was typed kept.
	await context.setOffline(false);
	await expect(line(page, 'Bread')).toBeVisible();
	await expect(couldntRefresh(page)).toHaveCount(0);
	await expect(item).toHaveValue('Eggs');
	expect(checks.count).toBe(1);
	expect(loads.count).toBe(1);

	// Once it has reloaded, the connection dropping and coming back doesn't reload it again.
	await context.setOffline(true);
	await context.setOffline(false);
	await page.waitForTimeout(500);
	expect(checks.count).toBe(1);
	expect(loads.count).toBe(1);
});

test("keeps the page when the server doesn't answer, and tries again at the next return", async ({
	page,
	db,
	person
}) => {
	addLine(db, person.householdId, 'Milk');
	await open(page, '/groceries');
	const item = page.getByRole('combobox', { name: 'Item' });
	await item.fill('Eggs');
	const loads = countRequests(page, '/__data.json');
	addLine(db, person.householdId, 'Bread');

	// Online as far as the device knows, but no answer: the check gives up after 3 seconds.
	await page.route('**/healthz', () => {});
	await comeBack(page);
	await expect(couldntRefresh(page)).toBeVisible();
	await expect(line(page, 'Milk')).toBeVisible();
	await expect(item).toHaveValue('Eggs');

	// An answer that isn't OK, as from the proxy while the app restarts, keeps the page too.
	await page.unroute('**/healthz');
	await page.route('**/healthz', (route) => route.fulfill({ status: 502 }));
	const answered = page.waitForResponse('**/healthz');
	await comeBack(page);
	await answered;
	await page.waitForTimeout(500);
	await expect(couldntRefresh(page)).toBeVisible();
	await expect(line(page, 'Bread')).toHaveCount(0);
	expect(loads.count).toBe(0);

	// The next return that reaches the server reloads the list.
	await page.unroute('**/healthz');
	await comeBack(page);
	await expect(line(page, 'Bread')).toBeVisible();
	await expect(couldntRefresh(page)).toHaveCount(0);
	await expect(item).toHaveValue('Eggs');
	expect(loads.count).toBe(1);
});

test('says nothing when an earlier check gives up after a later return reloaded', async ({
	page,
	db,
	person
}) => {
	addLine(db, person.householdId, 'Milk');
	await open(page, '/groceries');

	// The first return's check gets no answer. A second return reaches the server before the
	// first gives up.
	let first = true;
	await page.route('**/healthz', async (route) => {
		if (first) {
			first = false;
			return;
		}
		await route.continue();
	});
	const gaveUp = page.waitForEvent('requestfailed', (request) =>
		request.url().endsWith('/healthz')
	);
	await comeBack(page);
	addLine(db, person.householdId, 'Bread');
	await comeBack(page);
	await expect(line(page, 'Bread')).toBeVisible();

	// The first check's failure comes after the reload, so the page isn't out of date.
	await gaveUp;
	await page.waitForTimeout(500);
	await expect(couldntRefresh(page)).toHaveCount(0);
});

test('ends "Couldn\'t refresh" once a save reloads the page', async ({ page, db, person }) => {
	addLine(db, person.householdId, 'Milk', addStore(db, person.householdId, 'Aldi'));
	await open(page, '/groceries');
	await page.route('**/healthz', (route) => route.fulfill({ status: 502 }));
	await comeBack(page);
	await expect(couldntRefresh(page)).toBeVisible();

	// The server can be reached again, though the device never went offline, so nothing tries
	// again by itself. Checking off a line saves it and reloads the list.
	await page.unroute('**/healthz');
	addLine(db, person.householdId, 'Bread');
	await line(page, 'Milk').click();
	await expect(line(page, 'Bread')).toBeVisible();
	await expect(couldntRefresh(page)).toHaveCount(0);
});
