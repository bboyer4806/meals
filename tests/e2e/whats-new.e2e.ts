import type { Page } from '@playwright/test';
import { expect, signInAs, test } from './fixtures.ts';

// What's new (design 7). 1.6 was released on 2026-10-24.

function setCreatedAt(db: import('better-sqlite3').Database, userId: number, ms: number) {
	db.prepare('update users set created_at = ? where id = ?').run(ms, userId);
}

const more = (page: Page) => page.getByRole('banner').locator('summary');
const link = (page: Page) =>
	page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^What's new/ });

test('lists the releases from More, newest first', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	await more(page).click();
	await expect(page.getByRole('navigation', { name: 'More' }).getByRole('link')).toHaveText([
		'Items',
		'History',
		'Household',
		"What's new"
	]);
	await link(page).click();

	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['1.6', '1.5', '1.4', '1.3', '1.2', '1.1']);
	const [v16, v15, v14, v13, v12, v11] = [
		page.locator('section').nth(0),
		page.locator('section').nth(1),
		page.locator('section').nth(2),
		page.locator('section').nth(3),
		page.locator('section').nth(4),
		page.locator('section').nth(5)
	];
	await expect(v16.getByText('Released October 24, 2026')).toBeVisible();
	await expect(v16.getByRole('listitem')).toHaveText([
		'Add many recipes at once from a CSV file with Import, beside New recipe. Download template gives the columns to fill in, one recipe per row.',
		"Recipes, History and Items search as you type, so there's no Search button to tap.",
		'On a computer, drag a day onto another day on the Menu to swap their dinners.',
		"Requesting a dish that isn't in Recipes adds it there, ready for its recipe, and every request now links to its recipe."
	]);
	await expect(v15.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v15.getByRole('listitem')).toHaveText([
		"Add a dinner on a day's page to plan up to 5 dinners that day, such as one for the kids and one for the adults. Each has its own label, dishes, servings and note.",
		'Check Tried it on a recipe once your household has made it. Tried recipes show a Tried badge on the Recipes list.',
		"Rate a recipe from 1 to 5 stars on its page. Your household's average shows on the recipe and on its card in Recipes.",
		'Sort Recipes by name or by rating with Sort, beside the search box.'
	]);
	await expect(v14.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v14.getByRole('listitem')).toHaveText([
		'Tap Help at the top of any page to see what that page is for and how to use it.',
		'The first time you open the Grocery list, a short tour points out Groceries, Menu, Recipes, More, Help and Send feedback.'
	]);
	await expect(v13.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v13.getByRole('listitem')).toHaveText([
		'Send feedback from any page with the button at the bottom right.',
		'Request a dish on the Menu page, under Requests. Everyone in your household sees who asked for what.',
		"What's new, in the More menu, lists what changed in each release, and a dot shows when there's something new."
	]);
	await expect(v12.getByText('Released October 20, 2026')).toBeVisible();
	await expect(v12.getByRole('listitem')).toHaveText([
		'Recipe, History and Items have a Back link at the top.',
		'Going somewhere is now called Bringing a dish.',
		"Tap a dinner's date at the top of its page to move it to another day.",
		'A day with no dinner starts as Cooking at home, ready for its note and servings.'
	]);
	await expect(v11.getByText('Released October 14, 2026')).toBeVisible();
	await expect(v11.getByRole('listitem')).toHaveText([
		"Saving a dinner's servings and note takes you back to the week, where the day says Saved.",
		'Check pantry is hidden for now.'
	]);
	await expect(page.getByText(/sprint/i)).toHaveCount(0);
});

test("shows a dot until What's new is opened, on every device", async ({
	page,
	db,
	person,
	browser,
	baseURL
}) => {
	setCreatedAt(db, person.userId, Date.UTC(2026, 9, 1, 17));
	await page.goto('/groceries');
	await expect(more(page).locator('.dot')).toBeVisible();
	await expect(more(page).getByText('new', { exact: true })).toHaveClass('visually-hidden');
	await more(page).click();
	await expect(link(page).locator('.dot')).toBeVisible();
	await expect(link(page)).toHaveAccessibleName("What's new new");

	// Hovering doesn't open it.
	await link(page).hover();
	await page.waitForTimeout(500);
	await page.reload();
	await expect(more(page).locator('.dot')).toBeVisible();

	await more(page).click();
	await link(page).click();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await page.goto('/groceries');
	await more(page).click();
	await expect(link(page)).toHaveAccessibleName("What's new");

	const other = await browser.newContext();
	await signInAs(db, other, baseURL, person.userId);
	const phone = await other.newPage();
	await phone.goto('/groceries');
	await expect(phone.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(more(phone).locator('.dot')).toHaveCount(0);
	await other.close();
});

test('shows no dot to someone who joined after the newest release', async ({
	page,
	db,
	person
}) => {
	setCreatedAt(db, person.userId, Date.UTC(2026, 9, 24, 17));
	await page.goto('/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await more(page).click();
	await expect(link(page)).toHaveAccessibleName("What's new");
});
