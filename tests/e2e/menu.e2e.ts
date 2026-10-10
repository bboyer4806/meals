import type { Dialog, Page } from '@playwright/test';
import {
	addDays,
	addDinner,
	addPerson,
	addRecipe,
	dayLabel,
	expect,
	monthDay,
	sundayOf,
	test,
	today,
	weekday
} from './fixtures.ts';
import type Database from 'better-sqlite3';

// The menu (design 6.9 and 7, Menu and Dinner). Dates are worked out from today in the test
// household's time zone, so the tests pass on any day of the week.

/** A day's row in the week view. */
function day(page: Page, date: string) {
	return page.locator(`a.day[href="/menu/${date}"]`);
}

/** "Oct 4 to Oct 10", with the year when it isn't this year's or the week crosses into a new one. */
function weekRange(start: string): string {
	const end = addDays(start, 6);
	const year = (date: string) => date.slice(0, 4);
	if (year(start) !== year(end)) {
		return `${monthDay(start)}, ${year(start)} to ${monthDay(end)}, ${year(end)}`;
	}
	const range = `${monthDay(start)} to ${monthDay(end)}`;
	return year(end) === year(today()) ? range : `${range}, ${year(end)}`;
}

function types(page: Page) {
	return page.getByRole('form', { name: 'Type' });
}

function typeButton(page: Page, label: string) {
	return types(page).getByRole('button', { name: label, exact: true });
}

function dishSection(page: Page) {
	return page.getByRole('region', { name: 'Dishes' });
}

/** The dinner's dishes, in the order the page lists them. */
function dishLinks(page: Page) {
	return dishSection(page).getByRole('list').getByRole('link');
}

const dishField = (page: Page) => page.getByRole('combobox', { name: 'Add a dish' });
const newRole = (page: Page) => page.getByLabel('Role', { exact: true });
const addButton = (page: Page) => page.getByRole('button', { name: 'Add', exact: true });

/** Adds a dish the way a person would: types, taps a suggestion or "new dish", then Add. */
async function addDish(
	page: Page,
	typed: string,
	pick: { suggestion: string } | 'new',
	role?: 'main' | 'side' | 'dessert' | 'other'
) {
	await dishField(page).fill(typed);
	const option =
		pick === 'new'
			? page.getByRole('option', { name: `Add “${typed}” as a new dish` })
			: page.getByRole('option', { name: pick.suggestion, exact: true });
	await option.click();
	if (role) await newRole(page).selectOption(role);
	await addButton(page).click();
}

/** "Tue, Oct 7", with the year when it isn't this year's, as Copy a dinner says when one was made. */
function madeOn(date: string): string {
	const year = date.slice(0, 4);
	return year === today().slice(0, 4) ? dayLabel(date) : `${dayLabel(date)}, ${year}`;
}

function dinnerRow(db: Database.Database, householdId: number, date: string) {
	return db
		.prepare('select id, type, note, servings from dinners where household_id = ? and date = ?')
		.get(householdId, date) as
		| { id: number; type: string; note: string | null; servings: number }
		| undefined;
}

function dinnerDishes(db: Database.Database, dinnerId: number) {
	return db
		.prepare(
			'select dishes.name, dinner_dishes.role from dinner_dishes join dishes on dishes.id = dinner_dishes.dish_id where dinner_id = ? order by dinner_dishes.id'
		)
		.all(dinnerId);
}

/**
 * Someone else in the household moves one dinner onto the other's date, so the two swap, as
 * Move to another date does.
 */
function swap(db: Database.Database, dinnerId: number, otherId: number) {
	const dateOf = (id: number) =>
		db.prepare('select date from dinners where id = ?').pluck().get(id) as string;
	const [date, otherDate] = [dateOf(dinnerId), dateOf(otherId)];
	db.transaction(() => {
		db.prepare("update dinners set date = 'moving' where id = ?").run(dinnerId);
		db.prepare('update dinners set date = ? where id = ?').run(date, otherId);
		db.prepare('update dinners set date = ? where id = ?').run(otherDate, dinnerId);
	})();
}

/** Coming back to the app, which reloads the page's data (Q11). */
async function comeBack(page: Page) {
	const reloaded = page.waitForResponse((response) => response.url().includes('/__data.json'));
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await reloaded;
}

/** How far the page scrolls sideways, which on a phone means it doesn't fit the screen. */
function sideways(page: Page) {
	return page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
}

const LEAVE = 'Leave without saving? What you typed will be lost.';
const CHANGED = 'Someone changed this dinner since you opened it.';

