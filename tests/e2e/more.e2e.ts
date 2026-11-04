import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures.ts';

// The More menu in the header (design 7): a tap outside it or Escape closes it.

const more = (page: Page) => page.getByRole('banner').locator('summary');
const menu = (page: Page) => page.getByRole('navigation', { name: 'More' });

test('closes on a tap outside it, which goes to the page', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await more(page).tap();
	await expect(menu(page)).toBeVisible();
	// A tap on More itself still closes it, rather than closing and opening it again.
	await more(page).tap();
	await expect(menu(page)).toBeHidden();

	await more(page).tap();
	await expect(menu(page)).toBeVisible();
	// The left end of the item box, which the menu doesn't cover.
	const item = page.getByRole('combobox', { name: 'Item' });
	await item.tap({ position: { x: 10, y: 10 } });
	await expect(menu(page)).toBeHidden();
	await expect(item).toBeFocused();
});

test('closes with Escape, moving focus on its links back to More', async ({ page, person: _ }) => {
	await open(page, '/groceries');
	await more(page).focus();
	await page.keyboard.press('Enter');
	await expect(menu(page)).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(menu(page).getByRole('link', { name: 'Items' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu(page)).toBeHidden();
	await expect(more(page)).toBeFocused();

	// Focus outside the menu stays where it is.
	await page.keyboard.press('Enter');
	await expect(menu(page)).toBeVisible();
	const item = page.getByRole('combobox', { name: 'Item' });
	await item.focus();
	await page.keyboard.press('Escape');
	await expect(menu(page)).toBeHidden();
	await expect(item).toBeFocused();
});
