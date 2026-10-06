import { existsSync } from 'node:fs';
import type { Dialog, Locator, Page } from '@playwright/test';
import {
	addItem,
	addPerson,
	addPhotoFiles,
	addRecipe,
	expect,
	makeJpeg,
	photoFile,
	signInAs,
	test
} from './fixtures.ts';

function ingredientRow(page: Page, number: number) {
	return page.getByRole('group', { name: `Ingredient ${number}`, exact: true });
}

function sectionRow(page: Page, number: number) {
	return page.getByRole('group', { name: `Section ${number}`, exact: true });
}

/** Types into one ingredient row of the editor. The item goes last, as a person would type it. */
async function fillIngredient(
	row: Locator,
	fields: { amount?: string; unit?: string; item: string; prepNote?: string }
) {
	if (fields.amount !== undefined) {
		await row.getByLabel('Amount', { exact: true }).fill(fields.amount);
	}
	if (fields.unit !== undefined) await row.getByLabel('Unit', { exact: true }).fill(fields.unit);
	await row.getByRole('combobox', { name: 'Item', exact: true }).fill(fields.item);
	if (fields.prepNote !== undefined) {
		await row.getByLabel('Prep note', { exact: true }).fill(fields.prepNote);
	}
}

/** A card on the recipe page, found by its heading. */
function section(page: Page, heading: string) {
	return page.locator('section', { has: page.getByRole('heading', { name: heading, level: 2 }) });
}

function ingredients(page: Page) {
	return section(page, 'Ingredients').getByRole('listitem');
}

function steps(page: Page) {
	return section(page, 'Steps').getByRole('listitem');
}

const photoInput = (page: Page) => page.locator('input[type="file"]');

/** The preview the editor shows once a picked photo has been resized. */
async function expectPreview(page: Page) {
	await expect(page.getByRole('group', { name: 'Photo' }).locator('img')).toHaveAttribute(
		'src',
		/^data:image\/jpeg;base64,/
	);
	await expect(page.getByText('Getting the photo ready…')).toHaveCount(0);
}

/** Checks the image has loaded, and returns its width. */
async function loadedWidth(image: Locator): Promise<number> {
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)
		)
		.toBeGreaterThan(0);
	return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

