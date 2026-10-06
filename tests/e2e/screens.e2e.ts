import { addItem, addPhotoFiles, addRecipe, addStore, makeJpeg, test } from './fixtures.ts';

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
	await page.getByRole('combobox', { name: 'Item' }).fill('Mi');
	await shot('suggestions');
	await page.getByRole('combobox', { name: 'Item' }).fill('');
	await page.getByRole('button', { name: /^Dog food/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Got fewer' }).click();
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

// The same for the recipe screens, in the light theme.
test('recipe screens', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Flour', { defaultStoreId: aldi });
	addItem(db, person.householdId, 'Salt', { alwaysHave: true });
	const photo = (hue: number) =>
		Promise.all([
			makeJpeg(page, { width: 1600, height: 1200, hue }),
			makeJpeg(page, { width: 400, height: 300, hue })
		]).then(([full, thumb]) => addPhotoFiles(full, thumb));

	const cakeId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		servings: 8,
		prepMinutes: 20,
		cookMinutes: 70,
		tags: ['Dessert', 'Baking'],
		photoKey: await photo(30),
		steps: [
			'Heat the oven to 325°F and butter a loaf pan.',
			'Cream the butter and sugar until light, about 5 minutes.',
			'Beat in the eggs one at a time, then 1 tsp of vanilla.',
			'Fold in the flour and salt.',
			'Bake for 60 to 70 minutes, until a skewer comes out clean.',
			'Whisk the glaze and pour it over the warm cake.'
		].join('\n'),
		notes: 'Keeps for a week, wrapped.\nFreezes well.',
		ingredients: [
			{ item: 'Butter', amount: 1, unit: 'cup', prepNote: 'softened' },
			{ item: 'Sugar', amount: 1.5, unit: 'cup' },
			{ item: 'Eggs', amount: 4, prepNote: 'room temperature' },
			{ item: 'Vanilla', amount: 1, unit: 'tsp' },
			{ item: 'Flour', amount: 2, unit: 'cup', prepNote: 'sifted' },
			{ item: 'Salt' },
			{ item: 'Powdered sugar', amount: 1, unit: 'cup', section: 'For the glaze' },
			{ item: 'Lemon juice', amount: 2, unit: 'tbsp', section: 'For the glaze' }
		]
	});
	db.prepare(
		'update dishes set source = ?, calories = 420, protein_g = 5, carbs_g = 52, fat_g = 21 where id = ?'
	).run('https://example.com/pound-cake', cakeId);
	addRecipe(db, person.householdId, {
		name: 'Chicken tacos',
		cookMinutes: 30,
		tags: ['Dinner', 'Quick'],
		photoKey: await photo(100),
		ingredients: [
			{ item: 'Chicken thighs', amount: 1.5, unit: 'lb' },
			{ item: 'Tortillas', amount: 8 }
		]
	});
	addRecipe(db, person.householdId, { name: 'Grandma’s chili', tags: ['Dinner'] });
	addRecipe(db, person.householdId, {
		name: 'Lemon bars',
		prepMinutes: 15,
		cookMinutes: 45,
		tags: ['Dessert'],
		steps: 'Mix.\nBake.'
	});
	// Butter is on the list already.
	const butter = addItem(db, person.householdId, 'Butter');
	db.prepare(
		"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at) values (?, ?, 1, ?, 'ordered', ?, ?)"
	).run(person.householdId, butter, aldi, Date.now(), Date.now());

	const shot = (name: string) =>
		page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/recipes');
	await shot('recipes');
	await page.goto(`/recipes/${cakeId}?servings=12`);
	await shot('recipe');
	await page.goto(`/recipes/${cakeId}/edit`);
	await shot('recipe-editor');
	await page.goto(`/recipes/${cakeId}/cook?servings=12`);
	await page.getByRole('checkbox', { name: /Butter, softened/ }).tap();
	await page.getByRole('checkbox', { name: /^1\. Heat the oven/ }).tap();
	await shot('cooking');
	await page.goto(`/recipes/${cakeId}?servings=12`);
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('button', { name: 'Have Sugar' }).click();
	await page.getByRole('button', { name: 'Need Flour' }).click();
	await page.getByRole('button', { name: 'Undo Need for Flour' }).waitFor();
	await shot('pantry');
});
