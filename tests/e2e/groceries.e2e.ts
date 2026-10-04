import type { Page } from '@playwright/test';
import { addStore, expect, test } from './fixtures.ts';

function addForm(page: Page) {
	return page.getByRole('form', { name: 'Add to the list' });
}

async function addItem(
	page: Page,
	item: { name: string; quantity?: string; unit?: string; store?: string }
) {
	const form = addForm(page);
	await form.getByRole('combobox', { name: 'Item' }).fill(item.name);
	await form.getByLabel('Quantity').fill(item.quantity ?? '1');
	await form.getByLabel('Unit').fill(item.unit ?? '');
	if (item.store) await form.getByLabel('Store').selectOption({ label: item.store });
	await form.getByRole('button', { name: 'Add' }).click();
}

async function addAndWait(page: Page, item: Parameters<typeof addItem>[1]) {
	await addItem(page, item);
	await expect(addForm(page).getByRole('combobox', { name: 'Item' })).toHaveValue('');
}

function group(page: Page, name: string) {
	return page.locator('details', { has: page.getByRole('heading', { name, exact: true }) });
}

async function confirm(page: Page, button: string) {
	await page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('orders and receives a store, then suggests that store next time', async ({
	page,
	db,
	person
}) => {
	const walmartId = addStore(db, person.householdId, 'Walmart');
	addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');

	await addAndWait(page, { name: 'Milk', quantity: '2', unit: 'gal', store: 'Walmart' });
	await addItem(page, { name: 'Eggs', quantity: '1', unit: 'dozen', store: 'Walmart' });
	const walmart = group(page, 'Walmart');
	await expect(walmart.getByRole('button', { name: /Milk\s*2 gal/ })).toBeVisible();

	await walmart.getByRole('button', { name: 'Mark all ordered' }).click();
	await expect(page.getByRole('dialog')).toContainText('Mark 2 Walmart items as ordered?');
	await confirm(page, 'Mark ordered');
	await expect(walmart.getByRole('heading', { name: 'Ordered' })).toBeVisible();

	await walmart.getByRole('button', { name: 'Mark all received' }).click();
	await confirm(page, 'Mark received');
	await expect(walmart.getByRole('heading', { name: 'Received today' })).toBeVisible();
	await expect(walmart.getByRole('button', { name: 'Undo received: Milk' })).toBeVisible();

	// The item now suggests Walmart and the unit used last time.
	const item = addForm(page).getByRole('combobox', { name: 'Item' });
	await item.fill('mil');
	await page.getByRole('option', { name: 'Milk' }).click();
	await expect(item).toHaveValue('Milk');
	await expect(addForm(page).getByLabel('Store')).toHaveValue(String(walmartId));
	await expect(addForm(page).getByLabel('Unit')).toHaveValue('gal');
	await addForm(page).getByRole('button', { name: 'Add' }).click();
	await expect(walmart.getByRole('button', { name: /Milk\s*1 gal/ })).toBeVisible();
	await expect(item).toHaveValue('');
});

test('offers to update a line already on the list', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Coffee', quantity: '1', unit: 'bag' });
	await addItem(page, { name: 'coffee', quantity: '2', unit: 'bag' });

	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Already on the list: 1 bag');
	await expect(dialog.getByLabel('Quantity')).toHaveValue('3');
	await dialog.getByRole('button', { name: 'Update' }).click();
	await expect(dialog).toHaveCount(0);

	const noStore = group(page, 'No store');
	await expect(noStore.getByRole('button', { name: /Coffee\s*3 bag/ })).toBeVisible();
	await expect(noStore.getByRole('button', { name: /Coffee/ })).toHaveCount(2); // check + line
});

test('keeps the next item typed while the previous one is still saving', async ({
	page,
	person: _
}) => {
	await page.goto('/groceries');
	await page.route(
		(url) => url.search === '?/add',
		async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 600));
			await route.continue();
		}
	);
	await addItem(page, { name: 'Flour', quantity: '1', unit: 'bag' });
	const item = addForm(page).getByRole('combobox', { name: 'Item' });
	await item.fill('Sugar');
	await expect(group(page, 'No store').getByRole('button', { name: /^Flour/ })).toBeVisible();
	await expect(item).toHaveValue('Sugar');
	// The fields not touched since were cleared for the next item.
	await expect(addForm(page).getByLabel('Unit')).toHaveValue('');
});

