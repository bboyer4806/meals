import type { Page } from '@playwright/test';
import { addDinner, addRecipe, adminId, expect, open, signInAs, test, today } from './fixtures.ts';

// Help (design 7, "Help"): the header button on every screen after household setup, and the
// sheet explaining the screen it's opened on.

const helpButton = (page: Page) =>
	page.getByRole('banner').getByRole('button', { name: 'Help', exact: true });
const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: `Help: ${title}` });

test('each screen opens its own help', async ({ page, db, context, baseURL, person }) => {
	const recipeId = addRecipe(db, person.householdId, { name: 'Pancakes' });
	const screens: [path: string, title: string][] = [
		['/groceries', 'Grocery list'],
		['/groceries/history', 'History'],
		['/groceries/items', 'Items'],
		['/recipes', 'Recipes'],
		['/recipes/new', 'New recipe'],
		[`/recipes/${recipeId}`, 'Recipe'],
		[`/recipes/${recipeId}/edit`, 'Edit recipe'],
		[`/recipes/${recipeId}/cook`, 'Cooking view'],
		['/menu', 'Menu'],
		[`/menu/${today()}`, 'Dinner'],
		['/household', 'Household'],
		['/whats-new', "What's new"]
	];
	for (const [path, title] of screens) {
		await open(page, path);
		await helpButton(page).click();
		await expect(sheet(page, title)).toBeVisible();
		await expect(sheet(page, title).getByRole('listitem').first()).toBeVisible();
	}

	await signInAs(db, context, baseURL, adminId(db));
	await open(page, '/admin');
	await helpButton(page).click();
	await expect(sheet(page, 'Admin')).toBeVisible();
});

test('sits left of More and is hidden in print', async ({ page, person: _signedIn }) => {
	await open(page, '/groceries');
	const help = await helpButton(page).boundingBox();
	const more = await page.getByRole('banner').getByText('More').boundingBox();
	if (!help || !more) throw new Error('No Help or More');
	expect(help.x + help.width).toBeLessThanOrEqual(more.x);

	await page.emulateMedia({ media: 'print' });
	await expect(helpButton(page)).toBeHidden();
});

test("closes with ✕, Escape or the backdrop and keeps a dinner's unsaved note", async ({
	page,
	db,
	person
}) => {
	const date = today();
	addDinner(db, person.householdId, date, { note: 'Saved note' });
	page.on('dialog', (dialog) => {
		throw new Error(`Unexpected dialog: ${dialog.message()}`);
	});
	await open(page, `/menu/${date}`);
	const note = page.getByLabel('Note', { exact: true });
	await note.fill('Typed, not saved');

	await helpButton(page).click();
	await sheet(page, 'Dinner').getByRole('button', { name: 'Close' }).click();
	await expect(sheet(page, 'Dinner')).toBeHidden();

	await helpButton(page).click();
	await page.keyboard.press('Escape');
	await expect(sheet(page, 'Dinner')).toBeHidden();

	// The top left corner is outside the sheet, which sits at the bottom of a phone screen.
	await helpButton(page).click();
	await expect(sheet(page, 'Dinner')).toBeVisible();
	await page.mouse.click(5, 5);
	await expect(sheet(page, 'Dinner')).toBeHidden();

	await expect(note).toHaveValue('Typed, not saved');
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
});

test("isn't on Household setup", async ({ page, db, context, baseURL }) => {
	const userId = Number(
		db
			.prepare(
				"insert into users (google_sub, email, name, created_at) values (?, ?, 'Robin', 0)"
			)
			.run(`help-${Date.now()}`, `help-${Date.now()}@example.com`).lastInsertRowid
	);
	await signInAs(db, context, baseURL, userId);
	await page.goto('/setup');
	await expect(page.getByLabel('Household name')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Help', exact: true })).toHaveCount(0);
});
