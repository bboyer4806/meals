import type { Page } from '@playwright/test';
import {
	addDays,
	addDinner,
	addItem,
	addRecipe,
	addStore,
	dayLabel,
	expect,
	monthDay,
	test,
	today,
	weekday
} from './fixtures.ts';

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

	// The header's More menu leads to it.
	await page.goto('/groceries');
	await page.getByText('More', { exact: true }).click();
	await page
		.getByRole('navigation', { name: 'More' })
		.getByRole('link', { name: 'Pantry check' })
		.click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(
		page.getByText('No pantry check yet. Open the menu or a recipe and tap Check pantry.')
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

// From the menu (design 6.8): a range of dates, by default today and the 6 days after it.

/** Each line's breakdown, "1 cup for Pound cake (Tue)", across the whole check. */
function breakdowns(page: Page) {
	return page.locator('li.item .breakdown li').allTextContents();
}

test('checks the pantry for the next 7 days of the menu', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Flour', { defaultStoreId: aldi });
	addItem(db, person.householdId, 'Salt', { alwaysHave: true });
	const recipe = (seed: Parameters<typeof addRecipe>[2]) => addRecipe(db, person.householdId, seed);
	const cake = recipe({
		name: 'Pound cake',
		servings: 4,
		ingredients: [
			{ item: 'Flour', amount: 0.5, unit: 'cup' },
			{ item: 'Eggs', amount: 2 },
			{ item: 'Salt' },
			{ item: 'Butter', amount: 0.5, unit: 'cup' }
		]
	});
	const sauce = recipe({
		name: 'Pan sauce',
		servings: 2,
		ingredients: [
			{ item: 'Flour', amount: 1, unit: 'tbsp' },
			{ item: 'Butter', amount: 2, unit: 'tbsp' },
			{ item: 'Stock', amount: 1, unit: 'cup' }
		]
	});
	const rolls = recipe({ name: 'Rolls' });
	const potatoSalad = recipe({
		name: 'Potato salad',
		servings: 4,
		ingredients: [
			{ item: 'Potatoes', amount: 2, unit: 'lb' },
			{ item: 'Eggs', amount: 3 }
		]
	});
	const lasagna = recipe({
		name: 'Lasagna',
		servings: 6,
		ingredients: [{ item: 'Ricotta', amount: 15, unit: 'oz' }]
	});
	const brownies = recipe({
		name: 'Brownies',
		ingredients: [{ item: 'Cocoa', amount: 0.5, unit: 'cup' }]
	});
	const now = today();
	const days = Array.from({ length: 8 }, (_, index) => addDays(now, index));
	const plan = (date: string, seed: Parameters<typeof addDinner>[3]) =>
		addDinner(db, person.householdId, date, seed);
	// Outside the 7 days: yesterday and a week from today.
	plan(addDays(now, -1), { dishes: [[brownies, 'dessert']] });
	plan(days[7] ?? '', { dishes: [[brownies, 'dessert']] });
	// Pound cake and Pan sauce are at twice their recipes' servings.
	plan(days[1] ?? '', {
		servings: 8,
		dishes: [
			[cake, 'dessert'],
			[rolls, 'side']
		]
	});
	plan(days[2] ?? '', { type: 'eat_out', note: 'Pizza' });
	plan(days[3] ?? '', { servings: 4, dishes: [[sauce, 'side']] });
	plan(days[4] ?? '', { type: 'leftovers', note: 'Pound cake' });
	plan(days[5] ?? '', { type: 'going', servings: 4, dishes: [[potatoSalad, 'main']] });
	// Lasagna at half its recipe's servings.
	plan(days[6] ?? '', {
		servings: 3,
		dishes: [
			[rolls, 'side'],
			[lasagna, 'main']
		]
	});
	const day = (index: number) => weekday(days[index] ?? '');

	// The menu's Check pantry starts with today and the 6 days after it.
	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	const sheet = page.getByRole('dialog', { name: 'Check pantry' });
	await expect(sheet.getByLabel('From')).toHaveValue(now);
	await expect(sheet.getByLabel('To')).toHaveValue(days[6] ?? '');
	await expect(sheet).toContainText(`${dayLabel(now)} to ${dayLabel(days[6] ?? '')}, 7 days`);
	await sheet.getByRole('button', { name: 'Start check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	const source = page.getByRole('link', {
		name: `${dayLabel(now)} to ${dayLabel(days[6] ?? '')}`
	});
	await expect(source).toHaveAttribute('href', `/menu?week=${now}`);

	// One line per item, in the order the dinners and their dishes come, each combined across
	// dinners and scaled to each dinner's servings. Salt is Always have.
	const count = page.getByRole('status');
	await expect(count).toHaveText('0 of 6 checked');
	await expect(page.locator('li.item .name')).toHaveText([
		'Flour',
		'Eggs',
		'Butter',
		'Stock',
		'Potatoes',
		'Ricotta'
	]);
	await expect(row(page, 'Flour').locator('.amount')).toHaveText('1 1/8 cups');
	await expect(row(page, 'Flour').locator('.breakdown li')).toHaveText([
		`1 cup for Pound cake (${day(1)})`,
		`2 tbsp for Pan sauce (${day(3)})`
	]);
	await expect(row(page, 'Eggs').locator('.amount')).toHaveText('7');
	await expect(row(page, 'Eggs').locator('.breakdown li')).toHaveText([
		`4 for Pound cake (${day(1)})`,
		`3 for Potato salad (${day(5)})`
	]);
	await expect(row(page, 'Butter').locator('.amount')).toHaveText('1 1/4 cups');
	await expect(row(page, 'Butter').locator('.breakdown li')).toHaveText([
		`1 cup for Pound cake (${day(1)})`,
		`1/4 cup for Pan sauce (${day(3)})`
	]);
	await expect(row(page, 'Stock').locator('.amount')).toHaveText('2 cups');
	await expect(row(page, 'Stock').locator('.breakdown li')).toHaveText([
		`2 cups for Pan sauce (${day(3)})`
	]);
	await expect(row(page, 'Potatoes').locator('.amount')).toHaveText('2 lb');
	await expect(row(page, 'Ricotta').locator('.amount')).toHaveText('7 1/2 oz');
	await expect(row(page, 'Ricotta').locator('.breakdown li')).toHaveText([
		`7 1/2 oz for Lasagna (${day(6)})`
	]);
	await expect(page.getByText(/Salt|Cocoa|Brownies/)).toHaveCount(0);
	// Eating out and Leftovers add nothing.
	for (const text of await breakdowns(page)) {
		expect(text).not.toContain(`(${day(2)})`);
		expect(text).not.toContain(`(${day(4)})`);
	}
	// Dishes without ingredients are listed with their days, so they aren't forgotten.
	await expect(page.getByText('No ingredients yet:')).toHaveText(
		`No ingredients yet: Rolls (${day(1)}), Rolls (${day(6)})`
	);

	// Need adds a grocery line whose note names each dish with its day.
	await page.getByRole('button', { name: 'Need Flour' }).click();
	await expect(row(page, 'Flour')).toContainText('On the list');
	await page.getByRole('button', { name: 'Have Eggs' }).click();
	await expect(count).toHaveText('2 of 6 checked');
	expect(
		db
			.prepare(
				"select quantity, store_id, status, note from grocery_needs where item_id = (select id from items where household_id = ? and name = 'Flour')"
			)
			.all(person.householdId)
	).toEqual([
		{
			quantity: 1,
			store_id: aldi,
			status: 'to_order',
			note: `1 1/8 cups for Pound cake (${day(1)}), Pan sauce (${day(3)})`
		}
	]);

	// Changes to the menu show up: more people for the potato salad...
	await page.goto(`/menu/${days[5]}`);
	await page.getByLabel('Servings', { exact: true }).fill('8');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.goto('/pantry');
	await expect(row(page, 'Potatoes').locator('.amount')).toHaveText('4 lb');
	await expect(row(page, 'Eggs').locator('.amount')).toHaveText('10');
	await expect(row(page, 'Eggs').locator('.breakdown li')).toHaveText([
		`4 for Pound cake (${day(1)})`,
		`6 for Potato salad (${day(5)})`
	]);
	// Marks are kept per item.
	await expect(row(page, 'Eggs')).toContainText('✓ Have');

	// ...and the lasagna dinner turned into eating out.
	await page.goto(`/menu/${days[6]}`);
	await page
		.getByRole('form', { name: 'Type' })
		.getByRole('button', { name: 'Eating out' })
		.click();
	await page
		.getByRole('dialog', { name: 'Switch to Eating out?' })
		.getByRole('button', { name: 'Switch to Eating out' })
		.click();
	await expect(page.getByRole('region', { name: 'Dishes' })).toHaveCount(0);
	await page.goto('/pantry');
	await expect(page.locator('li.item .name')).toHaveText([
		'Flour',
		'Eggs',
		'Butter',
		'Stock',
		'Potatoes'
	]);
	await expect(page.getByText('No ingredients yet:')).toHaveText(
		`No ingredients yet: Rolls (${day(1)})`
	);
	await expect(count).toHaveText('2 of 5 checked');

	// The dates lead back to the menu.
	await source.click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${now}$`));
	await expect(page.locator(`a.day[href="/menu/${now}"]`)).toBeVisible();
});

test('asks before a check from the menu replaces one with checked items', async ({
	page,
	db,
	person
}) => {
	const cakeId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		ingredients: [{ item: 'Flour', amount: 2, unit: 'cup' }]
	});
	const omeletId = addRecipe(db, person.householdId, {
		name: 'Omelet',
		servings: 1,
		ingredients: [{ item: 'Eggs', amount: 3 }]
	});
	const tomorrow = addDays(today(), 1);
	addDinner(db, person.householdId, tomorrow, { servings: 2, dishes: [[omeletId, 'main']] });
	const recipeCheck = db
		.prepare(
			'insert into pantry_checklists (household_id, dish_id, servings, created_at) values (?, ?, 4, ?)'
		)
		.run(person.householdId, cakeId, Date.now()).lastInsertRowid;
	const mark = db.prepare(
		"insert into pantry_marks (household_id, checklist_id, item_id, state) values (?, ?, ?, 'have')"
	);
	mark.run(person.householdId, recipeCheck, addItem(db, person.householdId, 'Flour'));

	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	const sheet = page.getByRole('dialog', { name: 'Check pantry' });
	await expect(sheet).toContainText(
		'This replaces the current pantry check, which has 1 item checked.'
	);
	await expect(sheet.getByRole('button', { name: 'Start check' })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Cancel' }).click();
	await expect(sheet).toHaveCount(0);
	await page.goto('/pantry');
	await expect(page.getByRole('link', { name: 'Pound cake, 4 servings' })).toBeVisible();
	await expect(row(page, 'Flour')).toContainText('✓ Have');

	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await sheet.getByRole('button', { name: 'Start new check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	const range = `${dayLabel(today())} to ${dayLabel(addDays(today(), 6))}`;
	await expect(page.getByRole('link', { name: range })).toBeVisible();
	await expect(page.locator('li.item .name')).toHaveText(['Eggs']);
	await expect(row(page, 'Eggs').locator('.breakdown li')).toHaveText([
		`6 for Omelet (${weekday(tomorrow)})`
	]);
	await expect(page.getByRole('status')).toHaveText('0 of 1 checked');

	// The menu loaded before someone checked an item on the new check, so it didn't ask. The
	// pantry page says so, under their check.
	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(sheet.getByRole('button', { name: 'Start check' })).toBeVisible();
	const rangeCheck = db
		.prepare('select id from pantry_checklists where household_id = ?')
		.pluck()
		.get(person.householdId);
	mark.run(person.householdId, rangeCheck, addItem(db, person.householdId, 'Eggs'));
	await sheet.getByRole('button', { name: 'Start check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('alert')).toHaveText(
		'Someone has checked items on this pantry check since you opened the menu. To replace it, go back to the menu and tap Check pantry again.'
	);
	await expect(row(page, 'Eggs')).toContainText('✓ Have');

	// Back on the menu, it asks.
	await page.goBack();
	await expect(page).toHaveURL(/\/menu$/);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await expect(sheet).toContainText(
		'This replaces the current pantry check, which has 1 item checked.'
	);
	await sheet.getByRole('button', { name: 'Start new check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByRole('status')).toHaveText('0 of 1 checked');
});

test('keeps a check from the menu to 1 to 14 days', async ({ page, baseURL, person: _ }) => {
	const now = today();
	// The check starts with the next 7 days, whichever week is showing.
	const later = `/menu?week=${addDays(now, 14)}`;
	await page.goto(later);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	const sheet = page.getByRole('dialog', { name: 'Check pantry' });
	const from = sheet.getByLabel('From');
	const to = sheet.getByLabel('To');
	const start = sheet.getByRole('button', { name: 'Start check' });
	const hint = 'Pick up to 14 days, ending on or after the start.';
	await expect(from).toHaveValue(now);
	await expect(to).toHaveValue(addDays(now, 6));

	await to.fill(addDays(now, 13));
	await expect(sheet).toContainText(`${dayLabel(now)} to ${dayLabel(addDays(now, 13))}, 14 days`);

	// One day more is too many, and the browser stops the form with the reason.
	await to.fill(addDays(now, 14));
	await expect(sheet).toContainText(hint);
	await start.click();
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(later);
	expect(await to.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe(
		'Pick 14 days or fewer'
	);

	// So is an end before the start.
	await to.fill(addDays(now, -1));
	await expect(sheet).toContainText(hint);
	await start.click();
	await expect(page).toHaveURL(later);
	expect(await to.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);

	// A new start past the end moves the end to 7 days.
	await from.fill(addDays(now, 20));
	await expect(to).toHaveValue(addDays(now, 26));
	await expect(sheet).toContainText(
		`${dayLabel(addDays(now, 20))} to ${dayLabel(addDays(now, 26))}, 7 days`
	);

	// A single day.
	await to.fill(addDays(now, 20));
	await expect(sheet).toContainText(`${dayLabel(addDays(now, 20))}, 1 day`);
	await start.click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(
		page.getByRole('link', { name: dayLabel(addDays(now, 20)), exact: true })
	).toBeVisible();
	await expect(
		page.getByText(`Nothing planned with dishes on ${dayLabel(addDays(now, 20))}.`)
	).toBeVisible();

	// The server holds to the same limits.
	const headers = { origin: baseURL ?? '' };
	for (const [startDate, endDate, message] of [
		[now, addDays(now, 14), 'Pick 14 days or fewer'],
		[now, addDays(now, -1), 'Pick an end date on or after the start date'],
		['someday', now, 'Pick a start date']
	] as const) {
		const response = await page.request.post('/pantry?/startMenu', {
			form: { startDate, endDate },
			headers
		});
		expect(response.status(), message).toBe(400);
		expect(await response.text(), message).toContain(message);
	}
	await page.reload();
	await expect(
		page.getByRole('link', { name: dayLabel(addDays(now, 20)), exact: true })
	).toBeVisible();
});

test('names each dish by its date in a check longer than 7 days', async ({ page, db, person }) => {
	const now = today();
	const chili = addRecipe(db, person.householdId, {
		name: 'Chili',
		servings: 4,
		ingredients: [{ item: 'Beans', amount: 1, unit: 'cup' }]
	});
	const cornbread = addRecipe(db, person.householdId, { name: 'Cornbread' });
	addDinner(db, person.householdId, addDays(now, 1), { servings: 8, dishes: [[chili, 'main']] });
	// A week later, the same weekday.
	addDinner(db, person.householdId, addDays(now, 8), {
		dishes: [
			[chili, 'main'],
			[cornbread, 'side']
		]
	});
	// The day after the 14.
	addDinner(db, person.householdId, addDays(now, 14), { dishes: [[chili, 'main']] });

	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	const sheet = page.getByRole('dialog', { name: 'Check pantry' });
	await sheet.getByLabel('To').fill(addDays(now, 13));
	await sheet.getByRole('button', { name: 'Start check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(
		page.getByRole('link', { name: `${dayLabel(now)} to ${dayLabel(addDays(now, 13))}` })
	).toBeVisible();
	// The weekday alone would name two days, so each dish is named with its date.
	await expect(row(page, 'Beans').locator('.amount')).toHaveText('3 cups');
	await expect(row(page, 'Beans').locator('.breakdown li')).toHaveText([
		`2 cups for Chili (${monthDay(addDays(now, 1))})`,
		`1 cup for Chili (${monthDay(addDays(now, 8))})`
	]);
	await expect(page.getByText('No ingredients yet:')).toHaveText(
		`No ingredients yet: Cornbread (${monthDay(addDays(now, 8))})`
	);
	await page.getByRole('button', { name: 'Need Beans' }).click();
	await expect(row(page, 'Beans')).toContainText('On the list');
	expect(
		db
			.prepare('select note from grocery_needs where household_id = ?')
			.pluck()
			.all(person.householdId)
	).toEqual([
		`3 cups for Chili (${monthDay(addDays(now, 1))}), Chili (${monthDay(addDays(now, 8))})`
	]);
});
