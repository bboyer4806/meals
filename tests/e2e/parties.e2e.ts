import type { Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import { addItem, addPartyList, addPerson, addStore, expect, open, test } from './fixtures.ts';

// Party lists (design 6.15) and how they keep the grocery list in step.

function group(page: Page, name: string) {
	return page.locator('details', { has: page.getByRole('heading', { name, exact: true }) });
}

/** A thing's row on its party list. */
function row(page: Page, itemName: string) {
	return page.getByRole('listitem').filter({ hasText: itemName });
}

/** A line on the grocery list, To Order at the store, which becomes the item's usual store. */
function addLine(
	db: Database.Database,
	householdId: number,
	item: string,
	quantity: number,
	unit: string | null,
	storeId: number
) {
	const itemId = addItem(db, householdId, item, { defaultStoreId: storeId });
	db.prepare(
		`insert into grocery_needs (household_id, item_id, quantity, unit, store_id, status, created_at)
		values (?, ?, ?, ?, ?, 'to_order', ?)`
	).run(householdId, itemId, quantity, unit, storeId, Date.now());
}

/** Puts a thing on the grocery list from its party list, and waits for the list to say so. */
async function addToGroceries(page: Page, itemName: string) {
	await page.getByRole('button', { name: `Add to Groceries: ${itemName}` }).click();
	await expect(row(page, itemName)).toContainText('On Groceries');
}

test('starts a list from Groceries and puts its things on lines that match', async ({
	page,
	db,
	person
}) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addLine(db, person.householdId, 'Chips', 1, 'bags', walmart);
	await open(page, '/groceries');
	await page.getByRole('link', { name: 'Party lists' }).click();
	await expect(page.getByRole('heading', { name: 'Party lists' })).toBeVisible();
	await expect(page.getByText('No party lists yet.')).toBeVisible();
	await page.getByLabel('Name').fill('Birthday party');
	await page.getByRole('button', { name: 'New list' }).click();
	await expect(page.getByRole('heading', { name: 'Birthday party' })).toBeVisible();

	const add = page.getByRole('form', { name: 'Add to the party list' });
	for (const [name, quantity, unit] of [
		['Chips', '3', 'bags'],
		['Candles', '12', '']
	] as const) {
		await add.getByRole('combobox', { name: 'Item' }).fill(name);
		await add.getByLabel('Quantity').fill(quantity);
		await add.getByLabel('Unit').fill(unit);
		await add.getByRole('button', { name: 'Add' }).click();
		await expect(add.getByRole('combobox', { name: 'Item' })).toHaveValue('');
	}
	await expect(page.getByRole('button', { name: /^Chips\s*3 bags/ })).toBeVisible();

	await addToGroceries(page, 'Chips');
	await page.getByRole('button', { name: 'Add all to Groceries' }).click();
	await expect(page.getByRole('dialog')).toContainText('Add 1 item to Groceries?');
	await page.getByRole('dialog').getByRole('button', { name: 'Add to Groceries' }).click();
	await expect(page.getByText('Added 1 item to Groceries.')).toBeVisible();
	await expect(row(page, 'Candles')).toContainText('On Groceries');
	await expect(page.getByRole('button', { name: 'Add all to Groceries' })).toHaveCount(0);

	await page.getByRole('link', { name: '‹ Party lists' }).click();
	await expect(page.getByRole('link', { name: /^Birthday party\s*0 of 2 bought$/ })).toBeVisible();

	// The party's 3 bags joined the household's 1, and the candles have a line of their own.
	await open(page, '/groceries');
	await expect(group(page, 'Walmart').getByRole('button', { name: /^Chips\s*4 bags/ })).toBeVisible();
	await expect(group(page, 'No store').getByRole('button', { name: /^Candles\s*12/ })).toBeVisible();
});

test('a thing checked off on Groceries is checked off on its list, and unchecking it puts it back', async ({
	page,
	db,
	person
}) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addItem(db, person.householdId, 'Soda', { defaultStoreId: walmart });
	const listId = addPartyList(db, person.householdId, 'Picnic', [
		{ item: 'Soda', quantity: 6, unit: 'cans' }
	]);
	await open(page, `/groceries/parties/${listId}`);
	await addToGroceries(page, 'Soda');

	await open(page, '/groceries');
	await group(page, 'Walmart').getByRole('button', { name: 'Mark received: Soda' }).click();
	await expect(group(page, 'Walmart').getByRole('button', { name: 'Undo received: Soda' })).toBeVisible();

	await open(page, `/groceries/parties/${listId}`);
	await expect(row(page, 'Soda')).toContainText('Bought');
	await page.getByRole('button', { name: 'Undo bought: Soda' }).click();
	await expect(page.getByRole('button', { name: 'Mark bought: Soda' })).toBeVisible();
	await expect(row(page, 'Soda')).toContainText('On Groceries');

	await open(page, '/groceries');
	await expect(group(page, 'Walmart').getByRole('button', { name: 'Mark received: Soda' })).toBeVisible();
	await expect(group(page, 'Walmart').getByText('Received today')).toHaveCount(0);
});

test('checking off on its list receives only its part of the grocery line', async ({
	page,
	db,
	person
}) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addLine(db, person.householdId, 'Chips', 1, 'bags', walmart);
	const listId = addPartyList(db, person.householdId, 'Game night', [
		{ item: 'Chips', quantity: 2, unit: 'bags' }
	]);
	await open(page, `/groceries/parties/${listId}`);
	await addToGroceries(page, 'Chips');
	await page.getByRole('button', { name: 'Mark bought: Chips' }).click();
	await expect(page.getByRole('button', { name: 'Undo bought: Chips' })).toBeVisible();

	await open(page, '/groceries');
	const walmartGroup = group(page, 'Walmart');
	await expect(walmartGroup.getByRole('button', { name: /^Chips\s*1 bags/ })).toBeVisible();
	await expect(walmartGroup.locator('.done')).toContainText('2 bags');
});