test('plans a week with all four dinner types, with dishes and roles', async ({
	page,
	db,
	person
}) => {
	const tacosId = addRecipe(db, person.householdId, {
		name: 'Chicken tacos',
		ingredients: [{ item: 'Tortillas', amount: 8 }]
	});
	addRecipe(db, person.householdId, { name: 'Rice' });
	const now = today();
	const sunday = sundayOf(now);
	const week = Array.from({ length: 7 }, (_, index) => addDays(sunday, index));
	const [sun, mon, tue, wed] = week as [string, string, string, string];

	// The Menu tab opens this week, with nothing planned yet and today highlighted.
	await page.goto('/groceries');
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Menu' }).click();
	await expect(page).toHaveURL(/\/menu$/);
	await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
	const weeks = page.getByRole('navigation', { name: 'Weeks' });
	await expect(weeks.locator('.label')).toHaveText(weekRange(sunday));
	await expect(weeks.getByRole('link', { name: 'This week' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.locator('a.day .date')).toHaveText(week.map(dayLabel));
	for (const date of week) await expect(day(page, date)).toContainText('Not planned');
	await expect(page.locator('a.day[aria-current="date"]')).toHaveAttribute('href', `/menu/${now}`);
	await expect(day(page, now).locator('.today-badge')).toHaveText('Today');
	await expect(page.getByText('Today', { exact: true })).toHaveCount(1);

	// Sunday: Cooking at home, with dishes found by searching and typed as new names.
	await day(page, sun).click();
	await expect(page).toHaveURL(new RegExp(`/menu/${sun}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		new RegExp(`^Sunday, ${monthDay(sun)}`)
	);
	await expect(
		page.getByText('Not planned yet. Pick a type, add a dish or copy a dinner.')
	).toBeVisible();
	await expect(types(page).getByRole('button', { pressed: true })).toHaveCount(0);
	await expect(dishSection(page).getByText('No dishes yet.')).toBeVisible();
	// The first dish is a Main.
	await expect(newRole(page)).toHaveValue('main');
	await addDish(page, 'taco', { suggestion: 'Chicken tacos' });
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	// Adding it planned the date as Cooking at home, at the household's usual servings.
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('4');
	await expect(page.getByLabel('Role for Chicken tacos')).toHaveValue('main');
	await expect(page.getByText('Not planned yet.', { exact: false })).toHaveCount(0);
	// The field is ready for the next dish, which starts as a Side.
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();
	await expect(newRole(page)).toHaveValue('side');

	await addDish(page, 'Garlic bread', 'new');
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Garlic bread']);
	await expect(page.getByLabel('Role for Garlic bread')).toHaveValue('side');
	// A dish made by name has the usual servings and no recipe yet.
	expect(
		db
			.prepare(
				"select servings, (select count(*) from dish_ingredients where dish_id = dishes.id) as ingredients from dishes where household_id = ? and name = 'Garlic bread'"
			)
			.get(person.householdId)
	).toEqual({ servings: 4, ingredients: 0 });

	// A dish already on the dinner isn't added twice.
	await dishField(page).fill('chicken');
	await page.getByRole('option', { name: 'Chicken tacos', exact: true }).click();
	await addButton(page).click();
	await expect(dishSection(page).getByRole('alert')).toHaveText(
		'Chicken tacos is already on this dinner'
	);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Garlic bread']);

	// A role picked before adding, then the default again.
	await addDish(page, 'Apple pie', 'new', 'dessert');
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Garlic bread', 'Apple pie']);
	await expect(newRole(page)).toHaveValue('side');
	await addDish(page, 'ric', { suggestion: 'Rice' });
	await addDish(page, 'Sweet corn', 'new');
	// Listed Main, Side, Dessert, Other, each role in the order added.
	await expect(dishLinks(page)).toHaveText([
		'Chicken tacos',
		'Garlic bread',
		'Rice',
		'Sweet corn',
		'Apple pie'
	]);

	// Changing a role moves the dish to its place.
	await page.getByLabel('Role for Sweet corn').selectOption('other');
	await expect(dishLinks(page)).toHaveText([
		'Chicken tacos',
		'Garlic bread',
		'Rice',
		'Apple pie',
		'Sweet corn'
	]);
	await expect(page.getByLabel('Role for Sweet corn')).toHaveValue('other');

	// Removing a dish takes it off the dinner, not out of the recipes.
	await page.getByRole('button', { name: 'Remove Sweet corn' }).click();
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Garlic bread', 'Rice', 'Apple pie']);
	expect(
		db
			.prepare("select count(*) from dishes where household_id = ? and name = 'Sweet corn'")
			.pluck()
			.get(person.householdId)
	).toBe(1);

	// Servings and a note.
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('6');
	await page.getByLabel('Note', { exact: true }).fill('Birthday dinner');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');
	await expect(dishLinks(page).first()).toHaveAttribute('href', `/recipes/${tacosId}?servings=6`);
	const sunDinner = dinnerRow(db, person.householdId, sun);
	expect(sunDinner).toMatchObject({ type: 'cook', note: 'Birthday dinner', servings: 6 });
	expect(dinnerDishes(db, sunDinner?.id ?? 0)).toEqual([
		{ name: 'Chicken tacos', role: 'main' },
		{ name: 'Garlic bread', role: 'side' },
		{ name: 'Apple pie', role: 'dessert' },
		{ name: 'Rice', role: 'side' }
	]);

	// Monday: Eating out, which has a note but no dishes or servings.
	const backToWeek = page.getByRole('link', { name: `‹ Week of ${monthDay(sunday)}` });
	await backToWeek.click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sunday}$`));
	await day(page, mon).click();
	await typeButton(page, 'Eating out').click();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByLabel('Servings', { exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Note', { exact: true })).toHaveAttribute(
		'placeholder',
		'Where to go'
	);
	await page.getByLabel('Note', { exact: true }).fill('Pizza at Mario’s');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');

	// Tuesday: Going somewhere, with a dish to bring.
	await backToWeek.click();
	await day(page, tue).click();
	await typeButton(page, 'Going somewhere').click();
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('4');
	await addDish(page, 'Potato salad', 'new');
	await expect(dishLinks(page)).toHaveText(['Potato salad']);
	await expect(page.getByLabel('Role for Potato salad')).toHaveValue('main');
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await page.getByLabel('Note', { exact: true }).fill('Picnic at the lake');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');

	// Wednesday: Leftovers.
	await backToWeek.click();
	await day(page, wed).click();
	await typeButton(page, 'Leftovers').click();
	await expect(typeButton(page, 'Leftovers')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await page.getByLabel('Note', { exact: true }).fill('Tacos from Sunday');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');

	// The week shows each day's type, its dishes by role and its note.
	await backToWeek.click();
	await expect(day(page, sun).locator('.type')).toHaveText('Cooking at home');
	await expect(day(page, sun).locator('.role')).toHaveText(['Main', 'Side', 'Dessert']);
	await expect(day(page, sun).locator('.names')).toHaveText([
		'Chicken tacos',
		'Garlic bread, Rice',
		'Apple pie'
	]);
	await expect(day(page, sun).locator('.note')).toHaveText('Birthday dinner');
	await expect(day(page, mon).locator('.type')).toHaveText('Eating out');
	await expect(day(page, mon).locator('.dishes')).toHaveCount(0);
	await expect(day(page, mon).locator('.note')).toHaveText('Pizza at Mario’s');
	await expect(day(page, tue).locator('.type')).toHaveText('Going somewhere');
	await expect(day(page, tue).locator('.role')).toHaveText(['Main']);
	await expect(day(page, tue).locator('.names')).toHaveText(['Potato salad']);
	await expect(day(page, tue).locator('.note')).toHaveText('Picnic at the lake');
	await expect(day(page, wed).locator('.type')).toHaveText('Leftovers');
	await expect(day(page, wed).locator('.note')).toHaveText('Tacos from Sunday');
	for (const date of week.slice(4)) {
		await expect(day(page, date)).toContainText('Not planned');
		await expect(day(page, date).locator('.type')).toHaveCount(0);
	}
	await expect(day(page, now).locator('.today-badge')).toHaveText('Today');

	// Next, Previous and This week.
	const nextSunday = addDays(sunday, 7);
	await weeks.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${nextSunday}$`));
	await expect(weeks.locator('.label')).toHaveText(weekRange(nextSunday));
	await expect(page.locator('a.day .date')).toHaveText(
		Array.from({ length: 7 }, (_, index) => dayLabel(addDays(nextSunday, index)))
	);
	await expect(page.locator('a.day', { hasText: 'Not planned' })).toHaveCount(7);
	await expect(page.getByText('Today', { exact: true })).toHaveCount(0);
	await expect(weeks.getByRole('link', { name: 'This week' })).not.toHaveAttribute('aria-current');
	await weeks.getByRole('link', { name: 'This week' }).click();
	await expect(page).toHaveURL(/\/menu$/);
	await expect(weeks.locator('.label')).toHaveText(weekRange(sunday));
	await expect(day(page, sun).locator('.note')).toHaveText('Birthday dinner');
	const lastSunday = addDays(sunday, -7);
	await weeks.getByRole('link', { name: 'Previous' }).click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${lastSunday}$`));
	await expect(weeks.locator('.label')).toHaveText(weekRange(lastSunday));
	await expect(page.locator('a.day .date').first()).toHaveText(dayLabel(lastSunday));
	await expect(page.locator('a.day', { hasText: 'Not planned' })).toHaveCount(7);
});

test('shows the week of any date, and turns away dates that do not exist', async ({
	page,
	person: _
}) => {
	const sunday = sundayOf(today());
	// Any day of a week shows that week, starting on its Sunday.
	await page.goto(`/menu?week=${addDays(sunday, 10)}`);
	await expect(page.locator('a.day .date').first()).toHaveText(dayLabel(addDays(sunday, 7)));
	await expect(page.locator('a.day .date').last()).toHaveText(dayLabel(addDays(sunday, 13)));

	await page.goto('/menu?week=someday');
	await expect(page).toHaveURL(/\/menu$/);
	await expect(page.locator('a.day .date').first()).toHaveText(dayLabel(sunday));

	for (const path of ['/menu/2026-02-30', '/menu/someday']) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
	}
});

test('asks before switching a dinner with dishes to Eating out or Leftovers', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const rice = addRecipe(db, person.householdId, { name: 'Rice' });
	const date = addDays(today(), 2);
	const dinnerId = addDinner(db, person.householdId, date, {
		note: 'Taco night',
		servings: 5,
		dishes: [
			[tacos, 'main'],
			[rice, 'side']
		]
	});
	await page.goto(`/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice']);

	// Going somewhere has dishes too, so nothing to ask.
	await typeButton(page, 'Going somewhere').click();
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice']);

	// Leftovers would take the dishes off, so it asks, and Cancel keeps them.
	await typeButton(page, 'Leftovers').click();
	const dialog = page.getByRole('dialog', { name: 'Switch to Leftovers?' });
	await expect(dialog).toContainText(
		'Leftovers has no dishes, so this takes Chicken tacos and Rice off this dinner. They stay in your recipes.'
	);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice']);
	expect(dinnerDishes(db, dinnerId)).toHaveLength(2);

	await typeButton(page, 'Eating out').click();
	const eatingOut = page.getByRole('dialog', { name: 'Switch to Eating out?' });
	await expect(eatingOut).toContainText('Eating out has no dishes, so this takes Chicken tacos');
	await eatingOut.getByRole('button', { name: 'Switch to Eating out' }).click();
	await expect(eatingOut).toHaveCount(0);
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Taco night');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		type: 'eat_out',
		note: 'Taco night',
		servings: 5
	});
	expect(dinnerDishes(db, dinnerId)).toEqual([]);
	expect(
		db.prepare('select count(*) from dishes where household_id = ?').pluck().get(person.householdId)
	).toBe(2);

	// Back to Cooking at home asks nothing, with no dishes, and the servings come back.
	await typeButton(page, 'Cooking at home').click();
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(dishSection(page).getByText('No dishes yet.')).toBeVisible();
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('5');
});

test("opens each dish's recipe at the servings shown, and asks before leaving with changes", async ({
	page,
	db,
	person
}) => {
	const cakeId = addRecipe(db, person.householdId, {
		name: 'Pound cake',
		servings: 8,
		ingredients: [{ item: 'Flour', amount: 2, unit: 'cup' }]
	});
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { servings: 4, dishes: [[cakeId, 'dessert']] });

	await page.goto(`/menu/${date}`);
	const cake = dishSection(page).getByRole('link', { name: 'Pound cake' });
	await expect(cake).toHaveAttribute('href', `/recipes/${cakeId}?servings=4`);
	await cake.click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${cakeId}\\?servings=4$`));
	await expect(page.getByRole('status')).toHaveText('4 servings');
	await expect(page.getByText('Scaled from 8 servings.')).toBeVisible();
	await expect(
		page.locator('section', { hasText: 'Ingredients' }).getByRole('listitem')
	).toHaveText(['1 cup Flour']);
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));

	// Servings changed but not saved: the recipe opens at what the page shows, unless it can't be
	// saved.
	const servings = page.getByLabel('Servings', { exact: true });
	await page.getByRole('button', { name: 'More servings' }).click();
	await page.getByRole('button', { name: 'More servings' }).click();
	await expect(servings).toHaveValue('6');
	await expect(cake).toHaveAttribute('href', `/recipes/${cakeId}?servings=6`);
	await servings.fill('');
	await expect(cake).toHaveAttribute('href', `/recipes/${cakeId}?servings=4`);
	await servings.fill('0');
	await expect(cake).toHaveAttribute('href', `/recipes/${cakeId}?servings=4`);
	await servings.fill('12');
	await expect(cake).toHaveAttribute('href', `/recipes/${cakeId}?servings=12`);

	// Opening the recipe drops the unsaved servings, so it asks first.
	const questions: string[] = [];
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.accept();
	});
	await cake.click();
	await expect(page).toHaveURL(new RegExp(`/recipes/${cakeId}\\?servings=12$`));
	await expect(page.getByRole('status')).toHaveText('12 servings');
	expect(questions).toEqual([LEAVE]);
	await page.goBack();
	await expect(servings).toHaveValue('4');
	expect(dinnerRow(db, person.householdId, date)?.servings).toBe(4);

	// An unsaved note keeps the person on the page when they say so, however they leave.
	await page.goto(`/menu?week=${date}`);
	await day(page, date).click();
	const note = page.getByLabel('Note', { exact: true });
	await note.fill('Use the good butter');
	const stay = (dialog: Dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	};
	page.on('dialog', stay);
	await page.goBack();
	await expect.poll(() => questions).toEqual([LEAVE, LEAVE]);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect.poll(() => questions).toEqual([LEAVE, LEAVE, LEAVE]);
	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Recipes' })
		.click();
	await expect.poll(() => questions).toEqual([LEAVE, LEAVE, LEAVE, LEAVE]);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(note).toHaveValue('Use the good butter');
	page.off('dialog', stay);

	// Once saved, leaving asks nothing.
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${date}$`));
	await expect(day(page, date).locator('.note')).toHaveText('Use the good butter');
	expect(questions).toHaveLength(4);
});

test('offers to restore an archived dish typed by name, and keeps archived dishes on dinners', async ({
	page,
	db,
	person
}) => {
	const breadId = addRecipe(db, person.householdId, { name: 'Banana bread', archived: true });
	addRecipe(db, person.householdId, { name: 'Banana pudding' });
	const salsaId = addRecipe(db, person.householdId, { name: 'Old salsa', archived: true });
	const date = addDays(today(), 3);
	const other = addDays(today(), 4);
	addDinner(db, person.householdId, other, { dishes: [[salsaId, 'side']] });

	await page.goto(`/menu/${date}`);
	// Archived dishes aren't suggested.
	await dishField(page).fill('banana');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
		'Banana pudding',
		'Add “banana” as a new dish'
	]);

	// Its name is still taken, so adding it offers to restore it, and Cancel changes nothing.
	await addDish(page, 'banana bread', 'new', 'dessert');
	const dialog = page.getByRole('dialog', { name: 'Banana bread' });
	await expect(dialog).toContainText(
		'Banana bread is archived. Restore it and add it to this dinner?'
	);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();
	const breadRows = () =>
		db
			.prepare(
				"select id, archived_at is not null as archived from dishes where household_id = ? and lower(name) = 'banana bread'"
			)
			.all(person.householdId);
	expect(breadRows()).toEqual([{ id: breadId, archived: 1 }]);

	await addButton(page).click();
	await dialog.getByRole('button', { name: 'Restore it and add' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Banana bread']);
	await expect(page.getByLabel('Role for Banana bread')).toHaveValue('dessert');
	await expect(dishSection(page).getByText('Archived', { exact: true })).toHaveCount(0);
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();
	expect(breadRows()).toEqual([{ id: breadId, archived: 0 }]);

	// A dish archived after it was planned stays on its dinner and on the week.
	await page.goto(`/menu/${other}`);
	await expect(dishLinks(page)).toHaveText(['Old salsa']);
	await expect(dishSection(page).getByText('Archived', { exact: true })).toBeVisible();
	await page.goto(`/menu?week=${other}`);
	await expect(day(page, other).locator('.names')).toHaveText(['Old salsa']);
});

test('copies a past dinner from the most-made list or by searching a dish name', async ({
	page,
	db,
	person
}) => {
	const dish = (name: string, archived = false) =>
		addRecipe(db, person.householdId, { name, archived });
	const tacos = dish('Chicken tacos');
	const rice = dish('Rice');
	const lasagna = dish('Lasagna');
	const salad = dish('Caesar salad');
	const pancakes = dish('Pancakes');
	const friedRice = dish('Fried rice');
	const fish = dish('Fish');
	const soup = dish('Soup');
	const salsa = dish('Old salsa', true);
	const now = today();
	const ago = (days: number) => addDays(now, -days);
	const plan = (date: string, seed: Parameters<typeof addDinner>[3]) =>
		addDinner(db, person.householdId, date, seed);

	// Tacos and rice three times: an archived dish doesn't set a dinner apart, the order added
	// doesn't either, and the roles come from the latest one.
	plan(ago(20), {
		dishes: [
			[tacos, 'main'],
			[rice, 'side'],
			[salsa, 'side']
		]
	});
	plan(ago(13), {
		dishes: [
			[rice, 'main'],
			[tacos, 'side']
		]
	});
	plan(ago(6), {
		dishes: [
			[tacos, 'main'],
			[rice, 'side']
		]
	});
	// Lasagna and salad twice, most recently taken somewhere.
	plan(ago(9), {
		dishes: [
			[lasagna, 'main'],
			[salad, 'side']
		]
	});
	plan(ago(2), {
		type: 'going',
		dishes: [
			[salad, 'side'],
			[lasagna, 'main']
		]
	});
	plan(now, { dishes: [[pancakes, 'main']] });
	plan(ago(1), { dishes: [[friedRice, 'main']] });
	// Not offered: a dinner without dishes, and one that hasn't happened yet.
	plan(ago(4), { type: 'eat_out', note: 'Pizza' });
	plan(addDays(now, 5), { dishes: [[fish, 'main']] });

	// Onto a date with nothing planned: it copies straight away, at the usual servings.
	const empty = addDays(now, 1);
	await page.goto(`/menu/${empty}`);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	const sheet = page.getByRole('dialog', { name: 'Copy a dinner' });
	const groups = sheet.getByRole('listitem');
	await expect(groups.locator('.names')).toHaveText([
		'Chicken tacos, Rice',
		'Lasagna, Caesar salad',
		'Pancakes',
		'Fried rice'
	]);
	await expect(groups.locator('.made')).toHaveText([
		`Made 3 times, last ${madeOn(ago(6))}`,
		`Made 2 times, last ${madeOn(ago(2))}`,
		'Made today',
		`Made ${madeOn(ago(1))}`
	]);

	// Searching by a dish name lists the most recent first.
	const search = sheet.getByRole('searchbox', { name: 'Search by dish' });
	await search.fill('RICE');
	await expect(groups.locator('.names')).toHaveText(['Fried rice', 'Chicken tacos, Rice']);
	await search.fill('fish');
	await expect(groups).toHaveCount(0);
	await expect(sheet.getByText('No past dinners with “fish”.')).toBeVisible();
	await search.fill('rice');
	await sheet.getByRole('button', { name: /^Chicken tacos, Rice/ }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Copy a dinner' })).toBeFocused();
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice']);
	await expect(page.getByLabel('Role for Chicken tacos')).toHaveValue('main');
	await expect(page.getByLabel('Role for Rice')).toHaveValue('side');
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('4');

	// Onto a date with dishes: it asks first, and keeps the date's note and servings.
	const planned = addDays(now, 2);
	const plannedId = plan(planned, {
		note: 'Grandma visits',
		servings: 6,
		dishes: [[soup, 'main']]
	});
	await page.goto(`/menu/${planned}`);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	await sheet.getByRole('button', { name: /^Lasagna, Caesar salad/ }).click();
	await expect(sheet).toContainText('Replace the dish on this dinner with Lasagna, Caesar salad?');
	await expect(sheet.getByRole('button', { name: 'Replace dishes' })).toBeFocused();
	await sheet.getByRole('button', { name: 'Back' }).click();
	await expect(groups).toHaveCount(4);
	expect(dinnerDishes(db, plannedId)).toEqual([{ name: 'Soup', role: 'main' }]);
	await sheet.getByRole('button', { name: /^Lasagna, Caesar salad/ }).click();
	await sheet.getByRole('button', { name: 'Replace dishes' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Lasagna', 'Caesar salad']);
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('6');
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Grandma visits');
	expect(dinnerRow(db, person.householdId, planned)).toMatchObject({
		id: plannedId,
		type: 'going',
		note: 'Grandma visits',
		servings: 6
	});
	expect(dinnerDishes(db, plannedId)).toEqual([
		{ name: 'Lasagna', role: 'main' },
		{ name: 'Caesar salad', role: 'side' }
	]);

	// Today's own dinner isn't offered to itself.
	await page.goto(`/menu/${now}`);
	await expect(page.locator('.title').getByText('Today', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	await expect(groups.locator('.names')).toHaveText([
		'Chicken tacos, Rice',
		'Lasagna, Caesar salad',
		'Fried rice'
	]);
});

test('moves a dinner to an empty date, and swaps it with a planned one', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	// Monday to Wednesday next week, so all three show in one week.
	const sunday = addDays(sundayOf(today()), 7);
	const [mon, tue, wed] = [1, 2, 3].map((days) => addDays(sunday, days)) as [
		string,
		string,
		string
	];
	const tacosId = addDinner(db, person.householdId, mon, {
		note: 'Taco night',
		servings: 5,
		dishes: [[tacos, 'main']]
	});
	const pizzaId = addDinner(db, person.householdId, wed, { type: 'eat_out', note: 'Pizza' });

	// The next day is filled in, which has nothing planned.
	await page.goto(`/menu/${mon}`);
	await page.getByRole('button', { name: 'Move to another date' }).click();
	const sheet = page.getByRole('dialog', { name: 'Move to another date' });
	await expect(sheet.getByLabel('New date')).toHaveValue(tue);
	await expect(sheet).toContainText('If that date already has a dinner, the two swap places.');
	// Not to the same date.
	await sheet.getByLabel('New date').fill(mon);
	await sheet.getByRole('button', { name: `Move to ${dayLabel(mon)}` }).click();
	await expect(sheet.getByRole('alert')).toHaveText('Pick a different date');
	await sheet.getByLabel('New date').fill(tue);
	await sheet.getByRole('button', { name: `Move to ${dayLabel(tue)}` }).click();
	await expect(page).toHaveURL(new RegExp(`/menu/${tue}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		new RegExp(`^Tuesday, ${monthDay(tue)}`)
	);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Taco night');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('5');
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// Onto a planned date, the two swap. Moving opens the new date, so an unsaved note is asked
	// about first, once.
	await page.getByLabel('Note', { exact: true }).fill('Bring napkins');
	const questions: string[] = [];
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	await page.getByRole('button', { name: 'Move to another date' }).click();
	await sheet.getByLabel('New date').fill(wed);
	await sheet.getByRole('button', { name: `Move to ${dayLabel(wed)}` }).click();
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/menu/${tue}$`));
	expect(dinnerRow(db, person.householdId, tue)?.id).toBe(tacosId);
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.accept();
	});
	await sheet.getByRole('button', { name: `Move to ${dayLabel(wed)}` }).click();
	await expect(page).toHaveURL(new RegExp(`/menu/${wed}$`));
	expect(questions).toEqual([LEAVE, LEAVE]);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Taco night');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect(day(page, mon)).toContainText('Not planned');
	await expect(day(page, tue).locator('.type')).toHaveText('Eating out');
	await expect(day(page, tue).locator('.note')).toHaveText('Pizza');
	await expect(day(page, wed).locator('.type')).toHaveText('Cooking at home');
	await expect(day(page, wed).locator('.names')).toHaveText(['Chicken tacos']);
	await expect(day(page, wed).locator('.note')).toHaveText('Taco night');
	expect(dinnerRow(db, person.householdId, mon)).toBeUndefined();
	expect(dinnerRow(db, person.householdId, tue)?.id).toBe(pizzaId);
	expect(dinnerRow(db, person.householdId, wed)?.id).toBe(tacosId);
});

test('clears a dinner after asking, and shows the date as not planned', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night', dishes: [[tacos, 'main']] });

	await page.goto(`/menu/${date}`);
	await page.getByRole('button', { name: 'Clear' }).click();
	const dialog = page.getByRole('dialog', { name: 'Clear' });
	await expect(dialog).toContainText(
		'Clear this dinner? The date goes back to not planned. Its dishes stay in your recipes.'
	);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ note: 'Taco night' });

	await page.getByRole('button', { name: 'Clear' }).click();
	await dialog.getByRole('button', { name: 'Clear' }).click();
	const unplanned = page.getByText('Not planned yet. Pick a type, add a dish or copy a dinner.');
	await expect(unplanned).toBeVisible();
	await expect(unplanned).toBeFocused();
	await expect(types(page).getByRole('button', { pressed: true })).toHaveCount(0);
	await expect(dishSection(page).getByText('No dishes yet.')).toBeVisible();
	await expect(page.getByLabel('Note', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Move to another date' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();
	expect(db.prepare('select count(*) from dishes where id = ?').pluck().get(tacos)).toBe(1);

	await page.goto(`/menu?week=${date}`);
	await expect(day(page, date)).toContainText('Not planned');
});

test("can't see or change another household's dinners", async ({ page, db, baseURL, person }) => {
	const other = addPerson(db);
	expect(other.householdId).not.toBe(person.householdId);
	const stew = addRecipe(db, other.householdId, {
		name: 'Secret stew',
		ingredients: [{ item: 'Saffron', amount: 1, unit: 'tsp' }]
	});
	const date = addDays(today(), 1);
	const later = addDays(today(), 2);
	const theirs = addDinner(db, other.householdId, date, {
		note: 'Secret plans',
		dishes: [[stew, 'main']]
	});
	const theirsLater = addDinner(db, other.householdId, later, {
		type: 'eat_out',
		note: 'Secret trip'
	});
	addDinner(db, other.householdId, addDays(today(), -1), { dishes: [[stew, 'main']] });
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const ourPlans = addDinner(db, person.householdId, date, {
		note: 'Our plans',
		dishes: [[tacos, 'main']]
	});

	// The page shows this household's dinner on that date, or none.
	await page.goto(`/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await page.goto(`/menu/${later}`);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	await expect(page.getByRole('dialog')).toContainText('No past dinners to copy yet.');
	await page.goto(`/menu?week=${later}`);
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await expect(day(page, later)).toContainText('Not planned');

	// Their dinners add nothing to this household's pantry check.
	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Start check' }).click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByText('No ingredients yet:')).toHaveText(
		`No ingredients yet: Chicken tacos (${weekday(date)})`
	);
	await expect(page.locator('li.item')).toHaveCount(0);
	await expect(page.getByText(/Secret|Saffron/)).toHaveCount(0);

	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const post = (path: string, form: Record<string, string>) =>
		page.request.post(path, { form, headers }).then((response) => response.status());
	expect(await post(`/menu/${date}?/role`, { dishId: String(stew), role: 'side' })).toBe(404);
	expect(await post(`/menu/${date}?/removeDish`, { dishId: String(stew) })).toBe(404);
	expect(await post(`/menu/${date}?/restoreDish`, { dishId: String(stew), role: 'side' })).toBe(
		404
	);
	expect(await post(`/menu/${later}?/copy`, { sourceId: String(theirs) })).toBe(404);
	expect(await post(`/menu/${later}?/move`, { to: addDays(today(), 5) })).toBe(404);
	// Their dish's name is free in this household, so it's a new dish here, not theirs.
	expect(await post(`/menu/${later}?/addDish`, { name: 'Secret stew', role: 'main' })).toBe(200);
	const ours = dinnerRow(db, person.householdId, later);
	expect(ours).toMatchObject({ type: 'cook' });
	const ourStew = db
		.prepare('select dish_id from dinner_dishes where dinner_id = ?')
		.pluck()
		.get(ours?.id) as number;
	expect(ourStew).not.toBe(stew);
	expect(
		db.prepare('select household_id, name from dishes where id = ?').get(ourStew)
	).toEqual({ household_id: person.householdId, name: 'Secret stew' });
	// Clearing a date clears only this household's dinner.
	expect(await post(`/menu/${later}?/clear`, { dinnerId: String(ours?.id) })).toBe(200);
	expect(await post(`/menu/${date}?/clear`, { dinnerId: String(ourPlans) })).toBe(200);
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();

	expect(dinnerRow(db, other.householdId, date)).toEqual({
		id: theirs,
		type: 'cook',
		note: 'Secret plans',
		servings: 4
	});
	expect(dinnerDishes(db, theirs)).toEqual([{ name: 'Secret stew', role: 'main' }]);
	expect(dinnerRow(db, other.householdId, later)).toEqual({
		id: theirsLater,
		type: 'eat_out',
		note: 'Secret trip',
		servings: 4
	});
	expect(
		db
			.prepare('select count(*) from dinners where household_id = ?')
			.pluck()
			.get(person.householdId)
	).toBe(0);
});

