import type { Page } from '@playwright/test';
import { addItem, addRecipe, addStore, expect, test } from './fixtures.ts';

/** One item's row on the pantry check. */
function row(page: Page, name: string) {
	return page.locator('li.item').filter({ has: page.getByText(name, { exact: true }) });
}

function grocery(page: Page, store: string) {
	return page.locator('details', {
		has: page.getByRole('heading', { name: store, exact: true })
	});
}

test('checks the pantry for a recipe at the servings shown', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Flour', { defaultStoreId: aldi });
	const butter = addItem(db, person.householdId, 'Butter');
	// Butter is already on the grocery list.
	db.prepare(
		"insert into grocery_needs (household_id, item_id, quantity, status, created_at) values (?, ?, 1, 'to_order', ?)"
	).run(person.householdId, butter, Date.now());
	const dishId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		servings: 4,
		steps: 'Mix.\nBake.',
		ingredients: [
			{ item: 'Flour', amount: 1, unit: 'cup' },
			{ item: 'Sugar', amount: 1, unit: 'cup' },
			{ item: 'Butter', amount: 1, unit: 'cup' },
			{ item: 'Eggs', amount: 4 },
			{ item: 'Salt' },
			{ item: 'Flour', amount: 2, unit: 'tbsp', section: 'For the pan' }
		]
	});

	// The header menu leads to it.
	await page.goto('/groceries');
	await page.getByText('Menu', { exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Menu' })
		.getByRole('link', { name: 'Pantry check' })
		.click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(
		page.getByText('No pantry check yet. Open a recipe and tap Check pantry.')
	).toBeVisible();

	// Salt is set to Always have on the Items page, so the check leaves it out.
	await page.goto('/groceries/items');
	await page.getByRole('button', { name: /^Salt/ }).click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('Always have').check();
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Salt/ })).toContainText('Always have');

	// From the recipe at 6 servings instead of 4.
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(page.getByRole('status')).toHaveText('6 servings');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page).toHaveURL(/\/pantry$/);

	await expect(page.getByRole('heading', { name: 'Pantry check', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Pound cake, 6 servings' })).toHaveAttribute(
		'href',
		`/recipes/${dishId}?servings=6`
	);
	const count = page.getByRole('status');
	// Butter is on the list already, so three are left to check.
	await expect(count).toHaveText('0 of 3 checked');
	await expect(page.locator('li.item .name')).toHaveText(['Flour', 'Sugar', 'Butter', 'Eggs']);
	await expect(page.getByText('Salt', { exact: true })).toHaveCount(0);

	// Flour is in the recipe twice: one total at 6 servings, then each use.
	await expect(row(page, 'Flour').locator('.amount')).toHaveText('1 2/3 cups');
	await expect(row(page, 'Flour').locator('.breakdown li')).toHaveText([
		'1 1/2 cups for Pound cake',
		'3 tbsp for Pound cake'
	]);
	await expect(row(page, 'Sugar').locator('.amount')).toHaveText('1 1/2 cups');
	await expect(row(page, 'Sugar').locator('.breakdown')).toHaveCount(0);
	await expect(row(page, 'Eggs').locator('.amount')).toHaveText('6');
	await expect(row(page, 'Butter')).toContainText('Already on the list');
	await expect(row(page, 'Butter')).toContainText('To Order');
	await expect(row(page, 'Butter').getByRole('button')).toHaveCount(0);

	await page.getByRole('button', { name: 'Have Sugar' }).click();
	await expect(row(page, 'Sugar')).toContainText('✓ Have');
	await expect(count).toHaveText('1 of 3 checked');
	await expect(page.getByRole('link', { name: 'Grocery list' })).toHaveCount(0);

	// Need puts it on the grocery list right away, at its usual store, with what the recipe needs.
	await page.getByRole('button', { name: 'Need Flour' }).click();
	await expect(row(page, 'Flour')).toContainText('On the list');
	await expect(row(page, 'Flour')).toContainText('To Order');
	await expect(count).toHaveText('2 of 3 checked');
	const line = () =>
		db
			.prepare(
				"select quantity, unit, store_id, status, note from grocery_needs where item_id = (select id from items where household_id = ? and name = 'Flour')"
			)
			.all(person.householdId);
	expect(line()).toEqual([
		{
			quantity: 1,
			unit: null,
			store_id: aldi,
			status: 'to_order',
			note: '1 2/3 cups for Pound cake'
		}
	]);
	await page.getByRole('link', { name: 'Grocery list' }).click();
	await expect(page).toHaveURL(/\/groceries$/);
	await expect(
		grocery(page, 'Aldi').getByRole('button', { name: /^Flour\s*1\s*1 2\/3 cups for Pound cake$/ })
	).toBeVisible();

	// Undo takes the line off the list again.
	await page.goBack();
	await expect(page).toHaveURL(/\/pantry$/);
	await page.getByRole('button', { name: 'Undo Need for Flour' }).click();
	await expect(row(page, 'Flour').getByRole('button', { name: 'Need Flour' })).toBeVisible();
	await expect(count).toHaveText('1 of 3 checked');
	expect(line()).toEqual([]);
	await page.goto('/groceries');
	await expect(page.getByRole('button', { name: /^Flour/ })).toHaveCount(0);

	// Start over clears every mark, after asking.
	await page.goto('/pantry');
	await page.getByRole('button', { name: 'Have Eggs' }).click();
	await expect(count).toHaveText('2 of 3 checked');
	await page.getByRole('button', { name: 'Start over' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(
		'Clear the 2 checked items? Anything Need added stays on the grocery list.'
	);
	await dialog.getByRole('button', { name: 'Start over' }).click();
	await expect(count).toHaveText('0 of 3 checked');
	await expect(page.getByRole('button', { name: 'Have Sugar' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Have Eggs' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start over' })).toHaveCount(0);
});

test('keeps a line that was ordered when its Need is undone', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Eggs', { defaultStoreId: aldi });
	const dishId = addRecipe(db, person.householdId, {
		name: 'Omelet',
		servings: 1,
		ingredients: [{ item: 'Eggs', amount: 3 }]
	});
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('button', { name: 'Need Eggs' }).click();
	await expect(row(page, 'Eggs')).toContainText('On the list');

	// Then ordered from the grocery list.
	await page.getByRole('link', { name: 'Grocery list' }).click();
	const store = grocery(page, 'Aldi');
	await store.getByRole('button', { name: /^Eggs\s*1\s*3 for Omelet$/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Mark ordered' }).click();
	await expect(store.getByRole('heading', { name: 'Ordered' })).toBeVisible();

	await page.goto('/pantry');
	await expect(row(page, 'Eggs')).toContainText('Ordered');
	await page.getByRole('button', { name: 'Undo Need for Eggs' }).click();
	// The mark goes, but the order stands, so it's simply on the list now.
	await expect(row(page, 'Eggs')).toContainText('Already on the list');
	await expect(row(page, 'Eggs').getByRole('button')).toHaveCount(0);
	expect(
		db
			.prepare('select status from grocery_needs where household_id = ?')
			.pluck()
			.all(person.householdId)
	).toEqual(['ordered']);
});

test('asks before a new check replaces one with checked items', async ({ page, db, person }) => {
	const cakeId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		ingredients: [
			{ item: 'Flour', amount: 2, unit: 'cup' },
			{ item: 'Sugar', amount: 1, unit: 'cup' }
		]
	});
	const barsId = addRecipe(db, person.householdId, {
		name: 'Lemon bars',
		ingredients: [
			{ item: 'Lemons', amount: 3 },
			{ item: 'Sugar', amount: 0.5, unit: 'cup' }
		]
	});

	// Nothing is checked yet, so a new check starts straight away.
	await page.goto(`/recipes/${cakeId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page.getByRole('link', { name: 'Pound cake, 4 servings' })).toBeVisible();
	await page.goto(`/recipes/${barsId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page.getByRole('link', { name: 'Lemon bars, 4 servings' })).toBeVisible();
	await page.goto(`/recipes/${cakeId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('button', { name: 'Have Flour' }).click();
	await expect(page.getByRole('status')).toHaveText('1 of 2 checked');

	await page.goto(`/recipes/${barsId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(
		'Start a new pantry check for Lemon bars? It replaces the current one, which has 1 item checked.'
	);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/recipes/${barsId}$`));
	await page.goto('/pantry');
	await expect(page.getByRole('link', { name: 'Pound cake, 4 servings' })).toBeVisible();
	await expect(row(page, 'Flour')).toContainText('✓ Have');

	await page.goto(`/recipes/${barsId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await dialog.getByRole('button', { name: 'Start new check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('link', { name: 'Lemon bars, 4 servings' })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText('0 of 2 checked');
	await expect(page.locator('li.item .name')).toHaveText(['Lemons', 'Sugar']);
	await expect(row(page, 'Sugar').locator('.amount')).toHaveText('1/2 cup');
});

test("doesn't replace a check someone marked after the recipe page loaded", async ({
	page,
	db,
	person
}) => {
	const cakeId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		ingredients: [{ item: 'Flour', amount: 2, unit: 'cup' }]
	});
	const barsId = addRecipe(db, person.householdId, {
		name: 'Lemon bars',
		ingredients: [{ item: 'Lemons', amount: 3 }]
	});
	await page.goto(`/recipes/${barsId}`);
	await expect(page.getByRole('button', { name: 'Check pantry' })).toBeVisible();

	// Meanwhile another member starts a check and marks Flour.
	const checklist = db
		.prepare(
			'insert into pantry_checklists (household_id, dish_id, servings, created_at) values (?, ?, 4, ?)'
		)
		.run(person.householdId, cakeId, Date.now()).lastInsertRowid;
	db.prepare(
		"insert into pantry_marks (household_id, checklist_id, item_id, state) values (?, ?, ?, 'have')"
	).run(person.householdId, checklist, addItem(db, person.householdId, 'Flour'));

	// The page didn't know to ask, so the server refuses and shows their check.
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('alert')).toHaveText(
		'Someone has checked items on this pantry check since you opened the recipe. To replace it, go back to the recipe and tap Check pantry again.'
	);
	await expect(page.getByRole('link', { name: 'Pound cake, 4 servings' })).toBeVisible();
	await expect(row(page, 'Flour')).toContainText('✓ Have');

	// Back on the recipe, it asks.
	await page.goBack();
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Start new check' }).click();
	await expect(page.getByRole('link', { name: 'Lemon bars, 4 servings' })).toBeVisible();
});

test('keeps focus on the item after Have, Need and Undo', async ({ page, db, person }) => {
	const dishId = addRecipe(db, person.householdId, {
		name: 'Omelet',
		servings: 1,
		ingredients: [{ item: 'Eggs', amount: 3 }, { item: 'Butter' }]
	});
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('button', { name: 'Have Eggs' }).press('Enter');
	await expect(page.getByRole('button', { name: 'Undo Have for Eggs' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Have Eggs' })).toBeFocused();
	await page.getByRole('button', { name: 'Need Butter' }).press('Enter');
	await expect(page.getByRole('button', { name: 'Undo Need for Butter' })).toBeFocused();

	// Someone else marks Eggs first. Need is refused, and focus stays on the item.
	const checklist = db
		.prepare('select id from pantry_checklists where household_id = ?')
		.pluck()
		.get(person.householdId);
	const eggs = db
		.prepare("select id from items where household_id = ? and name = 'Eggs'")
		.pluck()
		.get(person.householdId);
	db.prepare(
		"insert into pantry_marks (household_id, checklist_id, item_id, state) values (?, ?, ?, 'have')"
	).run(person.householdId, checklist, eggs);
	await page.getByRole('button', { name: 'Need Eggs' }).press('Enter');
	await expect(row(page, 'Eggs').getByRole('alert')).toHaveText('Eggs is already checked');
	await expect(page.getByRole('button', { name: 'Undo Have for Eggs' })).toBeFocused();
});

test('says an item Need added has been bought once its line is received', async ({
	page,
	db,
	person
}) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Eggs', { defaultStoreId: aldi });
	const dishId = addRecipe(db, person.householdId, {
		name: 'Omelet',
		servings: 1,
		ingredients: [{ item: 'Eggs', amount: 3 }]
	});
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('button', { name: 'Need Eggs' }).click();
	await expect(row(page, 'Eggs')).toContainText('On the list');

	const now = Date.now();
	db.prepare(
		"update grocery_needs set status = 'received', ordered_at = ?, received_at = ? where household_id = ?"
	).run(now, now, person.householdId);
	await page.reload();
	await expect(row(page, 'Eggs')).toContainText('Bought');
	await expect(row(page, 'Eggs')).toContainText('Received');
	await expect(row(page, 'Eggs')).not.toContainText('On the list');
});

test('lists a recipe with steps but no ingredients at the bottom', async ({ page, db, person }) => {
	const dishId = addRecipe(db, person.householdId, { name: 'Toast', steps: 'Toast the bread.' });
	await page.goto(`/recipes/${dishId}`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByText('No ingredients yet: Toast')).toBeVisible();
	await expect(page.locator('li.item')).toHaveCount(0);
});