async function expectJpeg(page: Page, url: string) {
	const response = await page.request.get(url);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('image/jpeg');
	const body = await response.body();
	expect([...body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
}

function photoKeyOf(src: string | null): string {
	const key = /^\/photos\/([0-9a-f]{32})(?:-thumb)?\.jpg$/.exec(src ?? '')?.[1];
	if (!key) throw new Error(`Not a photo address: ${src}`);
	return key;
}

function recipeIdIn(page: Page): number {
	const id = /\/recipes\/(\d+)/.exec(page.url())?.[1];
	if (!id) throw new Error(`Not a recipe page: ${page.url()}`);
	return Number(id);
}

test('creates a recipe with every field on a phone, with a photo', async ({ page, db, person }) => {
	// Tags and an item the household already has, for the suggestions.
	addRecipe(db, person.householdId, { name: 'Banana bread', tags: ['Baking', 'Breakfast'] });
	addItem(db, person.householdId, 'Powdered sugar');
	const jpeg = await makeJpeg(page, { width: 2000, height: 1500 });

	await page.goto('/recipes');
	await page.getByRole('link', { name: 'New recipe' }).click();
	await expect(page).toHaveURL(/\/recipes\/new$/);
	await expect(page.getByRole('heading', { name: 'New recipe', level: 1 })).toBeVisible();
	// The household's usual servings.
	await expect(page.getByLabel('Servings')).toHaveValue('4');

	await page.getByLabel('Name', { exact: true }).fill('Pound cake');
	await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
	await photoInput(page).setInputFiles({ name: 'cake.jpg', mimeType: 'image/jpeg', buffer: jpeg });
	await expectPreview(page);
	await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();

	await page.getByLabel('Servings').fill('8');
	await page.getByLabel('Prep (min)').fill('15');
	await page.getByLabel('Cook (min)').fill('60');

	// A tag typed in full, and one finished by tapping a suggestion.
	const tags = page.getByLabel('Tags');
	await tags.fill('Dessert, ba');
	const suggestions = page.getByRole('list', { name: 'Add a tag' });
	await expect(suggestions.getByRole('button')).toHaveText(['+ Baking']);
	await suggestions.getByRole('button', { name: 'Add Baking' }).click();
	await expect(tags).toHaveValue('Dessert, Baking');
	await expect(suggestions.getByRole('button')).toHaveText(['+ Breakfast']);

	// A custom unit, a known unit typed another way, a count with a prep note.
	await fillIngredient(ingredientRow(page, 1), {
		amount: '2',
		unit: 'sticks',
		item: 'Butter',
		prepNote: 'softened'
	});
	await page.getByRole('button', { name: 'Add ingredient' }).click();
	await expect(ingredientRow(page, 2).getByRole('combobox', { name: 'Item' })).toBeFocused();
	await fillIngredient(ingredientRow(page, 2), { amount: '1 1/2', unit: 'cups', item: 'Sugar' });
	await page.getByRole('button', { name: 'Add ingredient' }).click();
	await fillIngredient(ingredientRow(page, 3), {
		amount: '4',
		item: 'Eggs',
		prepNote: 'room temperature'
	});

	// A section with two rows; the first one, with no amount, then moves above the heading.
	await page.getByRole('button', { name: 'Add section' }).click();
	await expect(sectionRow(page, 1).getByLabel('Heading')).toBeFocused();
	await sectionRow(page, 1).getByLabel('Heading').fill('For the glaze');
	await fillIngredient(ingredientRow(page, 4), { item: 'Salt' });
	await page.getByRole('button', { name: 'Add ingredient' }).click();
	// An item the household has, picked from the suggestions.
	const row5 = ingredientRow(page, 5);
	await row5.getByLabel('Amount', { exact: true }).fill('1');
	await row5.getByLabel('Unit', { exact: true }).fill('cup');
	await row5.getByRole('combobox', { name: 'Item' }).fill('powd');
	await page.getByRole('option', { name: 'Powdered sugar' }).click();
	await expect(row5.getByRole('combobox', { name: 'Item' })).toHaveValue('Powdered sugar');
	await row5.getByLabel('Prep note', { exact: true }).fill('sifted');
	await page.getByRole('button', { name: 'Move ingredient 4 up' }).click();
	await expect(page.locator('ol.rows > li .label')).toHaveText([
		'Ingredient 1',
		'Ingredient 2',
		'Ingredient 3',
		'Ingredient 4',
		'Section 1',
		'Ingredient 5'
	]);
	await expect(ingredientRow(page, 4).getByRole('combobox', { name: 'Item' })).toHaveValue('Salt');

	await page
		.getByLabel('Steps')
		.fill(
			[
				'Cream the butter and sugar.',
				'Beat in the eggs, then fold in 2 cups of flour.',
				'Bake at 325°F for 60 to 70 minutes.',
				'Whisk the glaze and pour it over.'
			].join('\n')
		);
	await page.getByLabel('Notes').fill('Keeps for a week.\nFreezes well.');
	await page.getByLabel('Source').fill('https://example.com/pound-cake');
	await page.getByLabel('Calories').fill('420');
	await page.getByLabel('Protein (g)').fill('5');
	await page.getByLabel('Carbs (g)').fill('52.5');
	await page.getByLabel('Fat (g)').fill('21');

	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/recipes\/\d+$/);
	const dishId = recipeIdIn(page);

	await expect(page.getByRole('heading', { name: 'Pound cake', level: 1 })).toBeVisible();
	const tabs = page.getByRole('navigation', { name: 'Main' });
	await expect(tabs.getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
	await expect(tabs.getByRole('link', { name: 'Groceries' })).not.toHaveAttribute('aria-current');
	await expect(page.getByRole('list', { name: 'Tags' }).getByRole('link')).toHaveText([
		'Dessert',
		'Baking'
	]);
	await expect(page.getByRole('link', { name: 'Baking' })).toHaveAttribute(
		'href',
		'/recipes?tag=Baking'
	);
	await expect(page.locator('.times')).toHaveText(
		/Prep\s*15 min\s*Cook\s*1 hr\s*Total\s*1 hr 15 min/
	);
	await expect(page.getByRole('status')).toHaveText('8 servings');
	await expect(ingredients(page)).toHaveText([
		'2 sticks Butter, softened',
		'1 1/2 cups Sugar',
		'4 Eggs, room temperature',
		'Salt',
		'1 cup Powdered sugar, sifted'
	]);
	await expect(section(page, 'Ingredients').getByRole('heading', { level: 3 })).toHaveText([
		'For the glaze'
	]);
	// The heading comes after Salt and before Powdered sugar.
	await expect(
		section(page, 'Ingredients').locator('h3 + ul').getByRole('listitem')
	).toHaveText(['1 cup Powdered sugar, sifted']);
	await expect(steps(page)).toHaveText([
		'Cream the butter and sugar.',
		'Beat in the eggs, then fold in 2 cups of flour.',
		'Bake at 325°F for 60 to 70 minutes.',
		'Whisk the glaze and pour it over.'
	]);
	// Unscaled, so no step is marked.
	await expect(page.getByText("Amounts in this step aren't scaled.")).toHaveCount(0);
	expect(await section(page, 'Notes').locator('p').innerText()).toBe(
		'Keeps for a week.\nFreezes well.'
	);
	const source = page.getByRole('link', { name: 'https://example.com/pound-cake' });
	await expect(source).toHaveAttribute('href', 'https://example.com/pound-cake');
	await expect(source).toHaveAttribute('target', '_blank');
	await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
	await expect(section(page, 'Nutrition per serving').locator('dl > div')).toHaveText([
		/Calories\s*420/,
		/Protein\s*5 g/,
		/Carbs\s*52.5 g/,
		/Fat\s*21 g/
	]);

	// Resized on the phone: 1600 px on the longest side, and a 400 px thumbnail.
	const photo = page.locator('img.photo');
	const key = photoKeyOf(await photo.getAttribute('src'));
	expect(await loadedWidth(photo)).toBe(1600);
	await expectJpeg(page, `/photos/${key}.jpg`);
	await expectJpeg(page, `/photos/${key}-thumb.jpg`);
	expect(db.prepare('select photo_key from dishes where id = ?').pluck().get(dishId)).toBe(key);

	await page.getByRole('link', { name: 'Recipes' }).click();
	const listed = page.getByRole('link', { name: /^Pound cake/ });
	await expect(listed).toContainText('1 hr 15 min · Dessert, Baking');
	const thumb = listed.locator('img');
	await expect(thumb).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
	expect(await loadedWidth(thumb)).toBe(400);

	// The editor reads the recipe back the same way.
	await page.goto(`/recipes/${dishId}/edit`);
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Pound cake');
	await expect(page.getByLabel('Tags')).toHaveValue('Dessert, Baking');
	await expect(ingredientRow(page, 2).getByLabel('Amount')).toHaveValue('1 1/2');
	await expect(ingredientRow(page, 2).getByLabel('Unit')).toHaveValue('cup');
	await expect(sectionRow(page, 1).getByLabel('Heading')).toHaveValue('For the glaze');
	await expect(page.getByRole('group', { name: 'Photo' }).locator('img')).toHaveAttribute(
		'src',
		`/photos/${key}-thumb.jpg`
	);
});

test('keeps everything typed when the name is taken, and offers to restore an archived one', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Pound cake' });
	const bananaId = addRecipe(db, person.householdId, { name: 'Banana bread', archived: true });
	const lemonId = addRecipe(db, person.householdId, {
		name: 'Lemon bars',
		steps: 'Mix.\nBake.',
		ingredients: [{ item: 'Lemon juice', amount: 0.5, unit: 'cup' }]
	});
	const jpeg = await makeJpeg(page, { width: 900, height: 900, hue: 50 });

	await page.goto(`/recipes/${lemonId}/edit`);
	await expect(page.getByRole('heading', { name: 'Edit recipe' })).toBeVisible();
	await expect(ingredientRow(page, 1).getByLabel('Amount')).toHaveValue('1/2');
	await page.getByLabel('Name', { exact: true }).fill('pound cake');
	await page.getByLabel('Servings').fill('12');
	await page.getByLabel('Tags').fill('Dessert');
	await page.getByRole('button', { name: 'Add ingredient' }).click();
	await fillIngredient(ingredientRow(page, 2), { amount: '3', item: 'Eggs', prepNote: 'beaten' });
	await page.getByLabel('Steps').fill('Mix.\nBake for 25 minutes.\nCool.');
	await photoInput(page).setInputFiles({ name: 'bars.jpg', mimeType: 'image/jpeg', buffer: jpeg });
	await expectPreview(page);

	await page.getByRole('button', { name: 'Save' }).click();
	const problem = page.getByRole('alert');
	await expect(problem).toHaveText('A recipe is already called pound cake.');
	await expect(problem).toBeFocused();
	await expect(page.getByRole('button', { name: 'Restore it' })).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/recipes/${lemonId}/edit$`));
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('pound cake');
	await expect(page.getByLabel('Servings')).toHaveValue('12');
	await expect(page.getByLabel('Tags')).toHaveValue('Dessert');
	await expect(ingredientRow(page, 2).getByLabel('Amount')).toHaveValue('3');
	await expect(ingredientRow(page, 2).getByRole('combobox', { name: 'Item' })).toHaveValue('Eggs');
	await expect(ingredientRow(page, 2).getByLabel('Prep note')).toHaveValue('beaten');
	await expect(page.getByLabel('Steps')).toHaveValue('Mix.\nBake for 25 minutes.\nCool.');
	await expect(page.getByRole('group', { name: 'Photo' }).locator('img')).toHaveAttribute(
		'src',
		/^data:image\/jpeg/
	);
	expect(db.prepare('select name, servings from dishes where id = ?').get(lemonId)).toEqual({
		name: 'Lemon bars',
		servings: 4
	});

	// An archived recipe's name is still taken, and it can be restored from here.
	await page.getByLabel('Name', { exact: true }).fill('banana bread');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(problem).toHaveText('An archived recipe is called banana bread.');
	await expect(problem).toBeFocused();
	await expect(page.getByLabel('Steps')).toHaveValue('Mix.\nBake for 25 minutes.\nCool.');

	// A new name saves everything that was kept.
	await page.getByLabel('Name', { exact: true }).fill('Lemon squares');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${lemonId}$`));
	await expect(page.getByRole('heading', { name: 'Lemon squares', level: 1 })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText('12 servings');
	await expect(ingredients(page)).toHaveText(['1/2 cup Lemon juice', '3 Eggs, beaten']);
	await expect(steps(page)).toHaveText(['Mix.', 'Bake for 25 minutes.', 'Cool.']);
	await expect(page.getByRole('list', { name: 'Tags' })).toHaveText('Dessert');
	expect(await loadedWidth(page.locator('img.photo'))).toBe(900);

	// Back to the editor to take up the offer this time.
	await page.goto(`/recipes/${lemonId}/edit`);
	await page.getByLabel('Name', { exact: true }).fill('Banana Bread');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(problem).toHaveText('An archived recipe is called Banana Bread.');
	// What was typed here is dropped, so it asks first, and staying restores nothing.
	page.once('dialog', (dialog) => {
		expect(dialog.message()).toBe('Leave without saving? What you typed will be lost.');
		void dialog.dismiss();
	});
	await page.getByRole('button', { name: 'Restore it' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${lemonId}/edit$`));
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Banana Bread');
	expect(
		db.prepare('select archived_at from dishes where id = ?').pluck().get(bananaId)
	).not.toBeNull();
	page.once('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: 'Restore it' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${bananaId}$`));
	await expect(page.getByRole('heading', { name: 'Banana bread', level: 1 })).toBeVisible();
	await expect(page.getByText('Archived', { exact: true })).toHaveCount(0);
	expect(db.prepare('select archived_at from dishes where id = ?').pluck().get(bananaId)).toBeNull();
	expect(db.prepare('select name from dishes where id = ?').pluck().get(lemonId)).toBe(
		'Lemon squares'
	);
});

