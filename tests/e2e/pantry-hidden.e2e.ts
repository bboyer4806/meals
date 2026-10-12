import { addDays, addDinner, addItem, addRecipe, expect, test, today } from './fixtures.ts';

// The pantry check is hidden for now (design 6.8): nothing leads to it, its page and actions
// are gone, and a check already started stays stored as it was.
test('has no way to reach the pantry check, and keeps a check already started', async ({
	page,
	db,
	baseURL,
	person
}) => {
	const cake = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		ingredients: [
			{ item: 'Butter', amount: 1, unit: 'cup' },
			{ item: 'Sugar', amount: 2, unit: 'cup' }
		]
	});
	addDinner(db, person.householdId, addDays(today(), 1), { dishes: [[cake, 'dessert']] });
	const butter = addItem(db, person.householdId, 'Butter');
	const sugar = addItem(db, person.householdId, 'Sugar');
	const checklist = Number(
		db
			.prepare(
				'insert into pantry_checklists (household_id, dish_id, servings, created_at) values (?, ?, 4, ?)'
			)
			.run(person.householdId, cake, Date.now()).lastInsertRowid
	);
	db.prepare(
		"insert into pantry_marks (household_id, checklist_id, item_id, state) values (?, ?, ?, 'have')"
	).run(person.householdId, checklist, butter);
	const stored = () => ({
		checklists: db
			.prepare('select id, dish_id, servings from pantry_checklists where household_id = ?')
			.all(person.householdId),
		marks: db
			.prepare('select item_id, state from pantry_marks where household_id = ?')
			.all(person.householdId),
		lines: db
			.prepare('select count(*) from grocery_needs where household_id = ?')
			.pluck()
			.get(person.householdId)
	});
	const before = stored();
	expect(before).toEqual({
		checklists: [{ id: checklist, dish_id: cake, servings: 4 }],
		marks: [{ item_id: butter, state: 'have' }],
		lines: 0
	});

	const response = await page.goto('/pantry');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();

	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const forms: Record<string, Record<string, string>> = {
		start: { dishId: String(cake), servings: '8', replaceChecked: '1' },
		startMenu: { startDate: today(), endDate: addDays(today(), 6), replaceChecked: '1' },
		have: { itemId: String(sugar) },
		need: { itemId: String(sugar) },
		undo: { itemId: String(butter) }
	};
	for (const [action, form] of Object.entries(forms)) {
		const posted = await page.request.post(`/pantry?/${action}`, { form, headers });
		expect(posted.status(), action).toBe(404);
	}
	expect(stored()).toEqual(before);

	// No entry on the week, in the More menu or on a recipe.
	await page.goto('/menu');
	await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
	await expect(page.getByText(/pantry/i)).toHaveCount(0);
	await page.getByText('More', { exact: true }).click();
	await expect(page.getByRole('navigation', { name: 'More' }).getByRole('link')).toHaveText([
		'Items',
		'History',
		'Household'
	]);
	await page.goto(`/recipes/${cake}`);
	await expect(page.getByRole('heading', { name: 'Pound cake' })).toBeVisible();
	await expect(page.getByText(/pantry/i)).toHaveCount(0);
});
