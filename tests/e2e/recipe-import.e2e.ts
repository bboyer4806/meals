import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { UNREACHABLE, addItem, addRecipe, dropActions, expect, open, test } from './fixtures.ts';

// Import recipes (design 7): a CSV file of recipes, one per row, added from the Recipes page.

async function chooseFile(page: Page, csv: string) {
	await page.getByLabel('CSV file').setInputFiles({
		name: 'recipes.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv)
	});
}

/**
 * A CSV file on disk, as a spreadsheet saves it, for choosing by its path. It was last saved an
 * hour ago, so saving over it changes its time even to the second, as Chromium compares it.
 */
function savedFile(csv: string): string {
	const path = test.info().outputPath('recipes.csv');
	writeFileSync(path, csv);
	const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
	utimesSync(path, hourAgo, hourAgo);
	return path;
}

function ingredientRow(page: Page, number: number) {
	return page.getByRole('group', { name: `Ingredient ${number}`, exact: true });
}

function duplicate(page: Page, name: string) {
	return page.getByRole('group', { name: new RegExp(`^${name}\\b`) });
}

function recipeLink(page: Page, name: string) {
	return page.getByRole('link', { name: new RegExp(`^${name}`) });
}

test('Download template gives the header row', async ({ page, person: _signedIn }) => {
	await open(page, '/recipes');
	await page.getByRole('link', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Import recipes' })).toBeVisible();

	const download = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download template' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('recipes.csv');
	// A byte order mark starts it, so Excel keeps it UTF-8 (MEA-71).
	expect(readFileSync(await file.path(), 'utf8')).toBe(
		'\uFEFFRecipe,Servings,Prep (min),Cook (min),Tags,Ingredients,Steps,Notes,Source,Calories,Protein (g),Carbs (g),Fat (g)\r\n'
	);
});

test('goes back to Recipes on ‹ Recipes and Cancel, so Back leaves Recipes', async ({
	page,
	person: _signedIn
}) => {
	for (const link of ['‹ Recipes', 'Cancel']) {
		await open(page, '/groceries');
		await page.getByRole('navigation', { name: 'Main' }).getByText('Recipes').click();
		await page.getByRole('link', { name: 'Import', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Import recipes' })).toBeVisible();
		await page.getByRole('link', { name: link, exact: true }).click();
		await expect(page).toHaveURL(/\/recipes$/);
		await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(/\/groceries$/);
	}
});

test('imports a recipe with a section, a range and an extra column', async ({
	page,
	person: _signedIn
}) => {
	await open(page, '/recipes/import');
	await chooseFile(
		page,
		[
			'recipe,Tags,Ingredients,Steps,Rating,Prep (min)',
			'Garlic bread,"Side, Quick","2-3 cloves garlic|# Topping|1 1/2 cups cheese, grated|Salt, to taste",Toast the bread.|Add the topping.,5,10'
		].join('\r\n')
	);
	await page.getByRole('button', { name: 'Import' }).click();

	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText('Imported 1 recipe. Ignored column: Rating.');
	await recipeLink(page, 'Garlic bread').click();

	const ingredients = page
		.locator('section', { has: page.getByRole('heading', { name: 'Ingredients', level: 2 }) })
		.getByRole('listitem');
	await expect(ingredients).toHaveText([
		'2 cloves garlic, 2 to 3',
		'1 1/2 cups cheese, grated',
		'Salt, to taste'
	]);
	await expect(page.getByRole('heading', { name: 'Topping', level: 3 })).toBeVisible();

	await page.getByRole('link', { name: 'Edit' }).click();
	await expect(page.getByRole('heading', { name: 'Edit recipe' })).toBeVisible();
	await expect(page.getByRole('spinbutton', { name: 'Servings' })).toHaveValue('4');
	await expect(page.getByLabel('Prep (min)')).toHaveValue('10');
	await expect(page.getByLabel('Tags')).toHaveValue('Side, Quick');
	await expect(page.getByLabel('Steps')).toHaveValue('Toast the bread.\nAdd the topping.');
	const garlic = ingredientRow(page, 1);
	await expect(garlic.getByLabel('Amount')).toHaveValue('2');
	await expect(garlic.getByLabel('Unit')).toHaveValue('cloves');
	await expect(garlic.getByRole('combobox', { name: 'Item' })).toHaveValue('garlic');
	await expect(garlic.getByLabel('Prep note')).toHaveValue('2 to 3');
	await expect(page.getByRole('group', { name: 'Section 1' }).getByRole('textbox')).toHaveValue(
		'Topping'
	);
	const cheese = ingredientRow(page, 2);
	await expect(cheese.getByLabel('Amount')).toHaveValue('1 1/2');
	await expect(cheese.getByLabel('Unit')).toHaveValue('cup');
	await expect(cheese.getByRole('combobox', { name: 'Item' })).toHaveValue('cheese');
	await expect(cheese.getByLabel('Prep note')).toHaveValue('grated');
	const salt = ingredientRow(page, 3);
	await expect(salt.getByLabel('Amount')).toHaveValue('');
	await expect(salt.getByRole('combobox', { name: 'Item' })).toHaveValue('Salt');
	await expect(salt.getByLabel('Prep note')).toHaveValue('to taste');
});

test('Skip, Replace and Rename a recipe already in Recipes', async ({ page, db, person }) => {
	const cakeId = addRecipe(db, person.householdId, { name: 'Pound cake', notes: 'Old cake' });
	db.prepare('update dishes set tried = 1 where id = ?').run(cakeId);
	addRecipe(db, person.householdId, { name: 'Soup', notes: 'Old soup' });
	addRecipe(db, person.householdId, { name: 'Toast', notes: 'Old toast', archived: true });
	addRecipe(db, person.householdId, { name: 'Stew' });

	await open(page, '/recipes/import');
	await chooseFile(
		page,
		'Recipe,Notes\npound cake,New cake\nSoup,New soup\nToast,New toast\nRice,New rice\n'
	);
	await page.getByRole('button', { name: 'Import' }).click();

	await expect(page.getByText('These recipes are already in Recipes.')).toBeVisible();
	await expect(duplicate(page, 'Pound cake').getByLabel('Skip')).toBeChecked();
	await expect(duplicate(page, 'Soup').getByLabel('Skip')).toBeChecked();
	await expect(duplicate(page, 'Toast').getByText('Archived')).toBeVisible();
	await expect(duplicate(page, 'Pound cake').getByText('Archived')).toHaveCount(0);

	await duplicate(page, 'Pound cake').getByLabel('Replace').check();
	await duplicate(page, 'Toast').getByLabel('Rename').check();
	// A name that's taken is a problem, and the choices stay.
	await duplicate(page, 'Toast').getByLabel('New name').fill('stew');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toContainText('Fix these problems, then import again.');
	await expect(page.getByRole('alert')).toContainText('Row 4: a recipe is already called stew.');
	await expect(duplicate(page, 'Pound cake').getByLabel('Replace')).toBeChecked();

	await duplicate(page, 'Toast').getByLabel('New name').fill('Cinnamon toast');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText(
		'Imported 2 recipes, replaced 1 and skipped 1.'
	);

	await recipeLink(page, 'Pound cake').click();
	await expect(page.getByText('New cake')).toBeVisible();
	// Replacing keeps Tried.
	await expect(page.getByLabel('Tried it')).toBeChecked();
	await page.getByRole('link', { name: '‹ Recipes' }).click();
	await recipeLink(page, 'Soup').click();
	await expect(page.getByText('Old soup')).toBeVisible();
	await page.getByRole('link', { name: '‹ Recipes' }).click();
	await recipeLink(page, 'Cinnamon toast').click();
	await expect(page.getByText('New toast')).toBeVisible();
	await page.getByRole('link', { name: '‹ Recipes' }).click();
	await expect(recipeLink(page, 'Rice')).toBeVisible();
	await page.getByRole('link', { name: 'Show archived' }).click();
	await recipeLink(page, 'Toast').click();
	await expect(page.getByText('Old toast')).toBeVisible();
});

test('a file with a problem imports nothing and lists it by row', async ({ page, db, person }) => {
	const saffron = addItem(db, person.householdId, 'Saffron');
	db.prepare('update items set archived_at = 1 where id = ?').run(saffron);

	await open(page, '/recipes/import');
	await chooseFile(
		page,
		'Recipe,Ingredients\nRice,2 cups rice\nPaella,1 pinch saffron\nPound cake,2 cups\nrice,\n'
	);
	await page.getByRole('button', { name: 'Import' }).click();

	const alert = page.getByRole('alert');
	await expect(alert).toContainText(
		'Nothing was imported. Fix these problems, then choose the file again.'
	);
	await expect(alert.getByRole('listitem')).toHaveText([
		'Row 3: Saffron is archived. Restore it on Items first.',
		"Row 4: '2 cups' needs an item.",
		'Row 5: rice is also on row 2.'
	]);

	await open(page, '/recipes');
	await expect(page.getByText('No recipes yet.')).toBeVisible();
});

test('after problems, the fixed file imports once chosen again (MEA-129)', async ({
	page,
	person: _signedIn
}) => {
	const file = savedFile('Recipe,Ingredients\nPound cake,2 cups\n');
	await open(page, '/recipes/import');
	await page.getByLabel('CSV file').setInputFiles(file);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toContainText("Row 2: '2 cups' needs an item.");
	// Chromium won't send the file again once it's saved over, so it's chosen again.
	await expect(page.getByLabel('CSV file')).toHaveValue('');

	writeFileSync(file, 'Recipe,Ingredients\nPound cake,2 cups flour\n');
	await page.getByLabel('CSV file').setInputFiles(file);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText('Imported 1 recipe.');
});

test("a file changed after it was sent is chosen again, and the connection isn't blamed (MEA-129)", async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Pound cake' });
	const file = savedFile('Recipe\nPound cake\n');
	await open(page, '/recipes/import');
	await page.getByLabel('CSV file').setInputFiles(file);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('These recipes are already in Recipes.')).toBeVisible();

	// Renamed in the spreadsheet instead, and saved over. Chromium's request fails as it does
	// without a connection.
	writeFileSync(file, 'Recipe\nLemon pound cake\n');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'The file changed after you chose it. Choose it again.'
	);
	await expect(page.getByLabel('CSV file')).toHaveValue('');

	await page.getByLabel('CSV file').setInputFiles(file);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText('Imported 1 recipe.');
});