test('asks before leaving the editor with changes, and leaves it behind once saved', async ({
	page,
	person: _
}) => {
	const name = page.getByLabel('Name', { exact: true });
	const tab = (label: string) => page.getByRole('navigation', { name: 'Main' }).getByText(label);
	await page.goto('/recipes');
	await page.getByRole('link', { name: 'New recipe' }).click();
	await expect(name).toBeVisible();
	// Nothing typed yet, so nothing to ask. Blank rows and an empty heading aren't typing.
	await page.getByRole('button', { name: 'Add ingredient' }).click();
	await page.getByRole('button', { name: 'Add section' }).click();
	await tab('Groceries').click();
	await expect(page).toHaveURL(/\/groceries$/);
	await page.goBack();
	await expect(name).toHaveValue('');

	await name.fill('Ricotta toast');
	await page.getByLabel('Steps').fill('Toast the bread.\nSpread the ricotta.');
	const questions: string[] = [];
	const stay = (dialog: Dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	};
	page.on('dialog', stay);
	await tab('Groceries').click();
	await expect.poll(() => questions).toEqual(['Leave without saving? What you typed will be lost.']);
	await page.getByRole('link', { name: 'Cancel' }).click();
	await expect.poll(() => questions).toHaveLength(2);
	await expect(page).toHaveURL(/\/recipes\/new$/);
	await expect(name).toHaveValue('Ricotta toast');
	await expect(page.getByLabel('Steps')).toHaveValue('Toast the bread.\nSpread the ricotta.');
	page.off('dialog', stay);

	// Saving doesn't ask, and Back from the new recipe goes to the list, not the editor.
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('heading', { name: 'Ricotta toast', level: 1 })).toBeVisible();
	expect(questions).toHaveLength(2);
	await page.goBack();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
});

