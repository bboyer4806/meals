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