test("says the year a past dinner was last made when it isn't this year", async ({
	page,
	db,
	person
}) => {
	const soup = addRecipe(db, person.householdId, { name: 'Soup' });
	const stew = addRecipe(db, person.householdId, { name: 'Stew' });
	const now = today();
	// More than a year ago, so in an earlier year whatever the date today.
	const longAgo = addDays(now, -400);
	addDinner(db, person.householdId, longAgo, { dishes: [[soup, 'main']] });
	addDinner(db, person.householdId, addDays(longAgo, -30), { dishes: [[stew, 'main']] });
	addDinner(db, person.householdId, addDays(now, -3), { dishes: [[stew, 'main']] });

	await page.goto(`/menu/${addDays(now, 1)}`);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	const groups = page.getByRole('dialog', { name: 'Copy a dinner' }).getByRole('listitem');
	await expect(groups.locator('.names')).toHaveText(['Stew', 'Soup']);
	await expect(groups.locator('.made')).toHaveText([
		`Made 2 times, last ${madeOn(addDays(now, -3))}`,
		`Made ${dayLabel(longAgo)}, ${longAgo.slice(0, 4)}`
	]);

	// As that dinner's own page says.
	await page.goto(`/menu/${longAgo}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		new RegExp(`^[A-Z][a-z]+day, ${monthDay(longAgo)}, ${longAgo.slice(0, 4)}$`)
	);
});

test('fits long dish and item names from a menu pantry check on the grocery list', async ({
	page,
	db,
	person
}) => {
	// As long as the recipe editor allows, in single words that can't wrap at a space.
	const longDish = 'N'.repeat(80);
	const longItem = 'Z'.repeat(80);
	const chicken = addRecipe(db, person.householdId, {
		name: longDish,
		ingredients: [{ item: 'Chicken', amount: 1, unit: 'lb' }]
	});
	const salad = addRecipe(db, person.householdId, {
		name: 'Salad',
		ingredients: [{ item: longItem, amount: 1 }]
	});
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, {
		dishes: [
			[chicken, 'main'],
			[salad, 'side']
		]
	});

	await page.goto('/menu');
	await page.getByRole('button', { name: 'Check pantry' }).click();
	await page
		.getByRole('dialog', { name: 'Check pantry' })
		.getByRole('button', { name: 'Start check' })
		.click();
	await expect(page).toHaveURL(/\/pantry$/);
	for (const item of ['Chicken', longItem]) {
		await page.getByRole('button', { name: `Need ${item}`, exact: true }).click();
		await expect(
			page.getByRole('button', { name: `Undo Need for ${item}`, exact: true })
		).toBeVisible();
	}
	expect(await sideways(page), '/pantry').toBe(0);

	// The note names the dish, and the other line is the long item.
	await page.goto('/groceries');
	await expect(page.getByText(`1 lb for ${longDish} (${weekday(date)})`)).toBeVisible();
	await expect(page.getByText(longItem, { exact: true })).toBeVisible();
	await expect(page.getByText(`1 for Salad (${weekday(date)})`)).toBeVisible();
	expect(await sideways(page), '/groceries').toBe(0);
});

test('refuses to clear or move a dinner someone moved onto the date after the page opened', async ({
	page,
	db,
	person
}) => {
	const salad = addRecipe(db, person.householdId, { name: 'Salad' });
	const roast = addRecipe(db, person.householdId, { name: 'Roast' });
	const date = addDays(today(), 1);
	const later = addDays(today(), 2);
	const saladId = addDinner(db, person.householdId, date, { dishes: [[salad, 'main']] });
	const roastId = addDinner(db, person.householdId, later, {
		note: "Grandma's birthday",
		servings: 6,
		dishes: [[roast, 'main']]
	});
	const note = page.getByLabel('Note', { exact: true });
	const onDate = () => dinnerRow(db, person.householdId, date)?.id;

	// Clear, after someone moved the birthday dinner onto this date.
	await page.goto(`/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Salad']);
	swap(db, roastId, saladId);
	await page.getByRole('button', { name: 'Clear' }).click();
	await page.getByRole('dialog', { name: 'Clear' }).getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByRole('alert')).toHaveText(CHANGED);
	// The page shows the dinner that's there now.
	await expect(dishLinks(page)).toHaveText(['Roast']);
	await expect(note).toHaveValue("Grandma's birthday");
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('6');
	expect(onDate()).toBe(roastId);
	expect(dinnerRow(db, person.householdId, later)?.id).toBe(saladId);

	// Move, after someone moved the salad back.
	swap(db, saladId, roastId);
	const away = addDays(today(), 5);
	await page.getByRole('button', { name: 'Move to another date' }).click();
	const sheet = page.getByRole('dialog', { name: 'Move to another date' });
	await sheet.getByLabel('New date').fill(away);
	await sheet.getByRole('button', { name: `Move to ${dayLabel(away)}` }).click();
	await expect(sheet.getByRole('alert')).toHaveText(CHANGED);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await sheet.getByRole('button', { name: 'Cancel' }).click();
	await expect(dishLinks(page)).toHaveText(['Salad']);
	await expect(note).toHaveValue('');
	expect(onDate()).toBe(saladId);
	expect(dinnerRow(db, person.householdId, away)).toBeUndefined();

	// Now that the page shows the dinner on the date, Clear clears it.
	await page.getByRole('button', { name: 'Clear' }).click();
	await page.getByRole('dialog', { name: 'Clear' }).getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeFocused();
	expect(onDate()).toBeUndefined();
	expect(dinnerRow(db, person.householdId, later)?.id).toBe(roastId);
});