test('goes back to the recipe after saving an edit, so Back leaves it in one step', async ({
	page,
	db,
	person
}) => {
	const dishId = addRecipe(db, person.householdId, { name: 'Omelet', steps: 'Whisk.' });
	await page.goto('/recipes');
	await page.getByRole('link', { name: /^Omelet/ }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('link', { name: 'Edit' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Cheese omelet');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('heading', { name: 'Cheese omelet', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}\\?servings=5$`));
	await page.goBack();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('link', { name: /^Cheese omelet/ })).toBeVisible();
});

test('lets someone leave while a save is on its way, and stays where they went', async ({
	page,
	db,
	person
}) => {
	// The save takes a while, as on a slow phone connection.
	await page.route(
		(url) => url.pathname === '/recipes/new' && url.search === '?/save',
		async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await route.continue();
		}
	);
	await page.goto('/recipes/new');
	await page.getByLabel('Name', { exact: true }).fill('Ricotta toast');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible();
	const saved = page.waitForResponse((response) => response.url().endsWith('/recipes/new?/save'));
	page.once('dialog', (dialog) => {
		expect(dialog.message()).toBe(
			"The recipe is still saving. Leave anyway? If it doesn't save, what you typed will be lost."
		);
		void dialog.accept();
	});
	await page.getByRole('navigation', { name: 'Main' }).getByText('Groceries').click();
	await expect(page).toHaveURL(/\/groceries$/);
	await saved;
	await expect
		.poll(() =>
			db.prepare('select name from dishes where household_id = ?').pluck().all(person.householdId)
		)
		.toEqual(['Ricotta toast']);
	// The finished save doesn't pull them back to the recipe.
	await page.waitForTimeout(500);
	await expect(page).toHaveURL(/\/groceries$/);
});

test('shows item suggestions above the tab bar', async ({ page, db, person }) => {
	addItem(db, person.householdId, 'Sugar');
	await page.goto('/recipes/new');
	const item = ingredientRow(page, 1).getByRole('combobox', { name: 'Item' });
	// Scrolled so the field sits just above the tab bar, where its suggestions open over it.
	const tabBarTop = await page
		.getByRole('navigation', { name: 'Main' })
		.evaluate((bar) => bar.getBoundingClientRect().top);
	await item.evaluate((field, top) => {
		window.scrollBy(0, field.getBoundingClientRect().bottom - top + 2);
	}, tabBarTop);
	await item.fill('S');
	const option = page.getByRole('option', { name: 'Sugar' });
	await expect(option).toBeVisible();
	const box = (await option.boundingBox())!;
	expect(box.y).toBeLessThan(tabBarTop);
	expect(box.y + box.height).toBeGreaterThan(tabBarTop);
	const shown = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.closest('[role=option]')?.textContent?.trim(),
		{ x: box.x + box.width / 2, y: tabBarTop + 2 }
	);
	expect(shown).toBe('Sugar');
});