test("says when Meals can't be reached or something went wrong there, keeping the file (MEA-129)", async ({
	page,
	person: _signedIn
}) => {
	await open(page, '/recipes/import');
	await chooseFile(page, 'Recipe\nToast\n');
	const reconnect = await dropActions(page);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toHaveText(UNREACHABLE);
	await reconnect();

	// The action broke, and the server answers as SvelteKit does.
	const importAction = (url: URL) => url.search === '?/import';
	await page.route(importAction, (route) =>
		route.fulfill({
			status: 500,
			json: { type: 'error', error: { status: 500, message: 'Internal Error' } }
		})
	);
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toHaveText('Something went wrong. Please try again.');
	await page.unroute(importAction);

	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText('Imported 1 recipe.');
});

test('a file with hundreds of extra columns imports, naming a few of them (MEA-81)', async ({
	page,
	person: _signedIn
}) => {
	// More than nginx (8 KB) or Node (16 KB) takes in an address, if they were named there.
	const extra = Array.from({ length: 1000 }, (_, index) => `Extra column ${index + 1}`);
	await open(page, '/recipes/import');
	await chooseFile(page, `${['Recipe', ...extra].join(',')}\r\nToast`);
	await page.getByRole('button', { name: 'Import' }).click();

	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText(
		'Imported 1 recipe. Ignored columns: Extra column 1, Extra column 2 and 998 more.'
	);
	await expect(recipeLink(page, 'Toast')).toBeVisible();
});

test('says what it imported until the next navigation, not after Back or a reload', async ({
	page,
	person: _signedIn
}) => {
	await open(page, '/recipes/import');
	await chooseFile(page, 'Recipe\nToast\n');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('status')).toHaveText('Imported 1 recipe.');

	await recipeLink(page, 'Toast').click();
	await expect(page.getByRole('heading', { name: 'Toast', level: 1 })).toBeVisible();
	await page.goBack();
	await expect(recipeLink(page, 'Toast')).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);

	await page.reload();
	await expect(page.locator('html[data-started]')).toBeAttached();
	await expect(recipeLink(page, 'Toast')).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
});

test("a link can't make Recipes say it imported something (MEA-81)", async ({
	page,
	person: _signedIn
}) => {
	await open(page, '/recipes?imported=0&ignored=Your%20session%20expired.%20Sign%20in%20again');
	await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
});
