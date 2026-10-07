import { addItem, expect, test } from './fixtures.ts';

test('renames and archives an item, and asks before adding it again', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	const add = page.getByRole('form', { name: 'Add to the list' });
	await add.getByRole('combobox', { name: 'Item' }).fill('Dish soap');
	await add.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByRole('button', { name: /^Dish soap/ })).toBeVisible();

	await page.goto('/groceries/items');
	const dialog = page.getByRole('dialog');
	// Edits abandoned with the close button don't come back.
	await page.getByRole('button', { name: /^Dish soap/ }).click();
	await dialog.getByLabel('Name').fill('Something else');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: /^Dish soap/ }).click();
	await expect(dialog.getByLabel('Name')).toHaveValue('Dish soap');

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

test('marks an item Always have, and clears it again', async ({ page, db, person }) => {
	const salt = addItem(db, person.householdId, 'Salt');
	addItem(db, person.householdId, 'Pepper');
	const alwaysHave = () =>
		db.prepare('select always_have from items where id = ?').pluck().get(salt);
	await page.goto('/groceries/items');
	const row = page.getByRole('button', { name: /^Salt/ });
	await expect(row).not.toContainText('Always have');

	await row.click();
	const dialog = page.getByRole('dialog');
	const box = dialog.getByLabel('Always have');
	await expect(box).not.toBeChecked();
	await expect(box).toHaveAccessibleDescription('Left off pantry checks, like water or salt.');
	await box.check();
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(row).toContainText('Always have');
	await expect(page.getByRole('button', { name: /^Pepper/ })).not.toContainText('Always have');
	expect(alwaysHave()).toBe(1);

	// Saved, so it's still set after a reload, and it can be cleared.
	await page.reload();
	await row.click();
	await expect(box).toBeChecked();
	await box.uncheck();
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(row).not.toContainText('Always have');
	expect(alwaysHave()).toBe(0);
});

test('rejects a sign-in callback that did not start here', async ({ page }) => {
	const response = await page.goto('/login/google/callback?code=abc&state=forged');
	expect(response?.status()).toBe(400);
	await expect(page.getByText('Sign-in was cancelled or expired.')).toBeVisible();
});

test('shows the invite-only page only the address that was really used', async ({
	page,
	context,
	baseURL
}) => {
	await context.addCookies([
		{ name: 'not_invited_email', value: 'stranger@example.com', url: `${baseURL}/not-invited` }
	]);
	await page.goto('/not-invited');
	await expect(page.getByText("stranger@example.com hasn't been invited.")).toBeVisible();

	// Text in the URL is ignored, so nobody can make the page say something else.
	await context.clearCookies();
	await page.goto('/not-invited?email=Your%20account%20is%20locked');
	await expect(page.getByText("This account hasn't been invited.")).toBeVisible();
});
