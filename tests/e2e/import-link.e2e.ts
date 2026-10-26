import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures.ts';

// Import from a link (design 7) on New recipe. The server fetches the page, and refuses
// addresses on its own computer (design 4.5), which are the only ones these tests have. So
// they import the app's own address to see what a page that can't be opened does.

const link = (page: Page) => page.getByLabel('Link', { exact: true });
const importButton = (page: Page) => page.getByRole('button', { name: 'Import', exact: true });

test('puts the Link field and Import above the editor', async ({ page, person: _signedIn }) => {
	await open(page, '/recipes/new');
	await expect(link(page)).toHaveAttribute('type', 'url');
	await expect(link(page)).toHaveAccessibleDescription(
		"Paste a recipe's web address to fill in the recipe below."
	);
	const field = (await link(page).boundingBox())!;
	const button = (await importButton(page).boundingBox())!;
	const name = (await page.getByLabel('Name', { exact: true }).boundingBox())!;
	// Side by side, on one line of a phone's screen.
	expect(button.x).toBeGreaterThan(field.x + field.width - 1);
	expect(button.y).toBeLessThan(field.y + field.height);
	expect(Math.max(field.y + field.height, button.y + button.height)).toBeLessThan(name.y);
});

test("says when a page can't be imported, keeping the link and the editor as they were", async ({
	page,
	baseURL,
	person: _signedIn
}) => {
	await open(page, '/recipes/new');
	await page.getByLabel('Name', { exact: true }).fill('Pie');
	await page.getByLabel('Steps').fill('Bake.');

	const ownAddress = `${baseURL}/recipes`;
	await link(page).fill(ownAddress);
	await importButton(page).click();
	await expect(page.getByRole('alert')).toHaveText(
		"Couldn't open that page. Check the link and try again."
	);
	await expect(link(page)).toHaveValue(ownAddress);
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Pie');
	await expect(page.getByLabel('Steps')).toHaveValue('Bake.');
	await expect(page.getByLabel('Source')).toHaveValue('');

	// The browser takes any address, and the server only http and https ones.
	await link(page).fill('ftp://recipes.example/pie');
	await link(page).press('Enter');
	await expect(page.getByRole('alert')).toHaveText(
		'Enter a link that starts with http:// or https://'
	);
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Pie');
});
