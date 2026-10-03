import { addStore, test } from './fixtures.ts';

// Saves screenshots of the main screens for a visual review. Not a check.
test('screens', async ({ page, db, person }) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	addStore(db, person.householdId, 'Aldi');
	const now = Date.now();
	const add = db.prepare(
		'insert into items (household_id, name, notes, default_store_id, created_at) values (?, ?, ?, ?, ?)'
	);
	const line = db.prepare(
		'insert into grocery_needs (household_id, item_id, quantity, unit, store_id, status, created_at, ordered_at, received_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	const rows: [string, string | null, number, string | null, number | null, string][] = [
		['Milk', null, 2, 'gal', walmart, 'to_order'],
		['Dog food', 'Purina Pro Plan, 30 lb', 1, 'bag', walmart, 'to_order'],
		['Bananas', null, 1, 'bunch', walmart, 'ordered'],
		['Paper towels', null, 6, 'rolls', null, 'to_order'],
		['Eggs', null, 1, 'dozen', walmart, 'received']
	];
	for (const [name, notes, quantity, unit, store, status] of rows) {
		const itemId = add.run(person.householdId, name, notes, store, now).lastInsertRowid;
		line.run(
			person.householdId,
			itemId,
			quantity,
			unit,
			store,
			status,
			now,
			status === 'to_order' ? null : now,
			status === 'received' ? now : null
		);
	}

	const shot = (name: string) =>
		page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

	await page.goto('/groceries');
	await shot('groceries');
	await page.emulateMedia({ colorScheme: 'dark' });
	await shot('groceries-dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await page.getByRole('button', { name: /^Dog food/ }).click();
	await shot('edit-sheet');
	await page.keyboard.press('Escape');
	await page.getByText('Menu', { exact: true }).click();
	await shot('menu');
	await page.goto('/groceries/items');
	await shot('items');
	await page.goto('/groceries/history');
	await shot('history');
	await page.goto('/household');
	await shot('household');
	await page.context().clearCookies();
	await page.goto('/login');
	await shot('login');
});