test("refuses to switch, copy onto or save a dinner the page didn't show", async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const salad = addRecipe(db, person.householdId, { name: 'Salad' });
	const roast = addRecipe(db, person.householdId, { name: 'Roast' });
	addDinner(db, person.householdId, addDays(today(), -1), { dishes: [[tacos, 'main']] });
	const date = addDays(today(), 1);
	const later = addDays(today(), 2);
	const empty = addDays(today(), 3);
	const saladId = addDinner(db, person.householdId, date, { dishes: [[salad, 'main']] });
	const roastId = addDinner(db, person.householdId, later, {
		note: "Grandma's birthday",
		servings: 6,
		dishes: [[roast, 'main']]
	});
	const note = page.getByLabel('Note', { exact: true });

	// A type picked on a page showing the date as not planned, after someone planned it.
	await page.goto(`/menu/${empty}`);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	addDinner(db, person.householdId, empty, { type: 'eat_out', note: 'Pizza' });
	await typeButton(page, 'Going somewhere').click();
	await expect(page.getByRole('alert')).toHaveText(CHANGED);
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(note).toHaveValue('Pizza');
	expect(dinnerRow(db, person.householdId, empty)).toMatchObject({ type: 'eat_out' });

	// Switching to Eating out, after someone moved the birthday dinner onto this date.
	await page.goto(`/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Salad']);
	swap(db, roastId, saladId);
	await typeButton(page, 'Eating out').click();
	await page
		.getByRole('dialog', { name: 'Switch to Eating out?' })
		.getByRole('button', { name: 'Switch to Eating out' })
		.click();
	await expect(page.getByRole('alert')).toHaveText(CHANGED);
	await expect(dishLinks(page)).toHaveText(['Roast']);
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ id: roastId, type: 'cook' });
	expect(dinnerDishes(db, roastId)).toEqual([{ name: 'Roast', role: 'main' }]);

	// Copying over its dishes, after someone moved the salad back.
	swap(db, saladId, roastId);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	const sheet = page.getByRole('dialog', { name: 'Copy a dinner' });
	await sheet.getByRole('button', { name: /^Chicken tacos/ }).click();
	await expect(sheet).toContainText('Replace the dish on this dinner with Chicken tacos?');
	await sheet.getByRole('button', { name: 'Replace dishes' }).click();
	await expect(sheet.getByRole('alert')).toHaveText(CHANGED);
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(dishLinks(page)).toHaveText(['Salad']);
	expect(dinnerDishes(db, saladId)).toEqual([{ name: 'Salad', role: 'main' }]);
	expect(dinnerDishes(db, roastId)).toEqual([{ name: 'Roast', role: 'main' }]);

	// Saving a note, after someone moved the birthday dinner on again. The form then shows that
	// dinner's own note, so it isn't replaced unseen, and the note typed is in the notice to copy.
	swap(db, roastId, saladId);
	await note.fill('Bring candles');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Someone put another dinner on this date, so your note wasn\'t saved: "Bring candles"'
	);
	await expect(dishLinks(page)).toHaveText(['Roast']);
	await expect(note).toHaveValue("Grandma's birthday");
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		id: roastId,
		note: "Grandma's birthday"
	});
	expect(dinnerRow(db, person.householdId, later)).toMatchObject({ id: saladId, note: null });
	// Typed again and saved, it goes to the dinner the page shows now.
	await note.fill('Bring candles');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		id: roastId,
		note: 'Bring candles',
		servings: 6
	});
});

test('keeps what was typed when coming back to the app finds the dinner cleared or switched', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date, { type: 'going', servings: 5 });
	const note = page.getByLabel('Note', { exact: true });

	// Someone else clears the dinner while a note is half typed and the app is in the background.
	await page.goto(`/menu/${date}`);
	await note.fill("Grandma's house, bring dessert");
	db.prepare('delete from dinners where id = ?').run(dinnerId);
	await comeBack(page);
	await expect(
		page.getByText('Not planned yet. Pick a type, add a dish or copy a dinner.')
	).toBeVisible();
	await expect(page.getByRole('alert')).toHaveText(
		'Someone cleared or moved this dinner. Save to plan it again with what you typed.'
	);
	await expect(note).toHaveValue("Grandma's house, bring dessert");
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('5');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'Someone had cleared or moved this dinner, so it was planned again with what you saved.'
	);
	await expect(typeButton(page, 'Going somewhere')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		type: 'going',
		note: "Grandma's house, bring dessert",
		servings: 5
	});

	// Someone else switches it to Eating out while a dish name is half typed.
	await dishField(page).fill('Grilled corn with lime butter');
	db.prepare("update dinners set type = 'eat_out' where household_id = ? and date = ?").run(
		person.householdId,
		date
	);
	await comeBack(page);
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveText(
		"Grilled corn with lime butter wasn't added. Switch to Cooking at home or Going somewhere to add dishes."
	);
});

test('shows a dinner swapped onto the date, with what was typed in the notice', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const next = addDays(today(), 2);
	const salad = addDinner(db, person.householdId, date, { note: 'Salad night', servings: 2 });
	const birthday = addDinner(db, person.householdId, next, {
		note: "Grandma's birthday",
		servings: 6
	});
	const note = page.getByLabel('Note', { exact: true });

	await page.goto(`/menu/${date}`);
	await note.fill('Salad needs dressing');
	// Someone else moves the birthday dinner onto this date while the app is in the background.
	const setDate = db.prepare('update dinners set date = ? where id = ?');
	setDate.run('moving', birthday);
	setDate.run(next, salad);
	setDate.run(date, birthday);
	await comeBack(page);

	await expect(page.getByRole('alert')).toHaveText(
		'Someone put another dinner on this date, so your note wasn\'t saved: "Salad needs dressing"'
	);
	await expect(note).toHaveValue("Grandma's birthday");
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('6');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		id: birthday,
		note: "Grandma's birthday"
	});
	expect(dinnerRow(db, person.householdId, next)).toMatchObject({ id: salad, note: 'Salad night' });
});

test('drops the "save to plan it again" notice once another dinner is planned, or nothing is left to save', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const note = page.getByLabel('Note', { exact: true });
	const held = 'Someone cleared or moved this dinner. Save to plan it again with what you typed.';

	// Cleared, then planned again by someone else before the held note is saved.
	let thai = addDinner(db, person.householdId, date, { type: 'eat_out', note: 'Thai place' });
	await page.goto(`/menu/${date}`);
	await note.fill('Thai place, table at 7');
	db.prepare('delete from dinners where id = ?').run(thai);
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveText(held);
	addDinner(db, person.householdId, date, { type: 'leftovers', note: 'Chili from Sunday' });
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveText(
		'Someone put another dinner on this date, so your note wasn\'t saved: "Thai place, table at 7"'
	);
	await expect(typeButton(page, 'Leftovers')).toHaveAttribute('aria-pressed', 'true');
	await expect(note).toHaveValue('Chili from Sunday');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ note: 'Chili from Sunday' });

	// Cleared, then the note put back as it was saved: nothing is left to save, so the held
	// form and its notice go at the next reload.
	db.prepare('delete from dinners where household_id = ? and date = ?').run(
		person.householdId,
		date
	);
	thai = addDinner(db, person.householdId, date, { type: 'eat_out', note: 'Thai place' });
	await page.goto(`/menu/${date}`);
	await note.fill('Thai place, table at 7');
	db.prepare('delete from dinners where id = ?').run(thai);
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveText(held);
	await note.fill('Thai place');
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(
		page.getByText('Not planned yet. Pick a type, add a dish or copy a dinner.')
	).toBeVisible();
});

test("lets what was typed go after the page's own Clear or switch to Eating out", async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	const note = page.getByLabel('Note', { exact: true });

	await page.goto(`/menu/${date}`);
	await note.fill('Taco night with the neighbors');
	await page.getByRole('button', { name: 'Clear' }).click();
	await page.getByRole('dialog', { name: 'Clear' }).getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeFocused();
	await expect(note).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();

	await dishField(page).fill('Grilled corn');
	await typeButton(page, 'Eating out').click();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ type: 'eat_out', note: null });
});
