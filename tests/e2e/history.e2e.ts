import { addItem, addStore, dayLabel, expect, test, today } from './fixtures.ts';

test('shows the year on dates from earlier years', async ({ page, db, person }) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	const receive = (name: string, at: number) => {
		const item = addItem(db, person.householdId, name, { defaultStoreId: aldi });
		db.prepare(
			"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, 1, ?, 'received', ?, ?, ?)"
		).run(person.householdId, item, aldi, at, at, at);
	};
	receive('Bread', Date.now());
	// Noon on Sun, Oct 19, 2025 in Chicago, where the household is.
	receive('Milk', Date.UTC(2025, 9, 19, 17, 0));

	await page.goto('/groceries/history');
	await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
		dayLabel(today()),
		'Sun, Oct 19, 2025'
	]);
});