test('replaces and removes a photo', async ({ page, db, person }) => {
	const first = await makeJpeg(page, { width: 1000, height: 750, hue: 10 });
	const firstThumb = await makeJpeg(page, { width: 400, height: 300, hue: 10 });
	const firstKey = addPhotoFiles(first, firstThumb);
	const dishId = addRecipe(db, person.householdId, {
		name: 'Shakshuka',
		photoKey: firstKey,
		ingredients: [{ item: 'Eggs', amount: 6 }]
	});
	await page.goto(`/recipes/${dishId}`);
	expect(await loadedWidth(page.locator('img.photo'))).toBe(1000);

	await page.getByRole('link', { name: 'Edit' }).click();
	const editorPhoto = page.getByRole('group', { name: 'Photo' }).locator('img');
	await expect(editorPhoto).toHaveAttribute('src', `/photos/${firstKey}-thumb.jpg`);
	expect(await loadedWidth(editorPhoto)).toBe(400);
	// Smaller than 1600 px, so it keeps its size.
	const second = await makeJpeg(page, { width: 1200, height: 1600, hue: 120 });
	await photoInput(page).setInputFiles({ name: 'new.jpg', mimeType: 'image/jpeg', buffer: second });
	await expectPreview(page);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}$`));

	const photo = page.locator('img.photo');
	const secondKey = photoKeyOf(await photo.getAttribute('src'));
	expect(secondKey).not.toBe(firstKey);
	expect(await loadedWidth(photo)).toBe(1200);
	await expectJpeg(page, `/photos/${secondKey}-thumb.jpg`);
	// The replaced photo is gone.
	expect((await page.request.get(`/photos/${firstKey}.jpg`)).status()).toBe(404);
	expect(existsSync(photoFile(firstKey, 'full'))).toBe(false);
	expect(existsSync(photoFile(firstKey, 'thumb'))).toBe(false);

	await page.getByRole('link', { name: 'Edit' }).click();
	await page.getByRole('button', { name: 'Remove photo' }).click();
	await expect(page.getByText('The photo is removed when you save.')).toBeVisible();
	// The button that was pressed is gone, so focus moves to the one beside it.
	await expect(page.getByRole('button', { name: 'Add photo' })).toBeFocused();
	// Changing one's mind brings it back.
	await page.getByRole('button', { name: 'Keep the old photo' }).click();
	await expect(editorPhoto).toHaveAttribute('src', `/photos/${secondKey}-thumb.jpg`);
	await expect(page.getByRole('button', { name: 'Change photo' })).toBeFocused();
	await page.getByRole('button', { name: 'Remove photo' }).click();
	await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}$`));
	await expect(page.getByRole('heading', { name: 'Shakshuka' })).toBeVisible();
	await expect(page.locator('img.photo')).toHaveCount(0);
	expect(db.prepare('select photo_key from dishes where id = ?').pluck().get(dishId)).toBeNull();
	expect((await page.request.get(`/photos/${secondKey}.jpg`)).status()).toBe(404);
	expect(existsSync(photoFile(secondKey, 'full'))).toBe(false);
	expect(existsSync(photoFile(secondKey, 'thumb'))).toBe(false);
});

// Rows from the table in design 6.6, in a recipe for 2, so each target servings gives one scale.
const scaled = {
	name: 'Scaling test',
	servings: 2,
	steps: 'Whisk 2 eggs with the milk.\nSimmer for 10 to 15 minutes at 350°F.',
	ingredients: [
		{ item: 'Milk', amount: 0.25, unit: 'cup' },
		{ item: 'Vanilla', amount: 1, unit: 'tsp' },
		{ item: 'Oil', amount: 1, unit: 'tbsp' },
		{ item: 'Beef', amount: 1, unit: 'lb' },
		{ item: 'Cheese', amount: 8, unit: 'oz' },
		{ item: 'Stock', amount: 1, unit: 'quart' },
		{ item: 'Garlic', amount: 2, unit: 'cloves' },
		{ item: 'Eggs', amount: 1 },
		{ item: 'Salt' }
	]
};

test('scales the amounts with the servings control and warns on steps with amounts', async ({
	page,
	db,
	person
}) => {
	const dishId = addRecipe(db, person.householdId, scaled);
	const warnings = page.getByText("Amounts in this step aren't scaled.");
	const servings = page.getByRole('status');

	await page.goto('/recipes');
	await page.getByRole('link', { name: /^Scaling test/ }).click();
	await expect(servings).toHaveText('2 servings');
	// As entered at the recipe's own servings, and no warnings.
	await expect(ingredients(page)).toHaveText([
		'1/4 cup Milk',
		'1 tsp Vanilla',
		'1 tbsp Oil',
		'1 lb Beef',
		'8 oz Cheese',
		'1 quart Stock',
		'2 cloves Garlic',
		'1 Eggs',
		'Salt'
	]);
	await expect(warnings).toHaveCount(0);
	await expect(page.getByText(/^Scaled from/)).toHaveCount(0);

	// x1/2
	await page.getByRole('button', { name: 'Fewer servings' }).click();
	await expect(servings).toHaveText('1 serving');
	await expect(page.getByRole('button', { name: 'Fewer servings' })).toBeDisabled();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}\\?servings=1$`));
	await expect(page.getByText('Scaled from 2 servings.')).toBeVisible();
	await expect(ingredients(page).nth(0)).toHaveText('2 tbsp Milk');
	await expect(ingredients(page).nth(3)).toHaveText('8 oz Beef');
	await expect(ingredients(page).nth(8)).toHaveText('Salt');
	// Only the step with an amount is marked.
	await expect(steps(page).nth(0)).toContainText("Amounts in this step aren't scaled.");
	await expect(steps(page).nth(1)).not.toContainText("aren't scaled");
	await expect(warnings).toHaveCount(1);

	// x1 1/2
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(servings).toHaveText('3 servings');
	await expect(ingredients(page).nth(6)).toHaveText('3 cloves Garlic');
	await expect(ingredients(page).nth(7)).toHaveText('1 1/2 Eggs');
	await expect(ingredients(page).nth(8)).toHaveText('Salt');

	// x2
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(ingredients(page).nth(5)).toHaveText('8 cups Stock');

	// x3, tapped quickly.
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(servings).toHaveText('6 servings');
	await expect(ingredients(page).nth(0)).toHaveText('3/4 cup Milk');
	await expect(ingredients(page).nth(4)).toHaveText('1 1/2 lb Cheese');
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}\\?servings=6$`));
	await expect(page.getByRole('link', { name: 'Cook' })).toHaveAttribute(
		'href',
		`/recipes/${dishId}/cook?servings=6`
	);

	// The servings are kept in the address, so a reload shows the same.
	await page.reload();
	await expect(servings).toHaveText('6 servings');
	await expect(ingredients(page).nth(0)).toHaveText('3/4 cup Milk');
	await expect(warnings).toHaveCount(1);

	// x12 and x16, from the address.
	await page.goto(`/recipes/${dishId}?servings=24`);
	await expect(ingredients(page).nth(1)).toHaveText('1/4 cup Vanilla');
	await page.goto(`/recipes/${dishId}?servings=32`);
	await expect(ingredients(page).nth(2)).toHaveText('1 cup Oil');
	// Anything that isn't 1 to 100 means the recipe's own servings.
	await page.goto(`/recipes/${dishId}?servings=0`);
	await expect(servings).toHaveText('2 servings');
	await expect(warnings).toHaveCount(0);
});

