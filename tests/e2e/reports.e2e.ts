import type { Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import {
	addDays,
	addDinner,
	addItem,
	addPerson,
	addRecipe,
	addStore,
	dayLabel,
	expect,
	open,
	test,
	today
} from './fixtures.ts';

// Reports (design 7, Reports; MEA-14).

const DAY = 24 * 60 * 60 * 1000;

const REPORTS = [
	'Most Frequently Planned Dishes',
	'Most Frequently Purchased Groceries',
	'Most Popular Restaurants',
	'Dinner Breakdown',
	'Forgotten Favorites'
];

const report = (page: Page, name: string) => page.getByRole('region', { name });
const rows = (page: Page, name: string) => report(page, name).getByRole('listitem');
const periods = (page: Page) => page.getByRole('list', { name: 'Period' });

/** The date some days before today in the test households' time zone. */
const ago = (days: number) => addDays(today(), -days);

/** A date as the page shows it, with the year when it isn't this year. */
function dateLabel(date: string): string {
	const year = date.slice(0, 4);
	return year === today().slice(0, 4) ? dayLabel(date) : `${dayLabel(date)}, ${year}`;
}

/**
 * A grocery line for the item, of any quantity, added a month before it was received some days
 * ago. The household needs a store called Walmart.
 */
function addReceived(
	db: Database.Database,
	householdId: number,
	itemId: number,
	daysAgo: number,
	quantity = 1
) {
	const storeId = db
		.prepare("select id from stores where household_id = ? and name = 'Walmart'")
		.pluck()
		.get(householdId);
	const receivedAt = Date.now() - daysAgo * DAY;
	db.prepare(
		`insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, received_at)
		values (?, ?, ?, ?, 'received', ?, ?)`
	).run(householdId, itemId, quantity, storeId, receivedAt - 30 * DAY, receivedAt);
}

test('More opens Reports: five reports in order, for the last 90 days to start', async ({
	page,
	person: _
}) => {
	await open(page, '/groceries');
	await page.getByRole('banner').locator('summary').tap();
	await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Reports' }).tap();
	await expect(page).toHaveURL('/reports');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reports');
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(REPORTS);
	await expect(periods(page).getByRole('link')).toHaveText([
		'Last 30 days',
		'Last 90 days',
		'Last 12 months',
		'All time'
	]);
	await expect(periods(page).getByRole('link', { name: 'Last 90 days' })).toHaveAttribute(
		'aria-current',
		'true'
	);

	// A new household has nothing to report yet, and each report says so.
	await expect(report(page, REPORTS[0]!)).toContainText('No dishes were planned in this period.');
	await expect(report(page, REPORTS[1]!)).toContainText('Nothing was received in this period.');
	await expect(report(page, REPORTS[2]!)).toContainText(
		'No Eating out dinners with a restaurant in this period.'
	);
	await expect(report(page, REPORTS[3]!)).toContainText('No dinners were planned in this period.');
	await expect(report(page, REPORTS[4]!)).toContainText('No forgotten favorites right now.');
	// It fits a phone without scrolling sideways.
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		page.viewportSize()?.width ?? 0
	);
});