test('asks for a store when checking off a line without one, and can undo', async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');
	await addItem(page, { name: 'Paper towels', quantity: '6', unit: 'rolls' });

	await group(page, 'No store').getByRole('button', { name: 'Mark received: Paper towels' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText("Paper towels doesn't have a store yet.");
	await dialog.getByRole('button', { name: 'Aldi' }).click();

	const aldi = group(page, 'Aldi');
	await expect(aldi.getByRole('heading', { name: 'Received today' })).toBeVisible();
	await aldi.getByRole('button', { name: 'Undo received: Paper towels' }).click();
	await expect(aldi.getByRole('button', { name: 'Mark received: Paper towels' })).toBeVisible();
	await expect(group(page, 'No store')).toHaveCount(0);
});

test('splits off what arrived when an order comes up short', async ({ page, db, person }) => {
	addStore(db, person.householdId, 'Walmart');
	await page.goto('/groceries');
	await addItem(page, { name: 'Yogurt', quantity: '3', unit: 'cups', store: 'Walmart' });
	const walmart = group(page, 'Walmart');

	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Mark ordered' }).click();
	await expect(walmart.getByRole('heading', { name: 'Ordered' })).toBeVisible();

	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Got fewer' }).click();
	await dialog.getByLabel('How many did you get?').fill('2');
	await dialog.getByRole('button', { name: 'Save' }).last().click();
	await expect(dialog).toHaveCount(0);

	await expect(walmart.getByRole('button', { name: /^Yogurt\s*1 cups/ })).toBeVisible();
	await expect(walmart.getByText('Received today')).toBeVisible();
	await expect(walmart.locator('.done')).toContainText('2 cups');
});

test("can't change another household's lines", async ({ page, db, person, baseURL }) => {
	const other = db
		.prepare(
			"insert into households (name, default_servings, time_zone, created_at) values ('Other', 2, 'UTC', 0)"
		)
		.run().lastInsertRowid;
	const item = db
		.prepare("insert into items (household_id, name, created_at) values (?, 'Secret', 0)")
		.run(other).lastInsertRowid;
	const line = db
		.prepare(
			"insert into grocery_needs (household_id, item_id, quantity, status, created_at) values (?, ?, 1, 'to_order', 0)"
		)
		.run(other, item).lastInsertRowid;

	await page.goto('/groceries');
	expect(person.householdId).not.toBe(other);
	const response = await page.request.post('/groceries?/delete', {
		form: { id: String(line) },
		headers: { origin: baseURL ?? '', 'x-sveltekit-action': 'true' }
	});
	expect(response.status()).toBe(404);
	expect(await response.json()).toMatchObject({ type: 'error' });
	expect(db.prepare('select count(*) from grocery_needs where id = ?').pluck().get(line)).toBe(1);
});

test('fills in the unit and store when the typed name matches an item', async ({
	page,
	db,
	person
}) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Chicken breast', quantity: '2', unit: 'lb', store: 'Aldi' });
	await group(page, 'Aldi').getByRole('button', { name: 'Mark received: Chicken breast' }).click();
	await expect(group(page, 'Aldi').getByRole('heading', { name: 'Received today' })).toBeVisible();
	await addAndWait(page, { name: 'Chips', quantity: '1', unit: 'bag' });

	const form = addForm(page);
	// Typing the whole name, without tapping a suggestion, is enough.
	await form.getByRole('combobox', { name: 'Item' }).fill('chicken breast');
	await expect(form.getByLabel('Unit')).toHaveValue('lb');
	await expect(form.getByLabel('Store')).toHaveValue(String(aldi));
	// Switching to another item replaces what was filled in automatically.
	await form.getByRole('combobox', { name: 'Item' }).fill('chips');
	await expect(form.getByLabel('Unit')).toHaveValue('bag');
	await expect(form.getByLabel('Store')).toHaveValue('usual');
	// A unit the person typed is kept.
	await form.getByLabel('Unit').fill('family size');
	await form.getByRole('combobox', { name: 'Item' }).fill('chicken breast');
	await expect(form.getByLabel('Unit')).toHaveValue('family size');
});

test('offers to add a name that matches no item as a new item', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Milk' });
	const item = addForm(page).getByRole('combobox', { name: 'Item' });
	// A partial name shows the matching item and the offer to add a new one.
	await item.fill('Mil');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
		'Milk',
		'Add “Mil” as a new item'
	]);
	// An exact name offers only the item.
	await item.fill('milk');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Milk']);
	await item.fill('Oat milk');
	await page.getByRole('option', { name: 'Add “Oat milk” as a new item' }).click();
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await expect(addForm(page).getByRole('combobox', { name: 'Item' })).toHaveValue('Oat milk');
});