test('asks where it was bought when its grocery line has no store', async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Aldi');
	const listId = addPartyList(db, person.householdId, 'Birthday', [
		{ item: 'Candles', quantity: 12 }
	]);
	await open(page, `/groceries/parties/${listId}`);
	await addToGroceries(page, 'Candles');
	await page.getByRole('button', { name: 'Mark bought: Candles' }).click();
	const dialog = page.getByRole('dialog', { name: 'Where did you get it?' });
	await expect(dialog).toContainText('Candles is on Groceries without a store.');
	await dialog.getByRole('button', { name: 'Aldi' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('button', { name: 'Undo bought: Candles' })).toBeVisible();

	await open(page, '/groceries');
	await expect(group(page, 'Aldi').getByRole('heading', { name: 'Received today' })).toBeVisible();
});

test('a short order on Groceries goes to the party first', async ({ page, db, person }) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addLine(db, person.householdId, 'Chips', 1, 'bags', walmart);
	const listId = addPartyList(db, person.householdId, 'Birthday', [
		{ item: 'Chips', quantity: 3, unit: 'bags' }
	]);
	await open(page, `/groceries/parties/${listId}`);
	await addToGroceries(page, 'Chips');

	await open(page, '/groceries');
	await group(page, 'Walmart').getByRole('button', { name: /^Chips\s*4 bags/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Chips' });
	await sheet.getByRole('button', { name: 'Got fewer' }).click();
	await sheet.getByLabel('How many did you get?').fill('2');
	await sheet.getByRole('button', { name: 'Save received' }).click();
	await expect(sheet).toBeHidden();

	await open(page, `/groceries/parties/${listId}`);
	await expect(row(page, 'Chips')).toContainText('Bought 2 of 3 bags · On Groceries');
	await expect(page.getByRole('button', { name: 'Mark bought: Chips' })).toBeVisible();
});

test('changing how much a party needs changes the grocery list, and removing a thing takes it off', async ({
	page,
	db,
	person
}) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addItem(db, person.householdId, 'Ice', { defaultStoreId: walmart });
	const listId = addPartyList(db, person.householdId, 'Cookout', [
		{ item: 'Ice', quantity: 2, unit: 'bags' }
	]);
	await open(page, `/groceries/parties/${listId}`);
	await addToGroceries(page, 'Ice');

	await page.getByRole('button', { name: /^Ice\s*2 bags/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Ice' });
	await expect(sheet).toContainText("What's on Groceries for it changes to match.");
	await sheet.getByLabel('How much the party needs').fill('5');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('button', { name: /^Ice\s*5 bags/ })).toBeVisible();

	await open(page, '/groceries');
	await expect(group(page, 'Walmart').getByRole('button', { name: /^Ice\s*5 bags/ })).toBeVisible();

	await open(page, `/groceries/parties/${listId}`);
	await page.getByRole('button', { name: /^Ice\s*5 bags/ }).click();
	await sheet.getByRole('button', { name: 'Remove' }).click();
	const ask = page.getByRole('dialog', { name: 'Remove' });
	await expect(ask).toContainText('Take Ice off Cookout? It comes off Groceries too.');
	await ask.getByRole('button', { name: 'Remove' }).click();
	await expect(page.getByText('Nothing on this list yet.')).toBeVisible();

	await open(page, '/groceries');
	await expect(group(page, 'Walmart')).toHaveCount(0);
});

test('renames a list, keeping names unique, and deletes it after asking', async ({
	page,
	db,
	person
}) => {
	addPartyList(db, person.householdId, 'Picnic');
	const listId = addPartyList(db, person.householdId, 'Birthday');
	await open(page, `/groceries/parties/${listId}`);

	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Edit party list' });
	await sheet.getByLabel('Name').fill('picnic');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toHaveText('You already have a party list called picnic.');
	await sheet.getByLabel('Name').fill('Birthday party');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Birthday party' })).toBeVisible();

	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await sheet.getByRole('button', { name: 'Delete list' }).click();
	const ask = page.getByRole('dialog', { name: 'Delete list' });
	await expect(ask).toContainText('Delete Birthday party?');
	await ask.getByRole('button', { name: 'Delete list' }).click();
	await expect(page).toHaveURL(/\/groceries\/parties$/);
	await expect(page.getByRole('link', { name: /^Picnic/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /^Birthday party/ })).toHaveCount(0);
});

test("can't open or change another household's list", async ({
	page,
	db,
	person: _signedIn,
	baseURL
}) => {
	const other = addPerson(db);
	const listId = addPartyList(db, other.householdId, 'Secret', [{ item: 'Cake', quantity: 1 }]);
	const response = await page.goto(`/groceries/parties/${listId}`);
	expect(response?.status()).toBe(404);
	const post = await page.request.post(`/groceries/parties/${listId}?/delete`, {
		form: { confirm: '1' },
		headers: { origin: baseURL ?? '', 'x-sveltekit-action': 'true' }
	});
	expect(post.status()).toBe(404);
	expect(db.prepare('select count(*) from party_lists where id = ?').pluck().get(listId)).toBe(1);
});
