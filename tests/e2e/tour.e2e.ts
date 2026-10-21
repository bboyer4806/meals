import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures.ts';

// The first-time tour on the Grocery list (design 7, "Tour").

test.use({ tourSeen: false });

const tour = (page: Page) => page.getByRole('dialog');
const next = (page: Page) => tour(page).getByRole('button', { name: 'Next' });

const STEPS = ['Groceries', 'Menu', 'Recipes', 'More', 'Help', 'Send feedback'];

test('steps through each control to Done, then never shows again', async ({
	page,
	db,
	person
}) => {
	await open(page, '/groceries');
	for (const [index, title] of STEPS.entries()) {
		await expect(tour(page)).toContainText(`${index + 1} of 6`);
		await expect(tour(page).getByRole('heading', { name: title })).toBeVisible();
		await expect(tour(page).getByRole('button', { name: 'Skip' })).toBeVisible();
		if (index < STEPS.length - 1) await next(page).click();
	}
	await expect(next(page)).toHaveCount(0);
	await tour(page).getByRole('button', { name: 'Done' }).click();
	await expect(tour(page)).toHaveCount(0);
	expect(db.prepare('select tour_seen from users where id = ?').pluck().get(person.userId)).not.toBeNull();

	await open(page, '/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(tour(page)).toHaveCount(0);
});

test('Skip ends it for good', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await next(page).click();
	await tour(page).getByRole('button', { name: 'Skip' }).click();
	await expect(tour(page)).toHaveCount(0);

	await open(page, '/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(tour(page)).toHaveCount(0);
});

test('Escape ends it for good', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await expect(tour(page)).toContainText('1 of 6');
	await page.keyboard.press('Escape');
	await expect(tour(page)).toHaveCount(0);

	await open(page, '/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(tour(page)).toHaveCount(0);
});

test('starts again from step 1 after a reload partway through', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await next(page).click();
	await next(page).click();
	await expect(tour(page)).toContainText('3 of 6');

	await open(page, '/groceries');
	await expect(tour(page)).toContainText('1 of 6');
});

test('keeps the page behind from being tapped', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await expect(tour(page)).toContainText('1 of 6');
	await page.getByRole('link', { name: 'Menu' }).click({ force: true });
	await expect(page).toHaveURL(/\/groceries$/);
	await expect(tour(page)).toContainText('1 of 6');
});

test("doesn't show on Menu or Recipes", async ({ page, person: _ }) => {
	for (const [path, heading] of [
		['/menu', 'Menu'],
		['/recipes', 'Recipes']
	] as const) {
		await open(page, path);
		await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
		await expect(tour(page)).toHaveCount(0);
	}
});