test('shows a prompt error inside the prompt', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Coffee', quantity: '1', unit: 'bag' });
	await addItem(page, { name: 'Coffee', quantity: '1', unit: 'bag' });
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Quantity').fill('0');
	await dialog.getByRole('button', { name: 'Update' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('Enter a quantity above 0');
});

test('saves the sheet edits with Mark ordered, and starts fresh when reopened', async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Bread', quantity: '2', store: 'Aldi' });
	const aldi = group(page, 'Aldi');

	// Edits abandoned with the close button don't come back.
	await aldi.getByRole('button', { name: /^Bread/ }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByLabel('Quantity').fill('9');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await aldi.getByRole('button', { name: /^Bread/ }).click();
	dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Quantity')).toHaveValue('2');

	await dialog.getByLabel('Quantity').fill('5');
	await dialog.getByLabel('Unit').fill('loaves');
	await dialog.getByLabel('Note').fill('whole wheat');
	await dialog.getByRole('button', { name: 'Mark ordered' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(aldi.getByRole('button', { name: /^Bread\s*5 loaves\s*whole wheat/ })).toBeVisible();
	await expect(aldi.getByRole('heading', { name: 'Ordered' })).toBeVisible();
});

test('records Got fewer when Enter is pressed in the amount', async ({ page, db, person }) => {
	addStore(db, person.householdId, 'Walmart');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Yogurt', quantity: '3', unit: 'cups', store: 'Walmart' });
	const walmart = group(page, 'Walmart');
	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Got fewer' }).click();
	await dialog.getByLabel('How many did you get?').fill('2');
	await dialog.getByLabel('How many did you get?').press('Enter');
	await expect(dialog).toHaveCount(0);
	await expect(walmart.getByRole('heading', { name: 'Received today' })).toBeVisible();
	await expect(walmart.getByRole('button', { name: /^Yogurt\s*1 cups/ })).toBeVisible();
});

test('keeps working for a line whose store was archived', async ({ page, db, person }) => {
	const costco = addStore(db, person.householdId, 'Costco');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Bread', quantity: '2', store: 'Costco' });
	db.prepare('update stores set archived_at = 1 where id = ?').run(costco);
	await page.reload();

	const group_ = group(page, 'Costco');
	await group_.getByRole('button', { name: /^Bread/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Mark ordered' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(group_.getByRole('heading', { name: 'Ordered' })).toBeVisible();
});

test('shows a failed check-off next to its line and refreshes the list', async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Milk', store: 'Aldi' });
	// Someone else checks it off first.
	db.prepare(
		"update grocery_needs set status = 'received', received_at = ? where household_id = ?"
	).run(Date.now(), person.householdId);

	const aldi = group(page, 'Aldi');
	await aldi.getByRole('button', { name: 'Mark received: Milk' }).click();
	await expect(aldi.getByRole('alert')).toHaveText('This line was already received');
	await expect(aldi.getByRole('button', { name: 'Undo received: Milk' })).toBeVisible();
});

test('asks the duplicate question fresh each time, and clears an old add error', async ({
	page,
	person: _
}) => {
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Coffee', quantity: '1', unit: 'bag' });
	await addItem(page, { name: 'Coffee', quantity: '0', unit: 'bag' });
	await expect(addForm(page).getByRole('alert')).toHaveText('Enter a quantity above 0');

	await addForm(page).getByLabel('Quantity').fill('1');
	await addForm(page).getByRole('button', { name: 'Add' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Quantity')).toHaveValue('2');
	await dialog.getByLabel('Quantity').fill('7');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(addForm(page).getByRole('alert')).toHaveCount(0);

	// Asked again, the question shows its own suggestion, not the abandoned answer.
	await addForm(page).getByRole('button', { name: 'Add' }).click();
	await expect(dialog.getByLabel('Quantity')).toHaveValue('2');
});

test('says so when someone else deleted the line, and stays on the list', async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Aldi');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Milk', store: 'Aldi' });
	await addAndWait(page, { name: 'Eggs', store: 'Aldi' });
	const aldi = group(page, 'Aldi');
	await aldi.getByRole('button', { name: /^Milk/ }).click();
	db.prepare(
		"delete from grocery_needs where item_id = (select id from items where household_id = ? and name = 'Milk')"
	).run(person.householdId);

	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('This line is no longer on the list.');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(aldi.getByRole('button', { name: /^Milk/ })).toHaveCount(0);
	await expect(aldi.getByRole('button', { name: /^Eggs/ })).toBeVisible();
});

test("saves the sheet edits with Didn't come and Got fewer", async ({ page, db, person }) => {
	addStore(db, person.householdId, 'Walmart');
	await page.goto('/groceries');
	await addAndWait(page, { name: 'Yogurt', quantity: '3', unit: 'cups', store: 'Walmart' });
	const walmart = group(page, 'Walmart');
	const dialog = page.getByRole('dialog');
	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	await dialog.getByRole('button', { name: 'Mark ordered' }).click();
	await expect(walmart.getByRole('heading', { name: 'Ordered' })).toBeVisible();

	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	await dialog.getByLabel('Note').fill('vanilla');
	await dialog.getByRole('button', { name: "Didn't come" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(walmart.getByRole('heading', { name: 'Ordered' })).toHaveCount(0);
	await expect(walmart.getByRole('button', { name: /^Yogurt\s*3 cups\s*vanilla/ })).toBeVisible();

	await walmart.getByRole('button', { name: /^Yogurt/ }).click();
	await dialog.getByLabel('Quantity').fill('5');
	await dialog.getByRole('button', { name: 'Got fewer' }).click();
	await dialog.getByLabel('How many did you get?').fill('1');
	await dialog.getByRole('button', { name: 'Save' }).last().click();
	await expect(dialog).toHaveCount(0);
	await expect(walmart.getByRole('button', { name: /^Yogurt\s*4 cups\s*vanilla/ })).toBeVisible();
	await expect(walmart.locator('.done')).toContainText('1 cups');
});
