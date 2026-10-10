import {
	addDays,
	addDinner,
	addItem,
	addPhotoFiles,
	addRecipe,
	addStore,
	makeJpeg,
	sundayOf,
	test,
	today,
	type DinnerSeed
} from './fixtures.ts';

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
	await page.getByText('More', { exact: true }).click();
	await shot('more');
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

// The menu screens, in the light theme: the week, a dinner, Copy a dinner and a pantry check from
// the menu.
test('menu screens', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	addItem(db, person.householdId, 'Butter', { defaultStoreId: aldi });
	addItem(db, person.householdId, 'Salt', { alwaysHave: true });
	const recipe = (
		name: string,
		servings: number,
		ingredients: Parameters<typeof addRecipe>[2]['ingredients'] = []
	) => addRecipe(db, person.householdId, { name, servings, ingredients });
	const chicken = recipe('Roast chicken', 4, [
		{ item: 'Whole chicken', amount: 1 },
		{ item: 'Butter', amount: 2, unit: 'tbsp' },
		{ item: 'Lemons', amount: 1 },
		{ item: 'Salt' }
	]);
	const mash = recipe('Mashed potatoes', 4, [
		{ item: 'Potatoes', amount: 2, unit: 'lb' },
		{ item: 'Butter', amount: 4, unit: 'tbsp' },
		{ item: 'Milk', amount: 0.5, unit: 'cup' }
	]);
	const beans = recipe('Green beans', 4, [{ item: 'Green beans', amount: 1, unit: 'lb' }]);
	const tacos = recipe('Chicken tacos', 4, [
		{ item: 'Chicken thighs', amount: 1.5, unit: 'lb' },
		{ item: 'Tortillas', amount: 8 },
		{ item: 'Salsa', amount: 1, unit: 'cup' }
	]);
	const rice = recipe('Rice', 4);
	const potatoSalad = recipe('Potato salad', 8, [
		{ item: 'Potatoes', amount: 3, unit: 'lb' },
		{ item: 'Eggs', amount: 4 },
		{ item: 'Mayonnaise', amount: 1, unit: 'cup' }
	]);
	const lasagna = recipe('Lasagna', 8, [
		{ item: 'Lasagna noodles', amount: 1, unit: 'box' },
		{ item: 'Ricotta', amount: 15, unit: 'oz' },
		{ item: 'Mozzarella', amount: 1, unit: 'lb' },
		{ item: 'Marinara', amount: 3, unit: 'cup' }
	]);
	const caesar = recipe('Caesar salad', 4, [{ item: 'Romaine', amount: 2, unit: 'heads' }]);
	const bread = recipe('Garlic bread', 6, [
		{ item: 'Baguette', amount: 1 },
		{ item: 'Butter', amount: 4, unit: 'tbsp' }
	]);
	const cake = recipe('Pound cake', 8, [
		{ item: 'Flour', amount: 2, unit: 'cup' },
		{ item: 'Butter', amount: 1, unit: 'cup' },
		{ item: 'Sugar', amount: 1.5, unit: 'cup' },
		{ item: 'Eggs', amount: 4 }
	]);

	// A dinner for each weekday but Saturday, from this week's Sunday through the next 7 days.
	const byWeekday: (DinnerSeed | null)[] = [
		{
			servings: 6,
			note: 'Grandparents over',
			dishes: [
				[chicken, 'main'],
				[mash, 'side'],
				[beans, 'side']
			]
		},
		{ type: 'leftovers', note: 'Roast chicken' },
		{
			dishes: [
				[tacos, 'main'],
				[rice, 'side']
			]
		},
		{ type: 'eat_out', note: 'Thai place on 5th' },
		{ type: 'going', servings: 8, note: 'Potluck at the Smiths', dishes: [[potatoSalad, 'main']] },
		{
			servings: 6,
			note: 'Movie night',
			dishes: [
				[lasagna, 'main'],
				[caesar, 'side'],
				[bread, 'side'],
				[cake, 'dessert']
			]
		},
		null
	];
	const sunday = sundayOf(today());
	for (let date = sunday; date <= addDays(today(), 6); date = addDays(date, 1)) {
		const seed = byWeekday[new Date(`${date}T00:00:00Z`).getUTCDay()];
		if (seed) addDinner(db, person.householdId, date, seed);
	}
	// Past dinners to copy.
	for (const weeksAgo of [1, 2, 3]) {
		addDinner(db, person.householdId, addDays(sunday, -7 * weeksAgo + 2), {
			dishes: [
				[tacos, 'main'],
				[rice, 'side']
			]
		});
	}
	addDinner(db, person.householdId, addDays(sunday, -9), {
		dishes: [
			[lasagna, 'main'],
			[caesar, 'side']
		]
	});

	// A full-page shot draws the fixed tab bar over the middle of a long page, where it hides the
	// dinner's servings. A viewport as tall as the page puts it at the foot instead.
	const shot = async (name: string) => {
		const phone = page.viewportSize();
		const height = await page.evaluate(() => document.documentElement.scrollHeight);
		if (phone) await page.setViewportSize({ width: phone.width, height });
		await page.screenshot({ path: `test-results/screens/${name}.png` });
		if (phone) await page.setViewportSize(phone);
	};

	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/menu');
	await shot('menu');
	await page.goto(`/menu/${addDays(sunday, 5)}`);
	await shot('dinner');
	// A sheet as a phone shows it, over the screen, once it has slid up.
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	await page.getByRole('dialog', { name: 'Copy a dinner' }).getByRole('listitem').first().waitFor();
	await page.screenshot({ path: 'test-results/screens/copy-dinner.png', animations: 'disabled' });
	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Start check' }).click();
	await page.getByRole('button', { name: 'Have Milk' }).click();
	await page.getByRole('button', { name: 'Need Butter' }).click();
	await page.getByRole('button', { name: 'Undo Need for Butter' }).waitFor();
	await shot('menu-pantry');
});