test('leaves the recipe in one step back after changing the servings', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, scaled);
	await page.goto('/recipes');
	await page.getByRole('link', { name: /^Scaling test/ }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(page).toHaveURL(/\?servings=4$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
});

test('keeps focus on the servings control at its limits', async ({ page, db, person }) => {
	const dishId = addRecipe(db, person.householdId, scaled);
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Fewer servings' }).press('Enter');
	await expect(page.getByRole('status')).toHaveText('1 serving');
	await expect(page.getByRole('button', { name: 'Fewer servings' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'More servings' })).toBeFocused();

	await page.goto(`/recipes/${dishId}?servings=99`);
	await page.getByRole('button', { name: 'More servings' }).press('Enter');
	await expect(page.getByRole('status')).toHaveText('100 servings');
	await expect(page.getByRole('button', { name: 'Fewer servings' })).toBeFocused();
});

test('prints the recipe at the servings shown, without navigation or buttons', async ({
	page,
	db,
	person
}) => {
	const dishId = addRecipe(db, person.householdId, { ...scaled, tags: ['Dinner'] });
	await page.goto(`/recipes/${dishId}?servings=6`);
	const header = page.getByRole('banner');
	const tabs = page.getByRole('navigation', { name: 'Main' });
	const serves = page.getByText('Serves 6', { exact: true });
	await expect(header).toBeVisible();
	await expect(tabs).toBeVisible();
	await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
	await expect(serves).toBeHidden();

	await page.emulateMedia({ media: 'print' });
	await expect(header).toBeHidden();
	await expect(tabs).toBeHidden();
	await expect(page.getByRole('button')).toHaveCount(0);
	for (const link of ['Cook', 'Edit']) {
		await expect(page.getByRole('link', { name: link, exact: true })).toBeHidden();
	}
	await expect(page.getByRole('status')).toBeHidden();
	await expect(serves).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Scaling test', level: 1 })).toBeVisible();
	await expect(ingredients(page).nth(0)).toHaveText('3/4 cup Milk');
	await expect(steps(page)).toHaveCount(2);
});

/** A line in the cooking view that's checked off with a tap: its checkbox, label and text. */
function checkOff(page: Page, name: RegExp) {
	const box = page.getByRole('checkbox', { name });
	const line = page.locator('label', { has: box });
	return { box, line, text: line.locator(':scope > span') };
}

const cookable = {
	name: 'Pound cake',
	servings: 4,
	steps: 'Cream the butter and sugar.\nBeat in 4 eggs.\nBake at 325°F for 1 hour.',
	notes: 'Cool before slicing.',
	ingredients: [
		{ item: 'Butter', amount: 1, unit: 'cup', prepNote: 'softened' },
		{ item: 'Sugar', amount: 1.5, unit: 'cup' },
		{ item: 'Eggs', amount: 4 }
	]
};

