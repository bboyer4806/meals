import { expect, test } from './fixtures.ts';

test('renames and archives an item, and asks before adding it again', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	const add = page.getByRole('form', { name: 'Add to the list' });
	await add.getByRole('combobox', { name: 'Item' }).fill('Dish soap');
	await add.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByRole('button', { name: /^Dish soap/ })).toBeVisible();

	await page.goto('/groceries/items');
	await page.getByRole('button', { name: /^Dish soap/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Dawn dish soap');
	await dialog.getByLabel('Notes').fill('Blue, 20 oz');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('button', { name: /^Dawn dish soap\s*Blue, 20 oz/ })).toBeVisible();

	await page.getByRole('button', { name: /^Dawn dish soap/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
	await page.getByRole('dialog').last().getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByText('No items.')).toBeVisible();

	// The line on the list keeps working; adding the archived name again asks first.
	await page.goto('/groceries');
	await expect(page.getByRole('button', { name: /^Dawn dish soap/ })).toBeVisible();
	await add.getByRole('combobox', { name: 'Item' }).fill('dawn dish soap');
	await add.getByRole('button', { name: 'Add' }).click();
	const prompt = page.getByRole('dialog');
	await expect(prompt).toContainText('Dawn dish soap is archived.');
	await prompt.getByRole('button', { name: 'Restore and add' }).click();
	// Restored, it's already on the list, so the duplicate question follows.
	await expect(page.getByRole('dialog')).toContainText('Already on the list: 1');
});

test('rejects a sign-in callback that did not start here', async ({ page }) => {
	const response = await page.goto('/login/google/callback?code=abc&state=forged');
	expect(response?.status()).toBe(400);
	await expect(page.getByText('Sign-in was cancelled or expired.')).toBeVisible();
});

test('explains the invite-only page', async ({ page }) => {
	await page.goto('/not-invited?email=stranger%40example.com');
	await expect(page.getByText("stranger@example.com hasn't been invited.")).toBeVisible();
});
