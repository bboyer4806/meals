import type { Page } from '@playwright/test';
import { expect, signInAs, test } from './fixtures.ts';

// What's new (design 7). 1.2 was released on 2026-10-20.

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
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['1.2', '1.1']);
	const [newer, older] = [page.locator('section').nth(0), page.locator('section').nth(1)];
	await expect(newer.getByText('Released October 20, 2026')).toBeVisible();
	await expect(newer.getByRole('listitem')).toHaveText([
		'Recipe, History and Items have a Back link at the top.',
		'Going somewhere is now called Bringing a dish.',
		"Tap a dinner's date at the top of its page to move it to another day.",
		'A day with no dinner starts as Cooking at home, ready for its note and servings.'
	]);
	await expect(older.getByText('Released October 14, 2026')).toBeVisible();
	await expect(older.getByRole('listitem')).toHaveText([
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
	setCreatedAt(db, person.userId, Date.UTC(2026, 9, 21, 17));
	await page.goto('/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await more(page).click();
	await expect(link(page)).toHaveAccessibleName("What's new");
});
