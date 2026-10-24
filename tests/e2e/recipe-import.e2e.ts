import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { addItem, addRecipe, expect, open, test } from './fixtures.ts';

// Import recipes (design 7): a CSV file of recipes, one per row, added from the Recipes page.

async function chooseFile(page: Page, csv: string) {
	await page.getByLabel('CSV file').setInputFiles({
		name: 'recipes.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv)
	});
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
	expect(readFileSync(await file.path(), 'utf8')).toBe(
		'Recipe,Servings,Prep (min),Cook (min),Tags,Ingredients,Steps,Notes,Source,Calories,Protein (g),Carbs (g),Fat (g)\r\n'
	);
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
	await expect(alert).toContainText('Nothing was imported.');
	await expect(alert.getByRole('listitem')).toHaveText([
		'Row 3: Saffron is archived. Restore it on Items first.',
		"Row 4: '2 cups' needs an item.",
		'Row 5: rice is also on row 2.'
	]);

	await open(page, '/recipes');
	await expect(page.getByText('No recipes yet.')).toBeVisible();
});