test("counts each period's dinners and groceries through today", async ({ page, db, person }) => {
	const { householdId } = person;
	const tacos = addRecipe(db, householdId, { name: 'Tacos' });
	const rice = addRecipe(db, householdId, { name: 'Rice' });
	for (const days of [5, 60, 200, 500, -3]) {
		addDinner(db, householdId, ago(days), { dishes: [[tacos, 'main']] });
	}
	// Two dinners on one date, one Bringing a dish, each count.
	addDinner(db, householdId, ago(5), { type: 'going', dishes: [[rice, 'main']] });
	addDinner(db, householdId, ago(10), { type: 'eat_out', restaurantName: 'Thai Garden' });
	addDinner(db, householdId, ago(100), { type: 'eat_out', restaurantName: 'thai garden' });
	addDinner(db, householdId, ago(2), { type: 'eat_out' });
	addDinner(db, householdId, ago(1), { type: 'leftovers' });
	addStore(db, householdId, 'Walmart');
	const milk = addItem(db, householdId, 'Milk');
	for (const days of [3, 45, 400]) addReceived(db, householdId, milk, days);
	addReceived(db, householdId, addItem(db, householdId, 'Eggs'), 20, 24);

	await open(page, '/reports');
	await expect(rows(page, REPORTS[0]!)).toHaveText(['Tacos 2', 'Rice 1']);
	await expect(rows(page, REPORTS[1]!)).toHaveText(['Milk 2', 'Eggs 1']);
	await expect(rows(page, REPORTS[2]!)).toHaveText(['Thai Garden 1']);
	await expect(report(page, REPORTS[3]!)).toContainText("The share of this period's 6 dinners");
	await expect(rows(page, REPORTS[3]!)).toHaveText([
		'Cooking at home 33% · 2 dinners',
		'Eating out 33% · 2 dinners',
		'Leftovers 17% · 1 dinner',
		'Bringing a dish 17% · 1 dinner'
	]);

	await periods(page).getByRole('link', { name: 'Last 30 days' }).tap();
	await expect(page).toHaveURL('/reports?period=30d');
	await expect(periods(page).getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect(rows(page, REPORTS[0]!)).toHaveText(['Rice 1', 'Tacos 1']);
	await expect(rows(page, REPORTS[1]!)).toHaveText(['Eggs 1', 'Milk 1']);
	await expect(rows(page, REPORTS[2]!)).toHaveText(['Thai Garden 1']);
	await expect(rows(page, REPORTS[3]!)).toHaveText([
		'Cooking at home 20% · 1 dinner',
		'Eating out 40% · 2 dinners',
		'Leftovers 20% · 1 dinner',
		'Bringing a dish 20% · 1 dinner'
	]);

	// Names that differ only in case are one restaurant.
	await periods(page).getByRole('link', { name: 'Last 12 months' }).tap();
	await expect(rows(page, REPORTS[0]!)).toHaveText(['Tacos 3', 'Rice 1']);
	await expect(rows(page, REPORTS[1]!)).toHaveText(['Milk 2', 'Eggs 1']);
	await expect(rows(page, REPORTS[2]!)).toHaveText(['Thai Garden 2']);

	await periods(page).getByRole('link', { name: 'All time' }).tap();
	await expect(rows(page, REPORTS[0]!)).toHaveText(['Tacos 4', 'Rice 1']);
	await expect(rows(page, REPORTS[1]!)).toHaveText(['Milk 3', 'Eggs 1']);
});

test('Forgotten Favorites lists dishes planned often but not lately, whatever the period', async ({
	page,
	db,
	person
}) => {
	const { householdId } = person;
	const roast = addRecipe(db, householdId, { name: 'Pot roast' });
	const soup = addRecipe(db, householdId, { name: 'Soup' });
	const chili = addRecipe(db, householdId, { name: 'Chili', archived: true });
	for (const days of [100, 200, 300, 400]) {
		addDinner(db, householdId, ago(days), { dishes: [[roast, 'main']] });
		addDinner(db, householdId, ago(days), { dishes: [[chili, 'main']] });
	}
	// Planned in the last 90 days, so not forgotten.
	for (const days of [10, 200, 300]) {
		addDinner(db, householdId, ago(days), { dishes: [[soup, 'main']] });
	}

	for (const period of ['', '?period=30d', '?period=all']) {
		await open(page, `/reports${period}`);
		await expect(rows(page, REPORTS[4]!)).toHaveText([
			`Pot roast 4 Last planned ${dateLabel(ago(100))}`
		]);
	}
	await rows(page, REPORTS[4]!).getByRole('link').tap();
	await expect(page).toHaveURL(`/recipes/${roast}`);
});

test('shows the top 10, and Show all the rest, starting again for each period', async ({
	page,
	db,
	person
}) => {
	const names = Array.from({ length: 12 }, (_, i) => `Dish ${String(i + 1).padStart(2, '0')}`);
	for (const name of names) {
		const dishId = addRecipe(db, person.householdId, { name });
		addDinner(db, person.householdId, ago(5), { dishes: [[dishId, 'main']] });
	}

	await open(page, '/reports');
	const dishes = rows(page, REPORTS[0]!);
	await expect(dishes).toHaveText(names.slice(0, 10).map((name) => `${name} 1`));
	const showAll = report(page, REPORTS[0]!).getByRole('button', { name: 'Show all 12' });
	await expect(showAll).toHaveAttribute('aria-expanded', 'false');
	await showAll.tap();
	await expect(dishes).toHaveText(names.map((name) => `${name} 1`));
	const showTop = report(page, REPORTS[0]!).getByRole('button', { name: 'Show top 10' });
	await expect(showTop).toHaveAttribute('aria-expanded', 'true');
	await showTop.tap();
	await expect(dishes).toHaveCount(10);

	await report(page, REPORTS[0]!).getByRole('button', { name: 'Show all 12' }).tap();
	await expect(dishes).toHaveCount(12);
	await periods(page).getByRole('link', { name: 'Last 30 days' }).tap();
	await expect(page).toHaveURL('/reports?period=30d');
	await expect(dishes).toHaveCount(10);
});

test('opens dishes on their recipe and items in their sheet on Items, archived ones too', async ({
	page,
	db,
	person
}) => {
	const { householdId } = person;
	const chili = addRecipe(db, householdId, { name: 'Old chili', archived: true });
	addDinner(db, householdId, ago(3), { dishes: [[chili, 'main']] });
	addStore(db, householdId, 'Walmart');
	const milk = addItem(db, householdId, 'Milk');
	const saffron = addItem(db, householdId, 'Saffron');
	db.prepare('update items set archived_at = ? where id = ?').run(Date.now(), saffron);
	addReceived(db, householdId, milk, 2);
	addReceived(db, householdId, milk, 4);
	addReceived(db, householdId, saffron, 2);

	await open(page, '/reports');
	await rows(page, REPORTS[0]!).getByRole('link', { name: /Old chili/ }).tap();
	await expect(page).toHaveURL(`/recipes/${chili}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Old chili');

	await page.goBack();
	await rows(page, REPORTS[1]!).getByRole('link', { name: /Saffron/ }).tap();
	await expect(page).toHaveURL(`/groceries/items?item=${saffron}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Archived items');
	const sheet = page.getByRole('dialog', { name: 'Saffron' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByLabel('Name')).toHaveValue('Saffron');
	await expect(sheet.getByRole('button', { name: 'Restore' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Close' }).tap();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('button', { name: /^Saffron/ })).toBeVisible();

	await page.goBack();
	await rows(page, REPORTS[1]!).getByRole('link', { name: /Milk/ }).tap();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Items');
	const milkSheet = page.getByRole('dialog', { name: 'Milk' });
	await expect(milkSheet).toBeVisible();
	await expect(milkSheet.getByRole('button', { name: 'Archive' })).toBeVisible();
});

test("doesn't open another household's recipe or item", async ({ page, db, person: _ }) => {
	const other = addPerson(db);
	const theirDish = addRecipe(db, other.householdId, { name: 'Paella' });
	const theirItem = addItem(db, other.householdId, 'Saffron');
	addDinner(db, other.householdId, ago(3), { dishes: [[theirDish, 'main']] });
	addStore(db, other.householdId, 'Walmart');
	addReceived(db, other.householdId, theirItem, 2);

	await open(page, '/reports?period=all');
	await expect(report(page, REPORTS[0]!)).toContainText('No dishes were planned in this period.');
	await expect(report(page, REPORTS[1]!)).toContainText('Nothing was received in this period.');

	await page.goto(`/recipes/${theirDish}`);
	await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
	await page.goto(`/groceries/items?item=${theirItem}`);
	await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});
