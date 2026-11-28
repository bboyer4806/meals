import type Database from 'better-sqlite3';
import { addItem, addStore, dayLabel, expect, open, test, today } from './fixtures.ts';

/** Receives `count` lines of the item at the store, a millisecond apart, numbered by quantity. */
function receiveLines(
	db: Database.Database,
	householdId: number,
	store: number,
	name: string,
	count: number
) {
	const item = addItem(db, householdId, name, { defaultStoreId: store });
	const insert = db.prepare(
		"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, ?, ?, 'received', ?, ?, ?)"
	);
	const now = Date.now();
	for (let number = 1; number <= count; number += 1) {
		const at = now - number;
		insert.run(householdId, item, number, store, at, at, at);
	}
}

test('shows the year on dates from earlier years', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	const receive = (name: string, at: number) => {
		const item = addItem(db, person.householdId, name, { defaultStoreId: aldi });
		db.prepare(
			"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, 1, ?, 'received', ?, ?, ?)"
		).run(person.householdId, item, aldi, at, at, at);
	};
	receive('Bread', Date.now());
	// Noon on Sun, Oct 19, 2025 in Chicago, where the household is.
	receive('Milk', Date.UTC(2025, 9, 19, 17, 0));

	await page.goto('/groceries/history');
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
		dayLabel(today()),
		'Sun, Oct 19, 2025'
	]);
});

// Show older adds the older lines below the ones read, and Back leaves History (design 7, MEA-137).
test("Show older keeps the reader's place and adds no Back step", async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	receiveLines(db, person.householdId, aldi, 'Milk', 150);
	const lines = page.locator('section.card li');
	const showOlder = page.getByRole('link', { name: 'Show older' });
	const scrollY = () => page.evaluate(() => window.scrollY);

	await page.goto('/groceries');
	await open(page, '/groceries/history');
	await expect(lines).toHaveCount(100);
	// With no search, its address has no q.
	await expect(showOlder).toHaveAttribute('href', '?show=200');

	// At the bottom of the newest 100.
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	const scrolled = await scrollY();
	expect(scrolled).toBeGreaterThan(0);
	const where = await lines.nth(99).boundingBox();

	await showOlder.click();
	await expect(lines).toHaveCount(150);
	await expect(page).toHaveURL(/\/groceries\/history\?show=200$/);
	expect(await scrollY()).toBe(scrolled);
	expect(await lines.nth(99).boundingBox()).toEqual(where);
	await expect(lines.nth(100)).toBeInViewport();
	await expect(showOlder).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(/\/groceries$/);
});

test('Show older keeps the search', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	receiveLines(db, person.householdId, aldi, 'Milk', 150);
	// Received too, and left out by the search.
	receiveLines(db, person.householdId, aldi, 'Bread', 1);
	const lines = page.locator('section.card li');
	const showOlder = page.getByRole('link', { name: 'Show older' });

	await open(page, '/groceries/history?q=milk');
	await expect(showOlder).toHaveAttribute('href', '?q=milk&show=200');

	await showOlder.click();
	await expect(lines).toHaveCount(150);
	await expect(page).toHaveURL(/\/groceries\/history\?q=milk&show=200$/);
	await expect(page.getByLabel('Search history')).toHaveValue('milk');
});