test('checks off ingredients and steps while cooking, and keeps the screen on', async ({
	page,
	db,
	person
}) => {
	// A stand-in for the Screen Wake Lock API that records each lock.
	await page.addInitScript(() => {
		type Lock = EventTarget & { type: string; released: boolean; release: () => Promise<void> };
		const locks: Lock[] = [];
		Object.assign(window, { wakeLocks: locks });
		Object.defineProperty(navigator, 'wakeLock', {
			configurable: true,
			value: {
				request: async (type: string) => {
					const lock = Object.assign(new EventTarget(), {
						type,
						released: false,
						release: async () => {
							if (lock.released) return;
							lock.released = true;
							lock.dispatchEvent(new Event('release'));
						}
					});
					locks.push(lock);
					return lock;
				}
			}
		});
	});
	const locks = () =>
		page.evaluate(() =>
			(window as unknown as { wakeLocks: { type: string; released: boolean }[] }).wakeLocks.map(
				({ type, released }) => ({ type, released })
			)
		);

	const dishId = addRecipe(db, person.householdId, cookable);
	await page.goto(`/recipes/${dishId}?servings=8`);
	await page.getByRole('link', { name: 'Cook' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}/cook\\?servings=8$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pound cake · 8 servings');
	await expect.poll(locks).toEqual([{ type: 'screen', released: false }]);
	await expect(page.getByText('The screen may turn off')).toHaveCount(0);

	// Scaled, with the warning on the step with an amount only.
	const butter = checkOff(page, /Butter, softened/);
	await expect(butter.line).toHaveText('2 cups Butter, softened');
	const stepTwo = checkOff(page, /^2\. Beat in/);
	await expect(stepTwo.line).toContainText("Amounts in this step aren't scaled.");
	await expect(page.getByText("Amounts in this step aren't scaled.")).toHaveCount(1);

	// A tap on the line checks it off and crosses it out; another tap brings it back.
	await butter.line.tap();
	await expect(butter.box).toBeChecked();
	await expect(butter.text).toHaveCSS('text-decoration-line', 'line-through');
	await stepTwo.line.tap();
	await expect(stepTwo.box).toBeChecked();
	await expect(stepTwo.text).toHaveCSS('text-decoration-line', 'line-through');
	await stepTwo.line.tap();
	await expect(stepTwo.box).not.toBeChecked();
	await expect(stepTwo.text).toHaveCSS('text-decoration-line', 'none');
	await expect(butter.box).toBeChecked();
	await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);

	// The browser lets go of the lock when the page is hidden; it's asked for again when it's shown.
	await page.evaluate(async () => {
		const [lock] = (window as unknown as { wakeLocks: { release: () => Promise<void> }[] })
			.wakeLocks;
		await lock?.release();
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect.poll(locks).toEqual([
		{ type: 'screen', released: true },
		{ type: 'screen', released: false }
	]);

	// Leaving lets go of it, and goes back to the recipe at the same servings.
	await page.getByRole('link', { name: 'Back to recipe' }).click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${dishId}\\?servings=8$`));
	await expect(page.getByRole('status')).toHaveText('8 servings');
	await expect.poll(locks).toEqual([
		{ type: 'screen', released: true },
		{ type: 'screen', released: true }
	]);
});

test('cooks without the Wake Lock API, and says the screen may turn off', async ({
	page,
	db,
	person
}) => {
	await page.addInitScript(() => {
		delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
	});
	const dishId = addRecipe(db, person.householdId, cookable);
	await page.goto(`/recipes/${dishId}/cook`);
	expect(await page.evaluate(() => 'wakeLock' in navigator)).toBe(false);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pound cake · 4 servings');
	await expect(
		page.getByText("The screen may turn off while you cook. This browser couldn't keep it on.")
	).toBeVisible();
	await expect(page.getByText("Amounts in this step aren't scaled.")).toHaveCount(0);
	const sugar = checkOff(page, /^1 1\/2 cups Sugar$/);
	await sugar.line.tap();
	await expect(sugar.box).toBeChecked();
	const bake = checkOff(page, /^3\. Bake at 325°F for 1 hour\.$/);
	await bake.line.tap();
	await expect(bake.box).toBeChecked();
});

test('says so when the browser refuses to keep the screen on', async ({ page, db, person }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'wakeLock', {
			configurable: true,
			value: { request: () => Promise.reject(new DOMException('Battery saver', 'NotAllowedError')) }
		});
	});
	const dishId = addRecipe(db, person.householdId, cookable);
	await page.goto(`/recipes/${dishId}/cook`);
	await expect(page.getByText('The screen may turn off while you cook.')).toBeVisible();
	const cream = checkOff(page, /^1\. Cream/);
	await cream.line.tap();
	await expect(cream.box).toBeChecked();
});

test('finds recipes by name and tag, and archives and restores one', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, {
		name: 'Pound cake',
		tags: ['Dessert', 'Baking'],
		prepMinutes: 15,
		cookMinutes: 60,
		ingredients: [{ item: 'Butter', amount: 1, unit: 'cup' }]
	});
	addRecipe(db, person.householdId, { name: 'Lemon bars', tags: ['Dessert'], steps: 'Mix.' });
	const tacosId = addRecipe(db, person.householdId, { name: 'Tacos', tags: ['Dinner'] });
	addRecipe(db, person.householdId, {
		name: 'Chili',
		tags: ['Dinner'],
		cookMinutes: 45,
		ingredients: [{ item: 'Beans', amount: 2, unit: 'cans' }]
	});
	const names = page.locator('.recipes .name');

	await page.goto('/recipes');
	await expect(names).toHaveText(['Chili', 'Lemon bars', 'Pound cake', 'Tacos']);
	await expect(page.getByRole('link', { name: /^Chili/ })).toContainText('45 min · Dinner');
	// Only the recipe with no ingredients and no steps says so.
	await expect(page.getByText('No recipe', { exact: true })).toHaveCount(1);
	await expect(page.getByRole('link', { name: /^Tacos/ })).toContainText('No recipe');
	await expect(page.getByRole('link', { name: /^Tacos/ }).locator('img')).toHaveCount(0);

	const search = page.getByLabel('Search recipes');
	await search.fill('CAKE');
	await search.press('Enter');
	await expect(page).toHaveURL(/\?q=CAKE$/);
	await expect(names).toHaveText(['Pound cake']);
	await search.fill('zzz');
	await page.getByRole('button', { name: 'Search' }).click();
	await expect(page.getByText('No recipes matching “zzz”.')).toBeVisible();
	await page.getByRole('link', { name: 'Show all recipes' }).click();
	await expect(names).toHaveCount(4);

	const chips = page.getByRole('list', { name: 'Filter by tag' });
	await expect(chips.getByRole('link')).toHaveText(['Baking', 'Dessert', 'Dinner']);
	await chips.getByRole('link', { name: 'Dinner' }).click();
	await expect(page).toHaveURL(/\?tag=Dinner$/);
	await expect(names).toHaveText(['Chili', 'Tacos']);
	await expect(chips.getByRole('link', { name: 'Dinner' })).toHaveAttribute('aria-current', 'true');
	// Searching keeps the tag, and clearing the tag keeps the search.
	await search.fill('l');
	await search.press('Enter');
	await expect(names).toHaveText(['Chili']);
	await chips.getByRole('link', { name: 'Dinner' }).click();
	await expect(page).toHaveURL(/\?q=l$/);
	await expect(names).toHaveText(['Chili', 'Lemon bars']);

	// A recipe with nothing in it yet.
	await page.goto(`/recipes/${tacosId}`);
	await expect(page.getByText('No recipe yet.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute(
		'href',
		`/recipes/${tacosId}/edit`
	);
	await expect(page.getByRole('button', { name: 'Check pantry' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Cook' })).toHaveCount(0);

	// Archive asks first, then the recipe leaves the list.
	await page.goto('/recipes');
	await page.getByRole('link', { name: /^Chili/ }).click();
	await page.getByRole('button', { name: 'Archive' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(
		'Archive Chili? It leaves the recipe list, and you can restore it from the archived recipes.'
	);
	await dialog.getByRole('button', { name: 'Archive' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText('Archived', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);

	await page.getByRole('link', { name: 'Recipes' }).click();
	await expect(names).toHaveText(['Lemon bars', 'Pound cake', 'Tacos']);
	await page.getByRole('link', { name: 'Show archived' }).click();
	await expect(page.getByRole('heading', { name: 'Archived recipes' })).toBeVisible();
	await expect(names).toHaveText(['Chili']);
	await page.getByRole('link', { name: /^Chili/ }).click();
	await page.getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByText('Archived', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
	await page.getByRole('link', { name: 'Recipes' }).click();
	await expect(names).toHaveText(['Chili', 'Lemon bars', 'Pound cake', 'Tacos']);
	await page.getByRole('link', { name: 'Show archived' }).click();
	await expect(page.getByText('No archived recipes.')).toBeVisible();
});

test("can't see or change another household's recipe or its photo", async ({
	page,
	db,
	context,
	baseURL,
	person
}) => {
	const other = addPerson(db);
	expect(other.householdId).not.toBe(person.householdId);
	const jpeg = await makeJpeg(page, { width: 400, height: 300 });
	const key = addPhotoFiles(jpeg, jpeg);
	const dishId = addRecipe(db, other.householdId, {
		name: 'Secret stew',
		photoKey: key,
		steps: 'Simmer.',
		ingredients: [{ item: 'Beef', amount: 1, unit: 'lb' }]
	});

	for (const path of [`/recipes/${dishId}`, `/recipes/${dishId}/edit`, `/recipes/${dishId}/cook`]) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
		await expect(page.getByText('Secret stew')).toHaveCount(0);
	}
	for (const path of [`/photos/${key}.jpg`, `/photos/${key}-thumb.jpg`]) {
		expect((await page.request.get(path)).status(), path).toBe(404);
	}

	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const archive = await page.request.post(`/recipes/${dishId}?/archive`, { form: {}, headers });
	expect(archive.status()).toBe(404);
	const save = await page.request.post(`/recipes/${dishId}/edit?/save`, {
		multipart: { name: 'Mine now', servings: '4', tags: '', ingredients: '[]', removePhoto: '1' },
		headers
	});
	expect(save.status()).toBe(404);
	const start = await page.request.post('/pantry?/start', {
		form: { dishId: String(dishId), servings: '4' },
		headers
	});
	expect(start.status()).toBe(404);
	expect(
		db.prepare('select name, photo_key, archived_at from dishes where id = ?').get(dishId)
	).toEqual({ name: 'Secret stew', photo_key: key, archived_at: null });
	expect(
		db
			.prepare('select count(*) from pantry_checklists where household_id = ?')
			.pluck()
			.get(person.householdId)
	).toBe(0);
	await page.goto('/recipes');
	await expect(page.getByText('Secret stew')).toHaveCount(0);

	// Its own household sees all of it.
	await signInAs(db, context, baseURL, other.userId);
	await page.goto(`/recipes/${dishId}`);
	await expect(page.getByRole('heading', { name: 'Secret stew' })).toBeVisible();
	await expectJpeg(page, `/photos/${key}.jpg`);
	await expectJpeg(page, `/photos/${key}-thumb.jpg`);
});

test('fits long names and words on a phone screen without scrolling sideways', async ({
	page,
	db,
	person
}) => {
	// As long as the editor allows, in single words that can't wrap at a space.
	const dishId = addRecipe(db, person.householdId, {
		name: 'N'.repeat(80),
		tags: ['T'.repeat(30)],
		steps: `${'x'.repeat(300)}\nAdd 2 cups.`,
		notes: 'y'.repeat(300),
		ingredients: [
			{ item: 'Z'.repeat(80), amount: 1.5, unit: 'u'.repeat(20), prepNote: 'q'.repeat(80) },
			{ item: 'Eggs', amount: 2, section: 'S'.repeat(60) }
		]
	});
	db.prepare('update dishes set source = ? where id = ?').run(
		`https://example.com/${'a'.repeat(400)}`,
		dishId
	);
	const sideways = () =>
		page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);

	for (const path of [
		'/recipes',
		`/recipes/${dishId}?servings=7`,
		`/recipes/${dishId}/edit`,
		`/recipes/${dishId}/cook?servings=7`
	]) {
		await page.goto(path);
		expect(await sideways(), path).toBe(0);
	}
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	expect(await sideways(), '/pantry').toBe(0);
});
