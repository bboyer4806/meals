import type { Dialog, Locator, Page } from '@playwright/test';
import {
	addDays,
	addDinner,
	addItem,
	addPerson,
	addRecipe,
	dayLabel,
	expect,
	monthDay,
	open,
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

/** A planned dinner's date at the top of its page, which opens Move to another date. */
const dateButton = (page: Page) =>
	page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Move to another date' });
const dishField = (page: Page) => page.getByRole('combobox', { name: 'Add a dish' });
const newRole = (page: Page) => page.getByLabel('Role', { exact: true });
const addButton = (page: Page) => page.getByRole('button', { name: 'Add', exact: true });

/**
 * Adds a dish the way a person would: picks its role when it isn't the one shown, types, then
 * taps a suggestion, which adds it, or taps "new dish" and then Add (MEA-56). Waits for the field
 * to be ready for the next dish.
 */
async function addDish(
	page: Page,
	typed: string,
	pick: { suggestion: string } | 'new',
	role?: 'main' | 'side' | 'dessert' | 'other'
) {
	if (role) await newRole(page).selectOption(role);
	await dishField(page).fill(typed);
	if (pick === 'new') {
		await page.getByRole('option', { name: `Add “${typed}” as a new dish` }).click();
		await addButton(page).click();
	} else {
		await page.getByRole('option', { name: pick.suggestion, exact: true }).click();
	}
	await expect(dishField(page)).toHaveValue('');
}

/** Counts the requests that add a dish, which a tap, a click or a key can send. */
function countAdds(page: Page): () => number {
	let count = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).search === '?/addDish') count += 1;
	});
	return () => count;
}

/** Whether nothing covers the middle of the element, so a tap there reaches it. */
function uncovered(locator: Locator) {
	return locator.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
		return top !== null && element.contains(top);
	});
}

/** Whether the dish suggestions reach the middle of the element, over it or under it. */
function suggestionsAt(locator: Locator) {
	return locator.evaluate((element) => {
		const box = element.getBoundingClientRect();
		return document
			.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
			.some((found) => found.matches('[role=listbox]'));
	});
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

/** The date's dinners, with their restaurants, in the order they were added. */
function dinnerRows(db: Database.Database, householdId: number, date: string) {
	return db
		.prepare(
			'select id, label, type, restaurant_name as restaurant, note from dinners where household_id = ? and date = ? order by id'
		)
		.all(householdId, date) as {
		id: number;
		label: string | null;
		type: string;
		restaurant: string | null;
		note: string | null;
	}[];
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

/** The week's notes as they read there, line breaks included, and whether any is cut off. */
function weekNotes(page: Page) {
	return page.locator('a.day .note').evaluateAll((notes: HTMLElement[]) =>
		notes.map((note) => ({
			text: note.innerText,
			cutOff: note.scrollHeight > note.clientHeight || note.scrollWidth > note.clientWidth
		}))
	);
}

/** Makes requests that match take a while, as on a slow phone connection. */
async function slow(page: Page, matches: (url: URL) => boolean, ms: number) {
	await page.route(matches, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, ms));
		await route.continue();
	});
}

/**
 * Holds back the answers to requests that match until the function it returns is called, as on
 * a slow phone connection. The server gets each request right away and makes the change.
 */
async function holdAnswers(page: Page, matches: (url: URL) => boolean): Promise<() => void> {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route(matches, async (route) => {
		const response = await route.fetch();
		await released;
		await route.fulfill({ response });
	});
	return release;
}

/** Saves the servings and note, which goes to the date's week with "Saved" on its row. */
async function saveToWeek(page: Page, date: string) {
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	await expect(day(page, date).getByRole('status')).toHaveText('Saved');
}

const LEAVE = 'Leave without saving? What you typed will be lost.';
const CHANGED = 'Someone changed this dinner since you opened it.';

/** What leaving asks with a dish name typed and not added, which Save doesn't add (MEA-127). */
function leaveDish(name: string): string {
	return `Leave without adding ${name}? What you typed will be lost.`;
}

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
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	// It shows Cooking at home at the household's usual servings, unsaved (6.9).
	await expect(types(page).getByRole('button', { pressed: true })).toHaveText(['Cooking at home']);
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('4');
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('');
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
	await saveToWeek(page, sun);
	await expect(day(page, sun).locator('.note')).toHaveText('Birthday dinner');
	const sunDinner = dinnerRow(db, person.householdId, sun);
	expect(sunDinner).toMatchObject({ type: 'cook', note: 'Birthday dinner', servings: 6 });
	expect(dinnerDishes(db, sunDinner?.id ?? 0)).toEqual([
		{ name: 'Chicken tacos', role: 'main' },
		{ name: 'Garlic bread', role: 'side' },
		{ name: 'Apple pie', role: 'dessert' },
		{ name: 'Rice', role: 'side' }
	]);
	// Its dishes open their recipes at the servings saved.
	await day(page, sun).click();
	await expect(dishLinks(page).first()).toHaveAttribute('href', `/recipes/${tacosId}?servings=6`);

	// Monday: Eating out, which has a restaurant and a note but no dishes or servings.
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
		'Anything to remember'
	);
	await page.getByLabel('Note', { exact: true }).fill('Pizza at Mario’s');
	await saveToWeek(page, mon);

	// Tuesday: Bringing a dish, with the dish to bring.
	await day(page, tue).click();
	await typeButton(page, 'Bringing a dish').click();
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('4');
	await addDish(page, 'Potato salad', 'new');
	await expect(dishLinks(page)).toHaveText(['Potato salad']);
	await expect(page.getByLabel('Role for Potato salad')).toHaveValue('main');
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
	await page.getByLabel('Note', { exact: true }).fill('Picnic at the lake');
	await saveToWeek(page, tue);

	// Wednesday: Leftovers.
	await day(page, wed).click();
	await typeButton(page, 'Leftovers').click();
	await expect(typeButton(page, 'Leftovers')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await page.getByLabel('Note', { exact: true }).fill('Tacos from Sunday');
	await saveToWeek(page, wed);

	// The week shows each day's type, its dishes by role and its note.
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
	await expect(day(page, tue).locator('.type')).toHaveText('Bringing a dish');
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

// The week shows each dinner's whole note (design 7, Menu; MEA-59).
test("shows each dinner's whole note on the week, with its line breaks, on a phone and a computer", async ({
	page,
	db,
	person
}) => {
	// Each is longer than two lines, and one has a link longer than a line on a phone, with
	// nowhere to break.
	const long = [
		'Grandma and Grandpa visit at 6, so set the big table with the good plates.',
		`Recipe: https://example.com/${'lasagna'.repeat(12)}`,
		'Pick up flowers on the way home.',
		'Dessert after the walk.'
	].join('\n');
	const kids = 'Early, before bath time.\nNo peas.\nApple slices after.';
	const adults = 'After bedtime.\nOpen the red wine.\nCandles on the table.';
	const sunday = sundayOf(today());
	const [mon, tue] = [addDays(sunday, 1), addDays(sunday, 2)];
	addDinner(db, person.householdId, mon, { type: 'leftovers', note: long });
	labelDinner(db, addDinner(db, person.householdId, tue, { note: kids }), 'Kids');
	labelDinner(db, addDinner(db, person.householdId, tue, { note: adults }), 'Adults');
	const whole = [long, kids, adults].map((text) => ({ text, cutOff: false }));

	await page.goto(`/menu?week=${sunday}`);
	await expect(day(page, tue).locator('.dinner')).toHaveCount(2);
	expect(await weekNotes(page)).toEqual(whole);
	expect(await sideways(page)).toBe(0);

	await page.setViewportSize({ width: 1280, height: 800 });
	expect(await weekNotes(page)).toEqual(whole);
	expect(await sideways(page)).toBe(0);
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
	await open(page, `/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice']);

	// Bringing a dish has dishes too, so nothing to ask.
	await typeButton(page, 'Bringing a dish').click();
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
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
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
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

	await open(page, `/menu/${date}`);
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

	// Saving goes to the week without asking.
	await saveToWeek(page, date);
	await expect(day(page, date).locator('.note')).toHaveText('Use the good butter');
	expect(questions).toHaveLength(4);
});

test('goes to the week after a save, which says Saved on that day for a moment', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	const saved = page.getByRole('status').filter({ hasText: 'Saved' });

	await open(page, `/menu/${date}`);
	await page.getByLabel('Note', { exact: true }).fill('Taco night with the neighbors');
	await saveToWeek(page, date);
	expect(questions).toEqual([]);
	await expect(day(page, date).locator('.note')).toHaveText('Taco night with the neighbors');
	await expect(saved).toHaveCount(1);
	await expect(day(page, date).getByRole('status')).toHaveText('', { timeout: 6000 });

	// Coming back to the week, reloading it or opening it from the tab says nothing.
	await day(page, date).click();
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	await expect(day(page, date).locator('.note')).toHaveText('Taco night with the neighbors');
	expect(await saved.count()).toBe(0);
	await page.reload();
	await expect(day(page, date).locator('.note')).toHaveText('Taco night with the neighbors');
	expect(await saved.count()).toBe(0);
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Menu' }).click();
	await expect(page).toHaveURL(/\/menu$/);
	expect(await saved.count()).toBe(0);
	expect(questions).toEqual([]);
});

test('lets someone leave while a save is on its way, and stays where they went', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	await slow(page, (url) => url.pathname === `/menu/${date}` && url.search === '?/details', 800);
	// The page they go to is still loading when the save finishes.
	await slow(page, (url) => url.pathname === '/recipes/__data.json', 2000);

	await open(page, `/menu/${date}`);
	await page.getByLabel('Note', { exact: true }).fill('Taco night with the neighbors');
	page.on('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: 'Save' }).click();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recipes' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
	expect(dinnerRow(db, person.householdId, date)?.note).toBe('Taco night with the neighbors');
});

test('says Saved and stays when more was typed during a save and the person keeps it', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	await slow(page, (url) => url.pathname === `/menu/${date}` && url.search === '?/details', 800);
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	const note = page.getByLabel('Note', { exact: true });

	await open(page, `/menu/${date}`);
	await note.fill('Taco night at 6');
	await page.getByRole('button', { name: 'Save' }).click();
	await note.fill('Taco night at 6, bring salsa');
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(page.getByRole('status')).toHaveText('Saved');
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(note).toHaveValue('Taco night at 6, bring salsa');
	expect(dinnerRow(db, person.householdId, date)?.note).toBe('Taco night at 6');
});

test('asks before leaving to sign in when the session ended, and saves nothing', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	const note = page.getByLabel('Note', { exact: true });

	await open(page, `/menu/${date}`);
	await note.fill('Taco night with the neighbors');
	// Signed out on another device, so the save is sent to sign in instead.
	db.prepare('delete from sessions where user_id = ?').run(person.userId);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(note).toHaveValue('Taco night with the neighbors');
	expect(dinnerRow(db, person.householdId, date)?.note).toBe('Taco night');
});

test('stays on the day with the error when a save fails, keeping what was typed', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { servings: 4 });
	const servings = page.getByLabel('Servings', { exact: true });
	const note = page.getByLabel('Note', { exact: true });

	await open(page, `/menu/${date}`);
	// The field's own minimum stops the browser sending 0, so it's taken off to reach the server.
	await servings.evaluate((input) => input.removeAttribute('min'));
	await servings.fill('0');
	await note.fill('Bring candles');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('alert')).toHaveText('Enter at least 1 serving');
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(servings).toHaveValue('0');
	await expect(note).toHaveValue('Bring candles');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ servings: 4, note: null });
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

	await open(page, `/menu/${date}`);
	// Archived dishes aren't suggested.
	await dishField(page).fill('banana');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
		'Banana pudding',
		'Add “banana” as a new dish'
	]);

	// Its name is still taken, so adding it offers to restore it, and Cancel changes nothing.
	await newRole(page).selectOption('dessert');
	await dishField(page).fill('banana bread');
	await page.getByRole('option', { name: 'Add “banana bread” as a new dish' }).click();
	await addButton(page).click();
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
	await open(page, `/menu/${other}`);
	await expect(dishLinks(page)).toHaveText(['Old salsa']);
	await expect(dishSection(page).getByText('Archived', { exact: true })).toBeVisible();
	await page.goto(`/menu?week=${other}`);
	await expect(day(page, other).locator('.names')).toHaveText(['Old salsa']);
});

test("suggests a dish typed before the page's script started", async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Banana pudding' });
	// Holds the script back, as a slow phone might, while the dish is typed.
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		await released;
		await route.continue();
	});

	await page.goto(`/menu/${addDays(today(), 3)}`, { waitUntil: 'domcontentloaded' });
	await dishField(page).fill('banana');
	release();
	await expect(page.locator('html[data-started]')).toBeAttached();
	await expect(dishField(page)).toHaveValue('banana');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
		'Banana pudding',
		'Add “banana” as a new dish'
	]);
});

test('adds a suggested dish as soon as it is tapped, clicked or chosen with the keys, with the role shown', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	addRecipe(db, person.householdId, { name: 'Rice pudding' });
	addRecipe(db, person.householdId, { name: 'Corn bread' });
	addRecipe(db, person.householdId, { name: 'Corn salad' });
	const date = addDays(today(), 3);
	const adds = countAdds(page);
	await open(page, `/menu/${date}`);

	// A tap adds it without Add (MEA-56), as a Main, the first dish's role, and plans the day.
	await dishField(page).fill('taco');
	await page.getByRole('option', { name: 'Chicken tacos', exact: true }).tap();
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(page.getByLabel('Role for Chicken tacos')).toHaveValue('main');
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	// The field is ready for the next dish, which starts as a Side.
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();
	await expect(newRole(page)).toHaveValue('side');

	// A click adds one with the role picked before it.
	await newRole(page).selectOption('dessert');
	await dishField(page).fill('pud');
	await page.getByRole('option', { name: 'Rice pudding', exact: true }).click();
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Rice pudding']);
	await expect(page.getByLabel('Role for Rice pudding')).toHaveValue('dessert');
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();
	await expect(newRole(page)).toHaveValue('side');

	// So does Enter on one reached with the arrow keys.
	await dishField(page).fill('corn');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
		'Corn bread',
		'Corn salad',
		'Add “corn” as a new dish'
	]);
	await dishField(page).press('ArrowDown');
	await dishField(page).press('ArrowDown');
	await dishField(page).press('Enter');
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Corn salad', 'Rice pudding']);
	await expect(page.getByLabel('Role for Corn salad')).toHaveValue('side');
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();

	// Each was sent once.
	expect(adds()).toBe(3);
	expect(dinnerDishes(db, dinnerRow(db, person.householdId, date)?.id ?? 0)).toEqual([
		{ name: 'Chicken tacos', role: 'main' },
		{ name: 'Rice pudding', role: 'dessert' },
		{ name: 'Corn salad', role: 'side' }
	]);
});

test('keeps Add under the dish field on a phone, never covered or moved by the suggestions', async ({
	page,
	db,
	person
}) => {
	// The width of the phone in the feedback (MEA-56).
	await page.setViewportSize({ width: 411, height: 839 });
	for (const name of [
		'Rice',
		'Rice and beans',
		'Rice noodles',
		'Rice pudding',
		'Rice salad',
		'Brown rice',
		'Fried rice',
		'Wild rice'
	]) {
		addRecipe(db, person.householdId, { name });
	}
	const date = addDays(today(), 3);
	const adds = countAdds(page);
	await open(page, `/menu/${date}`);
	const before = await addButton(page).boundingBox();

	// The suggestions show under Add, in the page, about four at a time, and the rest scroll.
	await dishField(page).fill('ric');
	const list = page.getByRole('listbox');
	await expect(list.getByRole('option')).toHaveCount(9);
	expect(await addButton(page).boundingBox()).toEqual(before);
	expect(await uncovered(addButton(page))).toBe(true);
	const listBox = await list.boundingBox();
	expect(listBox?.y).toBeGreaterThan((before?.y ?? 0) + (before?.height ?? 0));
	expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	const wildRice = list.getByRole('option', { name: 'Wild rice', exact: true });
	await expect(wildRice).not.toBeInViewport();
	expect(await sideways(page)).toBe(0);

	// One further down the list is scrolled to, and a tap adds it.
	await wildRice.tap();
	await expect(dishLinks(page)).toHaveText(['Wild rice']);
	await expect(dishField(page)).toHaveValue('');

	// A new name is added with Add, tapped while the suggestions still show.
	await dishField(page).fill('Garlic bread');
	await expect(
		page.getByRole('option', { name: 'Add “Garlic bread” as a new dish' })
	).toBeVisible();
	expect(await uncovered(addButton(page))).toBe(true);
	await addButton(page).tap();
	await expect(dishLinks(page)).toHaveText(['Wild rice', 'Garlic bread']);
	await expect(page.getByLabel('Role for Garlic bread')).toHaveValue('side');
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();

	// Tapping "new dish" adds nothing until Add.
	await dishField(page).fill('Sweet corn');
	await page.getByRole('option', { name: 'Add “Sweet corn” as a new dish' }).tap();
	await expect(list).toHaveCount(0);
	await expect(dishField(page)).toHaveValue('Sweet corn');
	await addButton(page).tap();
	await expect(dishLinks(page)).toHaveText(['Wild rice', 'Garlic bread', 'Sweet corn']);
	await expect(dishField(page)).toHaveValue('');
	expect(adds()).toBe(3);
});

test('keeps the dish suggestions under the header, tab bar and feedback button, so tapping those does what it says (MEA-143)', async ({
	page,
	db,
	person
}) => {
	// A few dishes put the field low enough on a phone that, with the keyboard closed, the
	// suggestions reach the feedback button and the tab bar.
	const date = addDays(today(), 3);
	addDinner(db, person.householdId, date, {
		dishes: [
			[addRecipe(db, person.householdId, { name: 'Roast chicken' }), 'main'],
			[addRecipe(db, person.householdId, { name: 'Green salad' }), 'side'],
			[addRecipe(db, person.householdId, { name: 'Mashed potatoes' }), 'side'],
			[addRecipe(db, person.householdId, { name: 'Apple pie' }), 'dessert']
		]
	});
	for (const name of ['Cranberry sauce', 'Creamed corn', 'Crispy potatoes', 'Croissants']) {
		addRecipe(db, person.householdId, { name });
	}
	const adds = countAdds(page);
	const help = page.getByRole('banner').getByRole('button', { name: 'Help', exact: true });
	const more = page.getByRole('banner').getByText('More', { exact: true });
	const feedback = page.getByRole('button', { name: 'Send feedback' });
	const recipesTab = page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Recipes' });
	await open(page, `/menu/${date}`);
	await dishField(page).fill('Cr');
	const list = page.getByRole('listbox');
	await expect(list.getByRole('option')).toHaveCount(5);

	// Scrolled up, the suggestions pass under Help and More, which stay on top.
	await list.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top));
	for (const control of [help, more]) {
		expect(await suggestionsAt(control)).toBe(true);
		expect(await uncovered(control)).toBe(true);
	}

	// Back at the top, they pass under the feedback button and the tab bar.
	await page.evaluate(() => window.scrollTo(0, 0));
	for (const control of [feedback, recipesTab]) {
		expect(await suggestionsAt(control)).toBe(true);
		expect(await uncovered(control)).toBe(true);
	}

	// Tapping Recipes goes there, asking first about the name typed (MEA-127), and adds nothing.
	const questions: string[] = [];
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.accept();
	});
	await recipesTab.tap();
	await expect(page).toHaveURL(/\/recipes$/);
	expect(questions).toEqual([leaveDish('Cr')]);
	expect(adds()).toBe(0);
});

test('sends a picked dish once while it is on its way', async ({ page, db, person }) => {
	addRecipe(db, person.householdId, { name: 'Rice' });
	const date = addDays(today(), 3);
	const adds = countAdds(page);
	await open(page, `/menu/${date}`);
	// Holds the add back, as a slow connection might.
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route(
		(url) => url.search === '?/addDish',
		async (route) => {
			await released;
			await route.continue();
		}
	);

	await dishField(page).fill('ric');
	await page.getByRole('option', { name: 'Rice', exact: true }).tap();
	await expect.poll(adds).toBe(1);
	// Picking it again, Enter and Add send nothing more meanwhile.
	await dishField(page).fill('ric');
	await page.getByRole('option', { name: 'Rice', exact: true }).tap();
	await dishField(page).press('Enter');
	await addButton(page).tap();
	release();
	await expect(dishLinks(page)).toHaveText(['Rice']);
	await expect(dishField(page)).toHaveValue('');
	await expect(dishSection(page).getByRole('alert')).toHaveCount(0);
	expect(adds()).toBe(1);
	expect(dinnerDishes(db, dinnerRow(db, person.householdId, date)?.id ?? 0)).toEqual([
		{ name: 'Rice', role: 'main' }
	]);
});

test('offers to restore a suggested dish someone archived after the page opened', async ({
	page,
	db,
	person
}) => {
	const bread = addRecipe(db, person.householdId, { name: 'Banana bread' });
	const date = addDays(today(), 3);
	await open(page, `/menu/${date}`);
	db.prepare('update dishes set archived_at = ? where id = ?').run(Date.now(), bread);

	await newRole(page).selectOption('dessert');
	await dishField(page).fill('banana');
	await page.getByRole('option', { name: 'Banana bread', exact: true }).tap();
	const dialog = page.getByRole('dialog', { name: 'Banana bread' });
	await expect(dialog).toContainText(
		'Banana bread is archived. Restore it and add it to this dinner?'
	);
	await dialog.getByRole('button', { name: 'Restore it and add' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Banana bread']);
	await expect(page.getByLabel('Role for Banana bread')).toHaveValue('dessert');
	await expect(dishField(page)).toHaveValue('');
	await expect(dishField(page)).toBeFocused();
	expect(db.prepare('select archived_at from dishes where id = ?').pluck().get(bread)).toBeNull();
});

test('asks before Save leaves a dish name typed and not added, naming it (MEA-127)', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date, { note: 'Taco night' });
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});

	// "Add ... as a new dish" only fills the name in, and Save doesn't add it, so going to the
	// week asks, naming the dish. Staying keeps it, with the note saved.
	await open(page, `/menu/${date}`);
	await page.getByLabel('Note', { exact: true }).fill('Taco night at 6');
	await dishField(page).fill('Garlic bread');
	await page.getByRole('option', { name: 'Add “Garlic bread” as a new dish' }).click();
	await expect(dishField(page)).toHaveValue('Garlic bread');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect.poll(() => questions).toEqual([leaveDish('Garlic bread')]);
	await expect(page.getByRole('status')).toHaveText('Saved');
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(dishField(page)).toHaveValue('Garlic bread');
	expect(dinnerRow(db, person.householdId, date)?.note).toBe('Taco night at 6');
	expect(dinnerDishes(db, dinnerId)).toEqual([]);

	// Once it's added, leaving asks nothing.
	await addButton(page).click();
	await expect(dishLinks(page)).toHaveText(['Garlic bread']);
	await expect(dishField(page)).toHaveValue('');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect(day(page, date).locator('.names')).toHaveText(['Garlic bread']);
	expect(questions).toHaveLength(1);
});

test('asks before leaving or moving with a dish name typed, and drops it when told to (MEA-127)', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date);
	const questions: string[] = [];
	const stay = (dialog: Dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	};
	page.on('dialog', stay);
	const weekLink = page.getByRole('link', { name: /^‹ Week of/ });

	// The week link, a tab and Move each ask, naming the dish as it would be added.
	await open(page, `/menu/${date}`);
	await dishField(page).fill('  Garlic   bread ');
	await weekLink.click();
	await expect.poll(() => questions).toEqual([leaveDish('Garlic bread')]);
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recipes' }).click();
	await expect.poll(() => questions).toHaveLength(2);
	await dateButton(page).click();
	const sheet = page.getByRole('dialog', { name: 'Move to another date' });
	await sheet.getByRole('button', { name: /^Move to / }).click();
	await expect.poll(() => questions).toHaveLength(3);
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Cancel' }).click();
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(dishField(page)).toHaveValue('  Garlic   bread ');
	expect(questions).toEqual(Array(3).fill(leaveDish('Garlic bread')));

	// Told to go, it goes without the dish.
	page.off('dialog', stay);
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.accept();
	});
	await weekLink.click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	expect(questions).toHaveLength(4);
	expect(dinnerDishes(db, dinnerId)).toEqual([]);

	// Spaces alone aren't a name, so leaving asks nothing.
	page.on('dialog', stay);
	await day(page, date).click();
	await dishField(page).fill('   ');
	await weekLink.click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	expect(questions).toHaveLength(4);
});

test('has the browser ask before closing the tab with a dish name typed (MEA-127)', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date);
	const dialogs: string[] = [];
	page.on('dialog', (dialog) => {
		dialogs.push(dialog.type());
		void dialog.dismiss();
	});

	await open(page, `/menu/${date}`);
	// A tap first, since the browser only asks on a page someone used.
	await dishField(page).click();
	await dishField(page).fill('Garlic bread');
	await page.close({ runBeforeUnload: true });
	await expect.poll(() => dialogs).toEqual(['beforeunload']);
	expect(page.isClosed()).toBe(false);
});

test('goes to the week without asking about a picked dish still on its way at Save (MEA-127)', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Rice' });
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date, { note: 'Taco night' });
	const adds = countAdds(page);
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	// Holds the add back, as a slow connection might.
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route(
		(url) => url.search === '?/addDish',
		async (route) => {
			await released;
			await route.continue();
		}
	);

	await open(page, `/menu/${date}`);
	await page.getByLabel('Note', { exact: true }).fill('Taco night at 6');
	await dishField(page).fill('ric');
	await page.getByRole('option', { name: 'Rice', exact: true }).tap();
	await expect.poll(adds).toBe(1);
	await saveToWeek(page, date);
	release();
	await expect.poll(() => dinnerDishes(db, dinnerId)).toEqual([{ name: 'Rice', role: 'main' }]);
	expect(dinnerRow(db, person.householdId, date)?.note).toBe('Taco night at 6');
	expect(questions).toEqual([]);
});

test('keeps a dish name typed, with nothing to save, when someone else clears the dinner (MEA-127)', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date, { note: 'Taco night' });

	// Save doesn't add a dish, so a name alone holds no form for Save, and stays for Add.
	await open(page, `/menu/${date}`);
	await dishField(page).fill('Garlic bread');
	db.prepare('delete from dinners where id = ?').run(dinnerId);
	await comeBack(page);
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('');
	await expect(dishField(page)).toHaveValue('Garlic bread');
	await addButton(page).click();
	await expect(dishLinks(page)).toHaveText(['Garlic bread']);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ type: 'cook', note: null });
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
	await open(page, `/menu/${empty}`);
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
	// It takes up to 80 characters, as a dish name does (6.9).
	await search.fill('x'.repeat(81));
	await expect(search).toHaveValue('x'.repeat(80));
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
	await open(page, `/menu/${planned}`);
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
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
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
	await open(page, `/menu/${now}`);
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
	await open(page, `/menu/${mon}`);
	await dateButton(page).click();
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
	await dateButton(page).click();
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

test('says the year on Move when the new date is in another year', async ({
	page,
	db,
	person
}) => {
	// This year's New Year's Eve, whose next day is in the next year (MEA-150).
	const year = Number(today().slice(0, 4));
	const eve = `${year}-12-31`;
	const newYearsDay = `${year + 1}-01-01`;
	const dayBefore = `${year}-12-30`;
	const nextEve = `${year + 1}-12-31`;
	addDinner(db, person.householdId, eve, { note: "New Year's Eve" });

	await open(page, `/menu/${eve}`);
	await dateButton(page).click();
	const sheet = page.getByRole('dialog', { name: 'Move to another date' });
	const newDate = sheet.getByLabel('New date');
	const move = sheet.getByRole('button', { name: /^Move/ });
	await expect(newDate).toHaveValue(newYearsDay);
	await expect(move).toHaveText(`Move to ${dayLabel(newYearsDay)}, ${year + 1}`);
	// A date this year doesn't say its year.
	await newDate.fill(dayBefore);
	await expect(move).toHaveText(`Move to ${dayLabel(dayBefore)}`);
	// A slip in the year field, so the date isn't taken for this year's.
	await newDate.fill(nextEve);
	await expect(move).toHaveText(`Move to ${dayLabel(nextEve)}, ${year + 1}`);
});

test('clears a dinner after asking, and shows the date as not planned', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night', dishes: [[tacos, 'main']] });

	await open(page, `/menu/${date}`);
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
	const unplanned = page.getByText('Not planned yet.');
	await expect(unplanned).toBeVisible();
	await expect(unplanned).toBeFocused();
	await expect(types(page).getByRole('button', { pressed: true })).toHaveText(['Cooking at home']);
	await expect(dishSection(page).getByText('No dishes yet.')).toBeVisible();
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('');
	// The date is plain text, with nothing to move.
	await expect(dateButton(page)).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		new RegExp(`^[A-Z][a-z]+day, ${monthDay(date)}`)
	);
	await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();
	expect(db.prepare('select count(*) from dishes where id = ?').pluck().get(tacos)).toBe(1);

	await page.goto(`/menu?week=${date}`);
	await expect(day(page, date)).toContainText('Not planned');
});

test("can't see or change another household's dinners", async ({ page, db, baseURL, person }) => {
	const other = addPerson(db);
	expect(other.householdId).not.toBe(person.householdId);
	const stew = addRecipe(db, other.householdId, { name: 'Secret stew' });
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
	await open(page, `/menu/${date}`);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await open(page, `/menu/${later}`);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	await expect(page.getByRole('dialog')).toContainText('No past dinners to copy yet.');
	await page.goto(`/menu?week=${later}`);
	await expect(page.getByText(/Secret/)).toHaveCount(0);
	await expect(day(page, later)).toContainText('Not planned');

	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const post = (path: string, form: Record<string, string>) =>
		page.request.post(path, { form, headers }).then((response) => response.status());
	const dinnerId = String(theirs);
	expect(await post(`/menu/${date}?/role`, { dishId: String(stew), role: 'side', dinnerId })).toBe(
		404
	);
	expect(await post(`/menu/${date}?/removeDish`, { dishId: String(stew), dinnerId })).toBe(404);
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

	await open(page, `/menu/${addDays(now, 1)}`);
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	const groups = page.getByRole('dialog', { name: 'Copy a dinner' }).getByRole('listitem');
	await expect(groups.locator('.names')).toHaveText(['Stew', 'Soup']);
	await expect(groups.locator('.made')).toHaveText([
		`Made 2 times, last ${madeOn(addDays(now, -3))}`,
		`Made ${dayLabel(longAgo)}, ${longAgo.slice(0, 4)}`
	]);

	// As that dinner's own page says.
	await open(page, `/menu/${longAgo}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		new RegExp(`^[A-Z][a-z]+day, ${monthDay(longAgo)}, ${longAgo.slice(0, 4)}$`)
	);
});

test('fits long dish and item names from an earlier menu pantry check on the grocery list', async ({
	page,
	db,
	person
}) => {
	// The pantry check is hidden (design 6.8), but the lines its Need added stay on the list, as
	// Need left them. As long as the recipe editor allows, in single words that can't wrap at a
	// space.
	const longDish = 'N'.repeat(80);
	const longItem = 'Z'.repeat(80);
	const date = addDays(today(), 1);
	const needLine = (item: string, note: string) =>
		db
			.prepare(
				"insert into grocery_needs (household_id, item_id, quantity, status, note, created_at) values (?, ?, 1, 'to_order', ?, ?)"
			)
			.run(person.householdId, addItem(db, person.householdId, item), note, Date.now());
	needLine('Chicken', `1 lb for ${longDish} (${weekday(date)})`);
	needLine(longItem, `1 for Salad (${weekday(date)})`);

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
	await open(page, `/menu/${date}`);
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
	await dateButton(page).click();
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
	await open(page, `/menu/${empty}`);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	addDinner(db, person.householdId, empty, { type: 'eat_out', note: 'Pizza' });
	await typeButton(page, 'Bringing a dish').click();
	await expect(page.getByRole('alert')).toHaveText(CHANGED);
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(note).toHaveValue('Pizza');
	expect(dinnerRow(db, person.householdId, empty)).toMatchObject({ type: 'eat_out' });

	// Switching to Eating out, after someone moved the birthday dinner onto this date.
	await open(page, `/menu/${date}`);
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
	await saveToWeek(page, date);
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
	await open(page, `/menu/${date}`);
	await note.fill("Grandma's house, bring dessert");
	db.prepare('delete from dinners where id = ?').run(dinnerId);
	await comeBack(page);
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveText(
		'Someone cleared or moved this dinner. Save to plan it again with what you typed.'
	);
	await expect(note).toHaveValue("Grandma's house, bring dessert");
	await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('5');
	// It stays on the day to say so (MEA-15 decides where it goes).
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'Someone had cleared or moved this dinner, so it was planned again with what you saved.'
	);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
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
		"Grilled corn with lime butter wasn't added. Switch to Cooking at home or Bringing a dish to add dishes."
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

	await open(page, `/menu/${date}`);
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
	await open(page, `/menu/${date}`);
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
	await open(page, `/menu/${date}`);
	await note.fill('Thai place, table at 7');
	db.prepare('delete from dinners where id = ?').run(thai);
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveText(held);
	await note.fill('Thai place');
	await comeBack(page);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByText('Not planned yet.')).toBeVisible();
});

test("lets what was typed go after the page's own Clear or switch to Eating out", async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Taco night' });
	const note = page.getByLabel('Note', { exact: true });

	await open(page, `/menu/${date}`);
	await note.fill('Taco night with the neighbors');
	await page.getByRole('button', { name: 'Clear' }).click();
	await page.getByRole('dialog', { name: 'Clear' }).getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeFocused();
	await expect(note).toHaveValue('');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();

	await dishField(page).fill('Grilled corn');
	await typeButton(page, 'Eating out').click();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ type: 'eat_out', note: null });
});

test('saves an unplanned day as Cooking at home, only when Save is tapped', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const note = page.getByLabel('Note', { exact: true });

	// Opening it, and leaving it untouched, saves nothing.
	await open(page, `/menu/${date}`);
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect(day(page, date)).toContainText('Not planned');
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();

	await day(page, date).click();
	await note.fill('Grill outside');
	await page.getByRole('button', { name: 'More servings' }).click();
	await saveToWeek(page, date);
	await expect(day(page, date).locator('.note')).toHaveText('Grill outside');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		type: 'cook',
		note: 'Grill outside',
		servings: 5
	});
});

test('asks before leaving an unplanned day with something typed', async ({ page, db, person }) => {
	const date = addDays(today(), 1);
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});

	await open(page, `/menu/${date}`);
	await page.getByLabel('Note', { exact: true }).fill('Grill outside');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));
	expect(dinnerRow(db, person.householdId, date)).toBeUndefined();
});

test("names an Eating out dinner's restaurant, shown on the week and kept after a reload", async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const restaurant = page.getByLabel('Restaurant', { exact: true });
	const note = page.getByLabel('Note', { exact: true });
	const restaurantOnWeek = day(page, date).locator('.restaurant-name');

	// Only Eating out has one.
	await open(page, `/menu/${date}`);
	await expect(restaurant).toHaveCount(0);
	await typeButton(page, 'Eating out').click();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(restaurant).toHaveValue('');
	await expect(restaurant).toHaveAttribute('placeholder', 'Where to go');
	await expect(restaurant).toHaveAttribute('maxlength', '80');
	await restaurant.fill('  Thai   Garden ');
	await note.fill('Table for 4 at 7');
	await saveToWeek(page, date);
	await expect(day(page, date).locator('.type')).toHaveText('Eating out');
	await expect(restaurantOnWeek).toHaveText('Thai Garden');
	await expect(day(page, date).locator('.note')).toHaveText('Table for 4 at 7');
	expect(dinnerRows(db, person.householdId, date)).toMatchObject([
		{ type: 'eat_out', restaurant: 'Thai Garden', note: 'Table for 4 at 7' }
	]);

	// It's on the dinner's page, after a reload too, and changes with Save.
	await day(page, date).click();
	await expect(restaurant).toHaveValue('Thai Garden');
	await page.reload();
	await expect(page.locator('html[data-started]')).toBeAttached();
	await expect(restaurant).toHaveValue('Thai Garden');
	await restaurant.fill('Olive Garden');
	await saveToWeek(page, date);
	await expect(restaurantOnWeek).toHaveText('Olive Garden');

	// Leaving with it changed and not saved asks first.
	const questions: string[] = [];
	page.on('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	});
	await day(page, date).click();
	await restaurant.fill('Taco Bar');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(page).toHaveURL(new RegExp(`/menu/${date}$`));

	// Another type takes it off the dinner, keeping the note.
	await restaurant.fill('Olive Garden');
	await typeButton(page, 'Cooking at home').click();
	await expect(typeButton(page, 'Cooking at home')).toHaveAttribute('aria-pressed', 'true');
	await expect(restaurant).toHaveCount(0);
	await expect
		.poll(() => dinnerRows(db, person.householdId, date))
		.toMatchObject([{ type: 'cook', restaurant: null, note: 'Table for 4 at 7' }]);
	await typeButton(page, 'Eating out').click();
	await expect(restaurant).toHaveValue('');
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect(restaurantOnWeek).toHaveCount(0);
	expect(questions).toEqual([LEAVE]);
});

test('keeps what was typed on an unplanned day when a dish or a copy plans it', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	addDinner(db, person.householdId, addDays(today(), -1), { dishes: [[tacos, 'main']] });
	const note = page.getByLabel('Note', { exact: true });
	const servings = page.getByLabel('Servings', { exact: true });

	// Adding a dish plans the day with the dish alone; the note and servings wait for Save.
	const dished = addDays(today(), 1);
	await open(page, `/menu/${dished}`);
	await note.fill('Grill outside');
	await servings.fill('6');
	await addDish(page, 'Grilled corn', 'new');
	await expect(dishLinks(page)).toHaveText(['Grilled corn']);
	await expect(note).toHaveValue('Grill outside');
	await expect(servings).toHaveValue('6');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, dished)).toMatchObject({ note: null, servings: 4 });
	await saveToWeek(page, dished);
	expect(dinnerRow(db, person.householdId, dished)).toMatchObject({
		type: 'cook',
		note: 'Grill outside',
		servings: 6
	});

	// Copying a dinner does the same.
	const copied = addDays(today(), 2);
	await open(page, `/menu/${copied}`);
	await note.fill('Taco night');
	await page.getByRole('button', { name: 'Copy a dinner' }).click();
	const sheet = page.getByRole('dialog', { name: 'Copy a dinner' });
	await sheet.getByRole('button', { name: /^Chicken tacos/ }).click();
	await expect(sheet).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos']);
	await expect(note).toHaveValue('Taco night');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRow(db, person.householdId, copied)).toMatchObject({ note: null });
	await saveToWeek(page, copied);
	expect(dinnerRow(db, person.householdId, copied)).toMatchObject({ note: 'Taco night' });
});

// On a slow connection, the change that plans an unplanned day can still be on its way when the
// next one is made (MEA-128).

test('adds a dish picked while the type planning the day is on its way, and asks before a switch would take one off', async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Potato salad' });
	const note = page.getByLabel('Note', { exact: true });
	const adds = countAdds(page);

	// The type planned the day, and its answer hasn't come when the dish is picked.
	const date = addDays(today(), 1);
	await open(page, `/menu/${date}`);
	const typeAnswered = await holdAnswers(page, (url) => url.search === '?/type');
	await note.fill('Bring the big bowl');
	await typeButton(page, 'Bringing a dish').click();
	await expect.poll(() => dinnerRow(db, person.householdId, date)?.type).toBe('going');
	await dishField(page).fill('pot');
	await page.getByRole('option', { name: 'Potato salad', exact: true }).tap();
	typeAnswered();
	await expect(dishLinks(page)).toHaveText(['Potato salad']);
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishField(page)).toHaveValue('');
	await expect(note).toHaveValue('Bring the big bowl');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(adds()).toBe(1);
	const going = dinnerRow(db, person.householdId, date);
	expect(dinnerRows(db, person.householdId, date)).toHaveLength(1);
	expect(going).toMatchObject({ type: 'going', note: null });
	expect(dinnerDishes(db, going?.id ?? 0)).toEqual([{ name: 'Potato salad', role: 'main' }]);
	await saveToWeek(page, date);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({ note: 'Bring the big bowl' });

	// Eating out, tapped while the dish planning the day is on its way, asks first once the dish
	// shows, as it would have if tapped then.
	const dished = addDays(today(), 2);
	await open(page, `/menu/${dished}`);
	const dishAnswered = await holdAnswers(page, (url) => url.search === '?/addDish');
	await dishField(page).fill('pot');
	await page.getByRole('option', { name: 'Potato salad', exact: true }).tap();
	await expect.poll(() => dinnerRow(db, person.householdId, dished)?.type).toBe('cook');
	await typeButton(page, 'Eating out').click();
	dishAnswered();
	const sheet = page.getByRole('dialog', { name: 'Switch to Eating out?' });
	await expect(sheet).toContainText('this takes Potato salad off this dinner');
	await sheet.getByRole('button', { name: 'Switch to Eating out' }).click();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(dishSection(page)).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	const eatingOut = dinnerRow(db, person.householdId, dished);
	expect(dinnerRows(db, person.householdId, dished)).toHaveLength(1);
	expect(eatingOut).toMatchObject({ type: 'eat_out' });
	expect(dinnerDishes(db, eatingOut?.id ?? 0)).toEqual([]);
});

test('saves to the dinner that a type tapped just before Save planned, and saves nothing when the type is refused', async ({
	page,
	db,
	person
}) => {
	const note = page.getByLabel('Note', { exact: true });
	const date = addDays(today(), 1);
	await open(page, `/menu/${date}`);
	const typeAnswered = await holdAnswers(page, (url) => url.search === '?/type');
	await note.fill('Bring the big bowl');
	await typeButton(page, 'Bringing a dish').click();
	await expect.poll(() => dinnerRow(db, person.householdId, date)?.type).toBe('going');
	await page.getByRole('button', { name: 'Save' }).click();
	typeAnswered();

	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	await expect(day(page, date).getByRole('status')).toHaveText('Saved');
	expect(dinnerRows(db, person.householdId, date)).toEqual([
		expect.objectContaining({ type: 'going', note: 'Bring the big bowl' })
	]);

	// Someone planned the day after the page opened, so the type is refused. Save, tapped while
	// it was on its way, isn't sent, and the page says why, with the note typed to copy.
	const taken = addDays(today(), 2);
	await open(page, `/menu/${taken}`);
	addDinner(db, person.householdId, taken, { type: 'eat_out', note: 'Pizza' });
	const refusalAnswered = await holdAnswers(page, (url) => url.search === '?/type');
	await note.fill('Bring the big bowl');
	await typeButton(page, 'Bringing a dish').click();
	await page.getByRole('button', { name: 'Save' }).click();
	refusalAnswered();

	await expect(page.getByRole('alert')).toHaveText([
		'Someone put another dinner on this date, so your note wasn\'t saved: "Bring the big bowl"',
		CHANGED
	]);
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(note).toHaveValue('Pizza');
	await expect(page).toHaveURL(new RegExp(`/menu/${taken}$`));
	expect(dinnerRows(db, person.householdId, taken)).toEqual([
		expect.objectContaining({ type: 'eat_out', note: 'Pizza' })
	]);
});

test('keeps what was typed when the page reloads while its own change is on its way', async ({
	page,
	db,
	person
}) => {
	const date = addDays(today(), 1);
	const note = page.getByLabel('Note', { exact: true });
	await open(page, `/menu/${date}`);
	const typeAnswered = await holdAnswers(page, (url) => url.search === '?/type');
	await note.fill('Chili from Sunday');
	await typeButton(page, 'Leftovers').click();
	await expect.poll(() => dinnerRow(db, person.householdId, date)?.type).toBe('leftovers');

	// Coming back to the app reloads the page, which shows the day planned, before the answer.
	await comeBack(page);
	await expect(typeButton(page, 'Leftovers')).toHaveAttribute('aria-pressed', 'true');
	await expect(note).toHaveValue('Chili from Sunday');
	await expect(page.getByRole('alert')).toHaveCount(0);

	const reloaded = page.waitForResponse((response) => response.url().includes('/__data.json'));
	typeAnswered();
	await reloaded;
	await expect(note).toHaveValue('Chili from Sunday');
	await expect(page.getByRole('alert')).toHaveCount(0);
	await saveToWeek(page, date);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		type: 'leftovers',
		note: 'Chili from Sunday'
	});
});

// Requests (design 6.12), under the week.

function requestsSection(page: Page) {
	return page.getByRole('region', { name: 'Requests' });
}

/** The shorter side of the element's box, which on a tap target is at least 44 px (design 8). */
async function tapSize(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('Nothing there to tap');
	return Math.min(box.width, box.height);
}

function requestSheet(page: Page) {
	return page.getByRole('dialog', { name: 'Request a dish' });
}

async function openRequestSheet(page: Page) {
	await requestsSection(page).getByRole('button', { name: 'Request a dish' }).click();
	await expect(requestSheet(page)).toBeVisible();
}

function restaurantSheet(page: Page) {
	return page.getByRole('dialog', { name: 'Request a restaurant' });
}

async function openRestaurantSheet(page: Page) {
	await requestsSection(page).getByRole('button', { name: 'Request a restaurant' }).click();
	await expect(restaurantSheet(page)).toBeVisible();
}

const restaurantField = (page: Page) =>
	restaurantSheet(page).getByRole('textbox', { name: 'Restaurant', exact: true });

function dishCount(db: Database.Database, householdId: number): number {
	return db
		.prepare('select count(*) from dishes where household_id = ?')
		.pluck()
		.get(householdId) as number;
}

test('says when there are no requests, on every week', async ({ page, person: _ }) => {
	await page.goto('/menu');
	await expect(requestsSection(page).getByText('No requests yet.')).toBeVisible();
	await page.goto(`/menu?week=${addDays(today(), 21)}`);
	await expect(requestsSection(page).getByText('No requests yet.')).toBeVisible();
});

test('requests a dish from Recipes, linked, with who asked and the note', async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	await sheet.getByRole('combobox', { name: 'Dish' }).fill('las');
	await sheet.getByRole('option', { name: 'Lasagna' }).click();
	await sheet.getByLabel('Note (optional)').fill('For Sunday, please');
	await sheet.getByRole('button', { name: 'Request', exact: true }).click();
	await expect(sheet).toHaveCount(0);

	const section = requestsSection(page);
	const link = section.getByRole('link', { name: 'Lasagna' });
	await expect(link).toHaveAttribute('href', `/recipes/${lasagna}`);
	// A full-size tap target, so a tap meant for it doesn't land on the note (MEA-170).
	expect(await tapSize(link)).toBeGreaterThanOrEqual(44);
	await expect(section.getByText('For Sunday, please')).toBeVisible();
	await expect(section.getByText(/^Asked by Person \d+$/)).toBeVisible();
	await expect(section.getByText('No requests yet.')).toHaveCount(0);
	expect(dishCount(db, person.householdId)).toBe(1);
});

test('requests a new name, adding it to Recipes and linking to it', async ({
	page,
	db,
	person
}) => {
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	await sheet.getByRole('combobox', { name: 'Dish' }).fill('Shrimp boil');
	await sheet.getByRole('option', { name: 'Add “Shrimp boil” as a new dish' }).click();
	await sheet.getByRole('button', { name: 'Request', exact: true }).click();
	await expect(sheet).toHaveCount(0);

	const dish = db
		.prepare('select id, servings from dishes where household_id = ? and name = ?')
		.get(person.householdId, 'Shrimp boil') as { id: number; servings: number };
	expect(dish.servings).toBe(4);
	const link = requestsSection(page).getByRole('link', { name: 'Shrimp boil' });
	await expect(link).toHaveAttribute('href', `/recipes/${dish.id}`);
	await link.click();
	await expect(page.getByRole('heading', { name: 'Shrimp boil' })).toBeVisible();
	await page.goto('/recipes');
	await expect(page.getByRole('link', { name: /Shrimp boil/ })).toContainText('No recipe');
});

test('offers to restore an archived dish typed in a request', async ({ page, db, person }) => {
	const chili = addRecipe(db, person.householdId, { name: 'Chili', archived: true });
	const archived = () =>
		db.prepare('select archived_at is not null from dishes where id = ?').pluck().get(chili);
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	const dishField = sheet.getByRole('combobox', { name: 'Dish' });
	await dishField.fill('chili');
	await sheet.getByLabel('Note (optional)').fill('Extra beans');
	await sheet.getByRole('button', { name: 'Request', exact: true }).click();

	// Cancel adds nothing and goes back to the request.
	const dialog = page.getByRole('dialog', { name: 'Chili' });
	await expect(dialog).toContainText('Chili is archived. Restore it and request it?');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(dishField).toHaveValue('chili');
	await expect(requestsSection(page).getByText('No requests yet.')).toBeVisible();
	expect(archived()).toBe(1);

	await sheet.getByRole('button', { name: 'Request', exact: true }).click();
	await dialog.getByRole('button', { name: 'Restore it and request' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(sheet).toHaveCount(0);
	const section = requestsSection(page);
	await expect(section.getByRole('link', { name: 'chili' })).toHaveAttribute(
		'href',
		`/recipes/${chili}`
	);
	await expect(section.getByText('Extra beans')).toBeVisible();
	expect(archived()).toBe(0);
	expect(dishCount(db, person.householdId)).toBe(1);
});

test('stops the dish at 80 characters and the note at 200, typed or pasted', async ({
	page,
	person: _
}) => {
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	const dish = sheet.getByRole('combobox', { name: 'Dish' });
	const note = sheet.getByLabel('Note (optional)');
	const dishFull = sheet.getByText("You've reached the 80-character limit.");
	const noteFull = sheet.getByText("You've reached the 200-character limit.");

	await dish.click();
	await page.keyboard.insertText('a'.repeat(79));
	await expect(dishFull).toHaveCount(0);
	await page.keyboard.type('bcd');
	await expect(dish).toHaveValue(`${'a'.repeat(79)}b`);
	await expect(dishFull).toBeVisible();
	await page.keyboard.press('Backspace');
	await expect(dishFull).toHaveCount(0);
	await page.keyboard.insertText('x'.repeat(30));
	await expect(dish).toHaveValue(`${'a'.repeat(79)}x`);
	await expect(dishFull).toBeVisible();
	// It shows between the field and the new-dish option, which never covers it (MEA-151).
	await expect(sheet.getByRole('option', { name: /as a new dish$/ })).toBeVisible();
	expect(await uncovered(dishFull)).toBe(true);

	// Tab goes to the note, as when typing.
	await page.keyboard.press('Tab');
	await expect(note).toBeFocused();
	await page.keyboard.insertText('n'.repeat(250));
	await expect(note).toHaveValue('n'.repeat(200));
	await expect(noteFull).toBeVisible();
	await page.keyboard.type('more');
	await expect(note).toHaveValue('n'.repeat(200));
});

test('needs a dish name', async ({ page, person: _ }) => {
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	const dish = sheet.getByRole('combobox', { name: 'Dish' });
	// Past the browser's own check, so the server's message shows.
	await dish.fill('   ');
	await sheet.getByRole('button', { name: 'Request', exact: true }).click();
	await expect(sheet.getByRole('alert')).toHaveText('Enter a dish name');
});

/** Eight dishes with "rice" in their names, one of them Rice itself, whose id it returns. */
function addRiceDishes(db: Database.Database, householdId: number): number {
	const rice = addRecipe(db, householdId, { name: 'Rice' });
	for (const name of [
		'Rice and beans',
		'Rice noodles',
		'Rice pudding',
		'Rice salad',
		'Brown rice',
		'Fried rice',
		'Wild rice'
	]) {
		addRecipe(db, householdId, { name });
	}
	return rice;
}

/** Waits for a sheet to finish sliding up, so what's in it stays where it is. */
async function slidUp(sheet: Locator) {
	await sheet.evaluate(async (element) => {
		await Promise.all(element.getAnimations().map((animation) => animation.finished));
	});
}

test('shows the dish suggestions in the request sheet under the field, with Note and Request uncovered and in place (MEA-151)', async ({
	page,
	db,
	person
}) => {
	const rice = addRiceDishes(db, person.householdId);
	await open(page, '/menu');
	await openRequestSheet(page);
	const sheet = requestSheet(page);
	const dish = sheet.getByRole('combobox', { name: 'Dish' });
	const note = sheet.getByLabel('Note (optional)');
	const request = sheet.getByRole('button', { name: 'Request', exact: true });
	await slidUp(sheet);
	const noteBefore = await note.boundingBox();
	const requestBefore = await request.boundingBox();

	// They show in the sheet under the field, about four at a time with the rest scrolling. On a
	// phone the sheet grows upward to fit them, so Note and Request stay where they were.
	await dish.fill('ric');
	const list = sheet.getByRole('listbox');
	await expect(list.getByRole('option')).toHaveCount(9);
	const field = await dish.boundingBox();
	const shown = await list.boundingBox();
	expect(shown?.y).toBeGreaterThan((field?.y ?? 0) + (field?.height ?? 0));
	expect((shown?.y ?? 0) + (shown?.height ?? 0)).toBeLessThan(noteBefore?.y ?? 0);
	expect(shown?.y).toBeGreaterThan((await sheet.boundingBox())?.y ?? 0);
	expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	expect(await note.boundingBox()).toEqual(noteBefore);
	expect(await request.boundingBox()).toEqual(requestBefore);
	expect(await uncovered(note)).toBe(true);
	expect(await uncovered(request)).toBe(true);

	// A tap on Note goes there.
	await note.tap();
	await expect(note).toBeFocused();
	await expect(list).toHaveCount(0);
	await note.fill('For Sunday, please');

	// A tap on Request asks for the dish typed, not a suggestion where Request is.
	await dish.fill('Rice');
	await expect(list.getByRole('option')).toHaveCount(8);
	expect(await request.boundingBox()).toEqual(requestBefore);
	await request.tap();
	await expect(sheet).toHaveCount(0);
	const section = requestsSection(page);
	await expect(section.getByRole('listitem')).toHaveCount(1);
	await expect(section.getByRole('link', { name: 'Rice', exact: true })).toHaveAttribute(
		'href',
		`/recipes/${rice}`
	);
	await expect(section.getByText('For Sunday, please')).toBeVisible();
});

test.describe('the dish request sheet on a computer', () => {
	test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

	test('takes a click on Note, Close or Request while the dish suggestions show, though the centered sheet shrinks as they close (MEA-151)', async ({
		page,
		db,
		person
	}) => {
		const rice = addRiceDishes(db, person.householdId);
		await open(page, '/menu');
		await openRequestSheet(page);
		const sheet = requestSheet(page);
		const dish = sheet.getByRole('combobox', { name: 'Dish' });
		const note = sheet.getByLabel('Note (optional)');
		const list = sheet.getByRole('listbox');

		// Leaving the field closes them once the click is done, so it lands on Note rather than
		// on the backdrop, which would close the sheet.
		await dish.fill('ric');
		await expect(list.getByRole('option')).toHaveCount(9);
		await note.click();
		await expect(note).toBeFocused();
		await expect(list).toHaveCount(0);
		await expect(sheet).toBeVisible();
		await page.keyboard.type('For Sunday, please');

		// Tab closes them straight away.
		await dish.fill('ric');
		await expect(list.getByRole('option')).toHaveCount(9);
		await page.keyboard.press('Tab');
		await expect(note).toBeFocused();
		await expect(list).toHaveCount(0);

		// Close lands too, with only the new-dish option showing.
		await dish.fill('Rice bowl');
		await expect(list.getByRole('option')).toHaveText(['Add “Rice bowl” as a new dish']);
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(sheet).toHaveCount(0);

		// So does Request, which asks for the dish typed.
		await openRequestSheet(page);
		await dish.fill('Rice');
		await expect(list.getByRole('option')).toHaveCount(8);
		await sheet.getByRole('button', { name: 'Request', exact: true }).click();
		await expect(sheet).toHaveCount(0);
		const section = requestsSection(page);
		await expect(section.getByRole('link', { name: 'Rice', exact: true })).toHaveAttribute(
			'href',
			`/recipes/${rice}`
		);
		await expect(section.getByText('For Sunday, please')).toBeVisible();
	});
});

test('removes a request for everyone, keeping its recipe', async ({ page, db, person }) => {
	const insert = db.prepare(
		'insert into dish_requests (household_id, user_id, name, note, dish_id, created_at) values (?, ?, ?, null, ?, ?)'
	);
	for (const [name, at] of [['Gumbo', 1], ['Chili', 2]] as const) {
		const dishId = addRecipe(db, person.householdId, { name });
		insert.run(person.householdId, person.userId, name, dishId, at);
	}
	await page.goto('/menu');
	const section = requestsSection(page);
	await expect(section.getByRole('listitem')).toHaveText([/^Gumbo/, /^Chili/]);
	await section.getByRole('button', { name: 'Remove Gumbo' }).click();
	await expect(section.getByRole('listitem')).toHaveText([/^Chili/]);
	await section.getByRole('button', { name: 'Remove Chili' }).click();
	await expect(section.getByText('No requests yet.')).toBeVisible();
	expect(
		db
			.prepare('select count(*) from dish_requests where household_id = ?')
			.pluck()
			.get(person.householdId)
	).toBe(0);
	expect(dishCount(db, person.householdId)).toBe(2);
});

test('requests a restaurant by name, listed after an older dish request, and removes it', async ({
	page,
	db,
	person
}) => {
	const gumbo = addRecipe(db, person.householdId, { name: 'Gumbo' });
	db.prepare(
		'insert into dish_requests (household_id, user_id, name, note, dish_id, created_at) values (?, ?, ?, null, ?, 1)'
	).run(person.householdId, person.userId, 'Gumbo', gumbo);
	await open(page, '/menu');
	await openRestaurantSheet(page);
	await restaurantField(page).fill('Olive Garden');
	await restaurantSheet(page).getByLabel('Note (optional)').fill('For her birthday');
	await restaurantSheet(page).getByRole('button', { name: 'Request', exact: true }).click();
	await expect(restaurantSheet(page)).toHaveCount(0);

	const section = requestsSection(page);
	await expect(section.getByRole('listitem')).toHaveText([/^Gumbo/, /^Eating out/]);
	const restaurant = section.getByRole('listitem').nth(1);
	await expect(restaurant.getByText('Olive Garden', { exact: true })).toBeVisible();
	await expect(restaurant.getByRole('link')).toHaveCount(0);
	await expect(restaurant.getByText('For her birthday')).toBeVisible();
	await expect(restaurant.getByText(/^Asked by Person \d+$/)).toBeVisible();
	await expect(section.getByRole('button', { name: 'Request a restaurant' })).toBeFocused();
	// It looks up and makes no dish.
	expect(dishCount(db, person.householdId)).toBe(1);

	await section.getByRole('button', { name: 'Remove Olive Garden' }).click();
	await expect(section.getByRole('listitem')).toHaveText([/^Gumbo/]);
	expect(
		db
			.prepare('select name from dish_requests where household_id = ?')
			.pluck()
			.all(person.householdId)
	).toEqual(['Gumbo']);

	// Menu help tells people about it.
	await page.getByRole('banner').getByRole('button', { name: 'Help', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Help: Menu' })).toContainText(
		'Request a dish or Request a restaurant to add one'
	);
});

test('stops the restaurant at 80 characters and the note at 200, and needs a name', async ({
	page,
	person: _
}) => {
	await open(page, '/menu');
	await openRestaurantSheet(page);
	const sheet = restaurantSheet(page);
	const name = restaurantField(page);
	const note = sheet.getByLabel('Note (optional)');
	const nameFull = sheet.getByText("You've reached the 80-character limit.");
	const noteFull = sheet.getByText("You've reached the 200-character limit.");

	await name.click();
	await page.keyboard.insertText('a'.repeat(79));
	await expect(nameFull).toHaveCount(0);
	await page.keyboard.type('bcd');
	await expect(name).toHaveValue(`${'a'.repeat(79)}b`);
	await expect(nameFull).toBeVisible();
	await page.keyboard.press('Backspace');
	await expect(nameFull).toHaveCount(0);
	await page.keyboard.insertText('x'.repeat(30));
	await expect(name).toHaveValue(`${'a'.repeat(79)}x`);
	await expect(nameFull).toBeVisible();

	await note.click();
	await page.keyboard.insertText('n'.repeat(250));
	await expect(note).toHaveValue('n'.repeat(200));
	await expect(noteFull).toBeVisible();
	await page.keyboard.type('more');
	await expect(note).toHaveValue('n'.repeat(200));

	// Past the browser's own check, so the server's message shows.
	await name.fill('   ');
	await sheet.getByRole('button', { name: 'Request', exact: true }).click();
	await expect(sheet.getByRole('alert')).toHaveText('Enter a restaurant name');
	await expect(requestsSection(page).getByText('No requests yet.')).toBeVisible();
});

test('stays on the week shown after requesting a restaurant', async ({ page, person: _ }) => {
	const sunday = sundayOf(addDays(today(), 21));
	await open(page, `/menu?week=${sunday}`);
	await openRestaurantSheet(page);
	await restaurantField(page).fill('Olive Garden');
	await restaurantSheet(page).getByRole('button', { name: 'Request', exact: true }).click();
	await expect(restaurantSheet(page)).toHaveCount(0);
	await expect(requestsSection(page).getByText('Olive Garden', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sunday}$`));
	await expect(page.getByRole('navigation', { name: 'Weeks' }).locator('.label')).toHaveText(
		weekRange(sunday)
	);
	await expect(day(page, sunday)).toBeVisible();
});

// Requests on a date's page (design 6.12; 7, Dinner), under its dinners.

/** A request from the person, written straight to the database, and its id. */
function askFor(
	db: Database.Database,
	person: { userId: number; householdId: number },
	name: string,
	fields: { dishId?: number; note?: string; at?: number } = {}
): number {
	return Number(
		db
			.prepare(
				'insert into dish_requests (household_id, user_id, kind, name, note, dish_id, created_at) values (?, ?, ?, ?, ?, ?, ?)'
			)
			.run(
				person.householdId,
				person.userId,
				fields.dishId === undefined ? 'restaurant' : 'dish',
				name,
				fields.note ?? null,
				fields.dishId ?? null,
				fields.at ?? 1
			).lastInsertRowid
	);
}

function requestIds(db: Database.Database, householdId: number) {
	return db
		.prepare('select id from dish_requests where household_id = ? order by id')
		.pluck()
		.all(householdId);
}

function labelDinner(db: Database.Database, dinnerId: number, label: string) {
	db.prepare('update dinners set label = ? where id = ?').run(label, dinnerId);
}

test("lists the requests under a day's dinners, and adds one to the dinner that can have it", async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	const gumbo = addRecipe(db, person.householdId, { name: 'Gumbo' });
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const date = addDays(today(), 1);
	const dinnerId = addDinner(db, person.householdId, date, {
		note: 'Grandma visits',
		dishes: [[tacos, 'main']]
	});
	askFor(db, person, 'Lasagna', { dishId: lasagna, note: 'Extra cheese', at: 1 });
	askFor(db, person, 'Olive Garden', { note: 'For her birthday', at: 2 });
	askFor(db, person, 'Gumbo', { dishId: gumbo, at: 3 });
	await open(page, `/menu/${date}`);

	const section = requestsSection(page);
	await expect(section.getByRole('listitem')).toHaveText([/^Lasagna/, /^Eating out/, /^Gumbo/]);
	const first = section.getByRole('listitem').first();
	const link = first.getByRole('link', { name: 'Lasagna' });
	await expect(link).toHaveAttribute('href', `/recipes/${lasagna}`);
	// A full-size tap target, as on the week (MEA-170).
	expect(await tapSize(link)).toBeGreaterThanOrEqual(44);
	await expect(first.getByText('Extra cheese')).toBeVisible();
	await expect(first.getByText(/^Asked by Person \d+$/)).toBeVisible();
	// A restaurant request shows too, with its own Add.
	const restaurant = section.getByRole('listitem').nth(1);
	await expect(restaurant.getByText('Olive Garden', { exact: true })).toBeVisible();
	await expect(restaurant.getByText('For her birthday')).toBeVisible();
	await expect(restaurant.getByRole('link')).toHaveCount(0);
	await expect(restaurant.getByRole('button')).toHaveAccessibleName('Add Olive Garden');
	// Under the dinner.
	const dishesBox = await dishSection(page).boundingBox();
	const requestsBox = await section.boundingBox();
	expect(requestsBox!.y).toBeGreaterThan(dishesBox!.y + dishesBox!.height);

	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	// It says so where the request was, and reads it out.
	await expect(section.getByText('Added Lasagna.', { exact: true })).toBeFocused();
	await expect(section.getByRole('listitem')).toHaveText([/^Eating out/, /^Gumbo/]);
	await expect(dishLinks(page)).toHaveText(['Chicken tacos', 'Lasagna']);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue(
		'Grandma visits\nExtra cheese'
	);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		id: dinnerId,
		note: 'Grandma visits\nExtra cheese'
	});

	// The second dish is a Side, and its role can change.
	const role = page.getByLabel('Role for Lasagna');
	await expect(role).toHaveValue('side');
	await role.selectOption('dessert');
	await expect
		.poll(() => dinnerDishes(db, dinnerId))
		.toEqual([
			{ name: 'Chicken tacos', role: 'main' },
			{ name: 'Lasagna', role: 'dessert' }
		]);

	// Dinner help tells people about it.
	await page.getByRole('banner').getByRole('button', { name: 'Help', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Help: Dinner' })).toContainText(
		'Add puts a requested dish or restaurant on this day'
	);
	await page.keyboard.press('Escape');

	// Its recipe stays, and the week's list no longer has it.
	expect(dishCount(db, person.householdId)).toBe(3);
	await open(page, '/menu');
	await expect(requestsSection(page).getByRole('listitem')).toHaveText([/^Eating out/, /^Gumbo/]);
});

test('asks which dinner when several can have dishes, and labels a new one when none can', async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	const gumbo = addRecipe(db, person.householdId, { name: 'Gumbo' });
	askFor(db, person, 'Lasagna', { dishId: lasagna, at: 1 });
	askFor(db, person, 'Gumbo', { dishId: gumbo, note: 'Mild', at: 2 });
	const section = requestsSection(page);

	// Two dinners that can have dishes: the person picks one.
	const two = addDays(today(), 1);
	const adults = addDinner(db, person.householdId, two, { type: 'going' });
	const kids = addDinner(db, person.householdId, two);
	labelDinner(db, adults, 'Adults');
	labelDinner(db, kids, 'Kids');
	await open(page, `/menu/${two}`);
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	const pick = page.getByRole('dialog', { name: 'Add Lasagna' });
	await expect(pick).toContainText('Which dinner should it go on?');
	await expect(pick.getByRole('button', { name: 'Adults' })).toBeVisible();
	await pick.getByRole('button', { name: 'Kids' }).click();
	await expect(pick).toBeHidden();
	await expect(section.getByText('Added Lasagna to Kids.', { exact: true })).toBeFocused();
	await expect(
		page
			.getByRole('region', { name: 'Kids' })
			.getByRole('region', { name: 'Dishes' })
			.getByRole('link')
	).toHaveText(['Lasagna']);
	expect(dinnerDishes(db, kids)).toEqual([{ name: 'Lasagna', role: 'main' }]);
	expect(dinnerDishes(db, adults)).toEqual([]);

	// One dinner that can't have dishes: a new Cooking at home dinner, asking for both labels.
	const one = addDays(today(), 2);
	addDinner(db, person.householdId, one, { type: 'eat_out', note: 'Pizza' });
	await open(page, `/menu/${one}`);
	await section.getByRole('button', { name: 'Add Gumbo' }).click();
	const labels = page.getByRole('dialog', { name: 'Add Gumbo' });
	await expect(labels).toContainText(
		"This day's dinner can't have dishes, so Gumbo goes on a new Cooking at home dinner."
	);
	await labels.getByLabel('Label for the dinner already planned').fill('Adults');
	await labels.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(labels.getByRole('alert')).toHaveText('Enter a label for each dinner');
	expect(requestIds(db, person.householdId)).toHaveLength(1);
	await labels.getByLabel('Label for the new dinner').fill('Kids');
	await labels.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(labels).toBeHidden();
	await expect(section.getByText('Added Gumbo to Kids.', { exact: true })).toBeFocused();
	const newKids = page.getByRole('region', { name: 'Kids' });
	await expect(
		newKids.getByRole('button', { name: 'Cooking at home', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(newKids.getByRole('region', { name: 'Dishes' }).getByRole('link')).toHaveText([
		'Gumbo'
	]);
	await expect(newKids.getByLabel('Note', { exact: true })).toHaveValue('Mild');
	await expect(
		page.getByRole('region', { name: 'Adults' }).getByLabel('Note', { exact: true })
	).toHaveValue('Pizza');
	await expect(section.getByText('No requests yet.')).toBeVisible();
});

test("plans a day with no dinner, and changes nothing when a request can't go on the day", async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	const request = askFor(db, person, 'Lasagna', { dishId: lasagna, note: 'Extra cheese' });
	const section = requestsSection(page);

	// Five dinners, none of which can have dishes.
	const full = addDays(today(), 1);
	for (const label of ['A', 'B', 'C', 'D', 'E']) {
		labelDinner(db, addDinner(db, person.householdId, full, { type: 'eat_out' }), label);
	}
	await open(page, `/menu/${full}`);
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	await expect(section.getByRole('alert')).toHaveText(
		'This day already has 5 dinners, and none can have dishes. Switch one to Cooking at home or Bringing a dish to add dishes.'
	);
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// The dish is already on the day's dinner.
	const twice = addDays(today(), 2);
	addDinner(db, person.householdId, twice, { dishes: [[lasagna, 'main']] });
	await open(page, `/menu/${twice}`);
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	await expect(section.getByRole('alert')).toHaveText('Lasagna is already on this dinner');
	await expect(dishLinks(page)).toHaveText(['Lasagna']);
	expect(requestIds(db, person.householdId)).toEqual([request]);

	// A day with no dinner is planned as Cooking at home, at the usual servings.
	const empty = addDays(today(), 3);
	await open(page, `/menu/${empty}`);
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	await expect(section.getByText('Added Lasagna.', { exact: true })).toBeFocused();
	await expect(dishLinks(page)).toHaveText(['Lasagna']);
	await expect(page.getByText('Not planned yet.')).toHaveCount(0);
	await expect(dateButton(page)).toBeVisible();
	expect(dinnerRow(db, person.householdId, empty)).toMatchObject({
		type: 'cook',
		note: 'Extra cheese',
		servings: 4
	});
	await expect(section.getByText('No requests yet.')).toBeVisible();
});

test('adds a request tapped while the type planning the day is on its way to the dinner it planned', async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	askFor(db, person, 'Lasagna', { dishId: lasagna, note: 'Extra cheese' });
	const section = requestsSection(page);
	const date = addDays(today(), 1);
	await open(page, `/menu/${date}`);
	const typeAnswered = await holdAnswers(page, (url) => url.search === '?/type');
	await typeButton(page, 'Bringing a dish').click();
	await expect.poll(() => dinnerRow(db, person.householdId, date)?.type).toBe('going');
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	typeAnswered();

	await expect(section.getByText('Added Lasagna.', { exact: true })).toBeFocused();
	await expect(dishLinks(page)).toHaveText(['Lasagna']);
	await expect(typeButton(page, 'Bringing a dish')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(dinnerRows(db, person.householdId, date)).toEqual([
		expect.objectContaining({ type: 'going', note: 'Extra cheese' })
	]);
	await expect(section.getByText('No requests yet.')).toBeVisible();
});

test("keeps what was typed, with the request's note on the end of a typed note", async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	const gumbo = addRecipe(db, person.householdId, { name: 'Gumbo' });
	askFor(db, person, 'Lasagna', { dishId: lasagna, note: 'Extra cheese', at: 1 });
	const gumboRequest = askFor(db, person, 'Gumbo', { dishId: gumbo, at: 2 });
	const date = addDays(today(), 1);
	addDinner(db, person.householdId, date, { note: 'Grandma visits' });
	await open(page, `/menu/${date}`);
	const note = page.getByLabel('Note', { exact: true });
	const servings = page.getByLabel('Servings', { exact: true });
	await note.fill('Grandma and Grandpa visit');
	await servings.fill('6');
	const section = requestsSection(page);
	await section.getByRole('button', { name: 'Add Lasagna' }).click();
	await expect(dishLinks(page)).toHaveText(['Lasagna']);
	await expect(note).toHaveValue('Grandma and Grandpa visit\nExtra cheese');
	await expect(servings).toHaveValue('6');
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		note: 'Grandma visits\nExtra cheese',
		servings: 4
	});

	// Someone else removed the other request meanwhile.
	db.prepare('delete from dish_requests where id = ?').run(gumboRequest);
	await section.getByRole('button', { name: 'Add Gumbo' }).click();
	await expect(section.getByRole('alert')).toHaveText(
		'Someone removed that request, so nothing was added.'
	);
	await expect(section.getByText('No requests yet.')).toBeVisible();
	await expect(dishLinks(page)).toHaveText(['Lasagna']);
	await expect(note).toHaveValue('Grandma and Grandpa visit\nExtra cheese');

	await saveToWeek(page, date);
	expect(dinnerRow(db, person.householdId, date)).toMatchObject({
		note: 'Grandma and Grandpa visit\nExtra cheese',
		servings: 6
	});
});

test("fits a day's requests on a phone, and shows them on a computer", async ({
	page,
	db,
	person
}) => {
	const long = 'Grandmas'.repeat(10);
	const dishId = addRecipe(db, person.householdId, { name: long });
	askFor(db, person, long, { dishId, note: 'n'.repeat(200) });
	await open(page, `/menu/${addDays(today(), 1)}`);
	await expect(requestsSection(page).getByRole('link', { name: long })).toBeVisible();
	expect(await sideways(page)).toBe(0);

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(requestsSection(page).getByRole('button', { name: `Add ${long}` })).toBeVisible();
	expect(await sideways(page)).toBe(0);
});

test('adds a requested restaurant to a day with no dinner, as Eating out there with its note', async ({
	page,
	db,
	person
}) => {
	const lasagna = addRecipe(db, person.householdId, { name: 'Lasagna' });
	askFor(db, person, 'Lasagna', { dishId: lasagna, at: 1 });
	askFor(db, person, 'Olive Garden', { note: 'For her birthday', at: 2 });
	const date = addDays(today(), 1);
	await open(page, `/menu/${date}`);
	const section = requestsSection(page);
	const note = page.getByLabel('Note', { exact: true });
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	// Typed and not saved, so it waits for Save, with the request's note on its end.
	await note.fill('Dress up');

	await section.getByRole('button', { name: 'Add Olive Garden' }).click();
	await expect(section.getByText('Added Olive Garden.', { exact: true })).toBeFocused();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByText('Not planned yet.')).toHaveCount(0);
	await expect(dateButton(page)).toBeVisible();
	await expect(typeButton(page, 'Eating out')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Restaurant', { exact: true })).toHaveValue('Olive Garden');
	await expect(note).toHaveValue('Dress up\nFor her birthday');
	await expect(section.getByRole('listitem')).toHaveText([/^Lasagna/]);
	expect(dinnerRows(db, person.householdId, date)).toEqual([
		{
			id: expect.any(Number),
			label: null,
			type: 'eat_out',
			restaurant: 'Olive Garden',
			note: 'For her birthday'
		}
	]);

	// Save keeps both notes, and the week shows the restaurant, without the request.
	await saveToWeek(page, date);
	await expect(day(page, date).locator('.restaurant-name')).toHaveText('Olive Garden');
	await expect(day(page, date).locator('.note')).toHaveText('Dress up\nFor her birthday');
	expect(dinnerRows(db, person.householdId, date)).toMatchObject([
		{ restaurant: 'Olive Garden', note: 'Dress up\nFor her birthday' }
	]);
	await expect(requestsSection(page).getByRole('listitem')).toHaveText([/^Lasagna/]);
});

test("asks for labels to add a requested restaurant beside a day's dinners, up to 5", async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	askFor(db, person, 'Olive Garden', { note: 'For her birthday', at: 1 });
	askFor(db, person, 'Taco Bar', { at: 2 });
	const section = requestsSection(page);

	// One dinner: it keeps its type, dishes and note, and both dinners get labels.
	const one = addDays(today(), 1);
	const home = addDinner(db, person.householdId, one, {
		note: 'Grandma visits',
		dishes: [[tacos, 'main']]
	});
	await open(page, `/menu/${one}`);
	await section.getByRole('button', { name: 'Add Olive Garden' }).click();
	const labels = page.getByRole('dialog', { name: 'Add Olive Garden' });
	await expect(labels).toContainText(
		'Olive Garden goes on a new Eating out dinner. Give each dinner a label, such as Kids or Adults.'
	);
	await labels.getByLabel('Label for the dinner already planned').fill('Kids');
	await labels.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(labels.getByRole('alert')).toHaveText('Enter a label for each dinner');
	expect(requestIds(db, person.householdId)).toHaveLength(2);
	await labels.getByLabel('Label for the new dinner').fill('Adults');
	await labels.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(labels).toBeHidden();
	await expect(section.getByText('Added Olive Garden to Adults.', { exact: true })).toBeFocused();
	const adults = page.getByRole('region', { name: 'Adults' });
	await expect(
		adults.getByRole('button', { name: 'Eating out', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(adults.getByLabel('Restaurant', { exact: true })).toHaveValue('Olive Garden');
	await expect(adults.getByLabel('Note', { exact: true })).toHaveValue('For her birthday');
	const kids = page.getByRole('region', { name: 'Kids' });
	await expect(
		kids.getByRole('button', { name: 'Cooking at home', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(kids.getByRole('region', { name: 'Dishes' }).getByRole('link')).toHaveText([
		'Chicken tacos'
	]);
	await expect(kids.getByLabel('Note', { exact: true })).toHaveValue('Grandma visits');
	expect(dinnerRows(db, person.householdId, one)).toEqual([
		{ id: home, label: 'Kids', type: 'cook', restaurant: null, note: 'Grandma visits' },
		{
			id: expect.any(Number),
			label: 'Adults',
			type: 'eat_out',
			restaurant: 'Olive Garden',
			note: 'For her birthday'
		}
	]);
	expect(dinnerDishes(db, home)).toEqual([{ name: 'Chicken tacos', role: 'main' }]);

	// Four dinners: only the new one needs a label, and it's the day's fifth.
	const four = addDays(today(), 2);
	for (const label of ['A', 'B', 'C', 'D']) {
		labelDinner(db, addDinner(db, person.householdId, four, { type: 'leftovers' }), label);
	}
	await open(page, `/menu/${four}`);
	await section.getByRole('button', { name: 'Add Taco Bar' }).click();
	const fifth = page.getByRole('dialog', { name: 'Add Taco Bar' });
	await expect(fifth).toContainText(
		'Taco Bar goes on a new Eating out dinner. Give it a label, such as Kids or Adults.'
	);
	await expect(fifth.getByLabel('Label for the dinner already planned')).toHaveCount(0);
	await fifth.getByLabel('Label for the new dinner').fill('E');
	await fifth.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(section.getByText('Added Taco Bar to E.', { exact: true })).toBeFocused();
	const fiveDinners = dinnerRows(db, person.householdId, four);
	expect(fiveDinners.map(({ label, type, restaurant }) => [label, type, restaurant])).toEqual([
		['A', 'leftovers', null],
		['B', 'leftovers', null],
		['C', 'leftovers', null],
		['D', 'leftovers', null],
		['E', 'eat_out', 'Taco Bar']
	]);
	await expect(page.getByRole('button', { name: 'Add a dinner' })).toHaveCount(0);
	await expect(section.getByText('No requests yet.')).toBeVisible();
});

test("changes nothing when a requested restaurant can't go on the day", async ({
	page,
	db,
	person
}) => {
	const kept = askFor(db, person, 'Olive Garden', { at: 1 });
	const removed = askFor(db, person, 'Taco Bar', { at: 2 });
	const section = requestsSection(page);

	// Five dinners, the most a day can have.
	const full = addDays(today(), 1);
	for (const label of ['A', 'B', 'C', 'D', 'E']) {
		labelDinner(db, addDinner(db, person.householdId, full, { type: 'eat_out' }), label);
	}
	const before = dinnerRows(db, person.householdId, full);
	await open(page, `/menu/${full}`);
	await section.getByRole('button', { name: 'Add Olive Garden' }).click();
	await expect(section.getByRole('alert')).toHaveText(
		'This day already has 5 dinners. Clear one to add another.'
	);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(dinnerRows(db, person.householdId, full)).toEqual(before);
	expect(requestIds(db, person.householdId)).toEqual([kept, removed]);

	// Someone else removed it after the page opened.
	const empty = addDays(today(), 2);
	await open(page, `/menu/${empty}`);
	db.prepare('delete from dish_requests where id = ?').run(removed);
	await section.getByRole('button', { name: 'Add Taco Bar' }).click();
	await expect(section.getByRole('alert')).toHaveText(
		'Someone removed that request, so nothing was added.'
	);
	await expect(section.getByRole('listitem')).toHaveText([/^Eating out/]);
	await expect(section.getByRole('button', { name: 'Add Olive Garden' })).toBeVisible();
	await expect(page.getByText('Not planned yet.')).toBeVisible();
	expect(dinnerRows(db, person.householdId, empty)).toEqual([]);
	expect(requestIds(db, person.householdId)).toEqual([kept]);
});

test('fits a long requested restaurant on a phone and a computer, on the day and the week', async ({
	page,
	db,
	person
}) => {
	// 80 characters without a space, the longest a restaurant can be.
	const long = `${'Trattoria'.repeat(8)}Romanaaa`;
	askFor(db, person, long, { note: 'n'.repeat(200) });
	const date = addDays(today(), 1);
	const restaurant = page.getByLabel('Restaurant', { exact: true });
	await open(page, `/menu/${date}`);
	await requestsSection(page).getByRole('button', { name: `Add ${long}` }).click();
	await expect(restaurant).toHaveValue(long);
	expect(await sideways(page)).toBe(0);
	await page.getByRole('link', { name: /^‹ Week of/ }).click();
	await expect(day(page, date).locator('.restaurant-name')).toHaveText(long);
	expect(await sideways(page)).toBe(0);

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(day(page, date).locator('.restaurant-name')).toBeVisible();
	expect(await sideways(page)).toBe(0);
	await day(page, date).click();
	await expect(restaurant).toHaveValue(long);
	expect(await sideways(page)).toBe(0);
});

test('plans two dinners on a day, each with its own label, dishes, Save and Clear (6.9)', async ({
	page,
	db,
	person
}) => {
	const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
	const date = addDays(today(), 1);
	const adultsId = addDinner(db, person.householdId, date, {
		note: 'After bedtime',
		dishes: [[tacos, 'main']]
	});
	const labels = () =>
		db
			.prepare('select label from dinners where household_id = ? and date = ? order by id')
			.pluck()
			.all(person.householdId, date);

	// Not offered on a date that isn't planned.
	await open(page, `/menu/${addDays(today(), 2)}`);
	await expect(page.getByText('Not planned yet.', { exact: false })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add a dinner' })).toHaveCount(0);

	// The second dinner asks for both labels at once.
	await open(page, `/menu/${date}`);
	await expect(page.getByLabel('Label', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Add a dinner' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add a dinner' });
	await sheet.getByLabel('Label for the dinner already planned').fill('Adults');
	await sheet.getByRole('button', { name: 'Add dinner' }).click();
	await expect(sheet.getByRole('alert')).toHaveText('Enter a label for each dinner');
	await sheet.getByLabel('Label for the new dinner').fill('Kids');
	await sheet.getByRole('button', { name: 'Add dinner' }).click();
	await expect(sheet).toBeHidden();

	const adults = page.getByRole('region', { name: 'Adults' });
	const kids = page.getByRole('region', { name: 'Kids' });
	await expect(kids.getByRole('heading', { name: 'Kids' })).toBeFocused();
	// A line above the second dinner sets it apart from the first.
	await expect(kids).toHaveCSS('border-top-style', 'solid');
	await expect(adults.getByRole('region', { name: 'Dishes' }).getByRole('link')).toHaveText([
		'Chicken tacos'
	]);
	// A new dinner starts as Cooking at home with the usual servings, no note and no dishes.
	await expect(
		kids.getByRole('button', { name: 'Cooking at home', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(kids.getByLabel('Servings', { exact: true })).toHaveValue('4');
	await expect(kids.getByLabel('Note', { exact: true })).toHaveValue('');
	await expect(kids).toContainText('No dishes yet.');
	expect(labels()).toEqual(['Adults', 'Kids']);

	// A dish added to one dinner goes on that one only.
	await kids.getByRole('combobox', { name: 'Add a dish' }).fill('Mac and cheese');
	await page.getByRole('option', { name: 'Add “Mac and cheese” as a new dish' }).click();
	await kids.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(kids.getByRole('region', { name: 'Dishes' }).getByRole('link')).toHaveText([
		'Mac and cheese'
	]);
	await expect(adults.getByRole('region', { name: 'Dishes' }).getByRole('link')).toHaveText([
		'Chicken tacos'
	]);

	// A label is needed on each dinner, and unlike the others.
	await kids.getByLabel('Label', { exact: true }).fill('adults');
	await kids.getByRole('button', { name: 'Save' }).click();
	await expect(kids.getByRole('alert')).toHaveText(
		'Give each dinner on this day a different label'
	);

	// Save goes to the week, where only that dinner's line says Saved.
	await kids.getByLabel('Label', { exact: true }).fill('Kids');
	await kids.getByLabel('Note', { exact: true }).fill('Early');
	await kids.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sundayOf(date)}$`));
	const row = day(page, date);
	await expect(row.locator('.dinner')).toHaveCount(2);
	await expect(row.locator('.dinner').nth(0)).toContainText('Adults');
	await expect(row.locator('.dinner').nth(0)).toContainText('Chicken tacos');
	await expect(row.locator('.dinner').nth(0)).toContainText('After bedtime');
	await expect(row.locator('.dinner').nth(1)).toContainText('Kids');
	await expect(row.locator('.dinner').nth(1)).toContainText('Mac and cheese');
	await expect(row.locator('.dinner').nth(1)).toContainText('Early');
	await expect(row.getByRole('status')).toHaveText(['', '', 'Saved']);
	await expect(row.getByRole('status')).toHaveText(['', '', ''], { timeout: 6000 });

	// Clearing one leaves the other as the day's only dinner, without a label.
	await open(page, `/menu/${date}`);
	await adults.getByRole('button', { name: 'Clear' }).click();
	await page.getByRole('dialog', { name: 'Clear' }).getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByRole('region', { name: 'Adults' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Kids' })).toHaveCount(0);
	await expect(page.getByLabel('Label', { exact: true })).toHaveCount(0);
	await expect(dishLinks(page)).toHaveText(['Mac and cheese']);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Early');
	expect(labels()).toEqual([null]);
	expect(dinnerRow(db, person.householdId, date)?.id).not.toBe(adultsId);
});

// Dragging a day onto another in the week (design 7, Menu; 2.2.2). Only a mouse or trackpad drags,
// so these run without touch.
test.describe('dragging days in the week', () => {
	test.use({ isMobile: false, hasTouch: false });

	/** Presses on one day, moves over another in steps, and lets go there. */
	async function drag(page: Page, from: string, to: { x: number; y: number } | string) {
		const source = await day(page, from).boundingBox();
		if (!source) throw new Error(`No row for ${from}`);
		await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
		await page.mouse.down();
		const end = typeof to === 'string' ? await center(page, to) : to;
		await page.mouse.move(end.x, end.y, { steps: 8 });
		await page.mouse.up();
	}

	async function center(page: Page, date: string) {
		const box = await day(page, date).boundingBox();
		if (!box) throw new Error(`No row for ${date}`);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	/** Next week's Sunday to Saturday, so every day shows in one week. */
	function nextWeek() {
		const sunday = addDays(sundayOf(today()), 7);
		return [0, 1, 2, 3, 4, 5, 6].map((days) => addDays(sunday, days)) as [
			string,
			string,
			string,
			string,
			string,
			string,
			string
		];
	}

	const ids = (db: Database.Database, householdId: number, date: string) =>
		db
			.prepare('select id from dinners where household_id = ? and date = ? order by id')
			.pluck()
			.all(householdId, date);

	test('swaps two days, moves onto a day not planned, and keeps the week open', async ({
		page,
		db,
		person
	}) => {
		const tacos = addRecipe(db, person.householdId, { name: 'Chicken tacos' });
		const [sun, mon, tue, wed] = nextWeek();
		const tacosId = addDinner(db, person.householdId, mon, { dishes: [[tacos, 'main']] });
		const pizzaId = addDinner(db, person.householdId, wed, { type: 'eat_out', note: 'Pizza' });

		await open(page, `/menu?week=${sun}`);
		const url = page.url();
		await drag(page, mon, wed);
		await expect(day(page, mon).locator('.type')).toHaveText('Eating out');
		await expect(day(page, mon).locator('.note')).toHaveText('Pizza');
		await expect(day(page, wed).locator('.names')).toHaveText(['Chicken tacos']);
		expect(page.url()).toBe(url);
		expect(ids(db, person.householdId, mon)).toEqual([pizzaId]);
		expect(ids(db, person.householdId, wed)).toEqual([tacosId]);

		await drag(page, wed, tue);
		await expect(day(page, tue).locator('.names')).toHaveText(['Chicken tacos']);
		await expect(day(page, wed)).toContainText('Not planned');
		expect(page.url()).toBe(url);
		expect(ids(db, person.householdId, tue)).toEqual([tacosId]);
		expect(ids(db, person.householdId, wed)).toEqual([]);

		// Menu help tells people about it.
		await page.getByRole('banner').getByRole('button', { name: 'Help', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Help: Menu' })).toContainText(
			'On a computer, drag a day onto another day to swap their dinners.'
		);
	});

	test('moves all of a day’s dinners together, with their labels', async ({
		page,
		db,
		person
	}) => {
		const [sun, mon, tue] = nextWeek();
		const adults = addDinner(db, person.householdId, mon, { note: 'After bedtime' });
		const kids = addDinner(db, person.householdId, mon, { type: 'leftovers' });
		db.prepare('update dinners set label = ? where id = ?').run('Adults', adults);
		db.prepare('update dinners set label = ? where id = ?').run('Kids', kids);

		await open(page, `/menu?week=${sun}`);
		await drag(page, mon, tue);
		const row = day(page, tue);
		await expect(row.locator('.dinner .label')).toHaveText(['Adults', 'Kids']);
		await expect(row.locator('.dinner').nth(0)).toContainText('After bedtime');
		await expect(row.locator('.dinner').nth(1)).toContainText('Leftovers');
		await expect(day(page, mon)).toContainText('Not planned');
		expect(ids(db, person.householdId, tue)).toEqual([adults, kids]);
	});

	test('outlines the day under the pointer, and only a planned day drags', async ({
		page,
		db,
		person
	}) => {
		const [sun, mon, tue, wed] = nextWeek();
		const tacosId = addDinner(db, person.householdId, mon);
		await open(page, `/menu?week=${sun}`);

		const source = await center(page, mon);
		await page.mouse.move(source.x, source.y);
		await page.mouse.down();
		const target = await center(page, wed);
		await page.mouse.move(target.x, target.y, { steps: 8 });
		await expect(day(page, wed)).toHaveClass(/\btarget\b/);
		await expect(day(page, tue)).not.toHaveClass(/\btarget\b/);
		await expect(page.locator('a.day.target')).toHaveCount(1);
		await page.mouse.up();
		await expect(day(page, wed)).not.toContainText('Not planned');
		await expect(page.locator('a.day.target')).toHaveCount(0);

		// Dragging a day that isn't planned does nothing and opens nothing.
		await drag(page, tue, wed);
		await expect(page.locator('a.day.target')).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sun}$`));
		await expect(day(page, tue)).toContainText('Not planned');
		expect(ids(db, person.householdId, wed)).toEqual([tacosId]);
	});

	test('changes nothing when let go on the same day or outside the days', async ({
		page,
		db,
		person
	}) => {
		const [sun, mon] = nextWeek();
		const tacosId = addDinner(db, person.householdId, mon, { note: 'Taco night' });
		await open(page, `/menu?week=${sun}`);

		// Out and back onto the same day.
		const source = await center(page, mon);
		await page.mouse.move(source.x, source.y);
		await page.mouse.down();
		await page.mouse.move(source.x, source.y + 80, { steps: 4 });
		await page.mouse.move(source.x, source.y, { steps: 4 });
		await page.mouse.up();
		// Onto the page heading, outside any day.
		const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
		if (!heading) throw new Error('No heading');
		await drag(page, mon, { x: heading.x + 5, y: heading.y + heading.height / 2 });

		await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sun}$`));
		await expect(day(page, mon).locator('.note')).toHaveText('Taco night');
		expect(ids(db, person.householdId, mon)).toEqual([tacosId]);
		await expect(page.getByRole('alert')).toHaveCount(0);
	});

	test('still opens a day when it is clicked without dragging', async ({ page, db, person }) => {
		const [sun, mon] = nextWeek();
		addDinner(db, person.householdId, mon);
		await open(page, `/menu?week=${sun}`);
		await day(page, mon).click();
		await expect(page).toHaveURL(new RegExp(`/menu/${mon}$`));
	});

	test("moves nothing when someone cleared or moved the day's dinners since the week loaded", async ({
		page,
		db,
		person
	}) => {
		const [sun, mon, tue, wed, thu] = nextWeek();
		const tacosId = addDinner(db, person.householdId, mon, { note: 'Taco night' });
		const pizzaId = addDinner(db, person.householdId, wed, { type: 'eat_out', note: 'Pizza' });
		await open(page, `/menu?week=${sun}`);

		// Someone else moves Monday's dinner to Thursday.
		db.prepare('update dinners set date = ? where id = ?').run(thu, tacosId);
		await drag(page, mon, wed);
		await expect(page.getByRole('alert')).toHaveText(
			"Someone cleared or moved that day's dinners, so nothing moved."
		);
		await expect(day(page, mon)).toContainText('Not planned');
		await expect(day(page, thu).locator('.note')).toHaveText('Taco night');
		await expect(day(page, wed).locator('.note')).toHaveText('Pizza');
		expect(ids(db, person.householdId, wed)).toEqual([pizzaId]);

		// Someone else swaps another dinner onto Wednesday before it's dragged.
		db.prepare('update dinners set date = ? where id = ?').run(tue, pizzaId);
		db.prepare('update dinners set date = ? where id = ?').run(wed, tacosId);
		await page.reload();
		await expect(page.locator('html[data-started]')).toBeAttached();
		db.prepare('update dinners set date = ? where id = ?').run(wed, pizzaId);
		db.prepare('update dinners set date = ? where id = ?').run(tue, tacosId);
		await drag(page, wed, thu);
		await expect(page.getByRole('alert')).toHaveText(
			"Someone cleared or moved that day's dinners, so nothing moved."
		);
		await expect(day(page, wed).locator('.note')).toHaveText('Pizza');
		await expect(day(page, tue).locator('.note')).toHaveText('Taco night');
		expect(ids(db, person.householdId, thu)).toEqual([]);
	});
});

test('never drags on touch: pressing and moving on a day moves nothing', async ({
	page,
	db,
	person
}) => {
	const sunday = addDays(sundayOf(today()), 7);
	const [mon, tue] = [1, 2].map((days) => addDays(sunday, days)) as [string, string];
	const tacosId = addDinner(db, person.householdId, mon, { note: 'Taco night' });
	await open(page, `/menu?week=${sunday}`);

	// Real touch input; page.mouse would send a mouse pointer even on the Pixel 7.
	const from = await day(page, mon).boundingBox();
	const to = await day(page, tue).boundingBox();
	if (!from || !to) throw new Error('No rows');
	const point = (box: typeof from) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
	// A long press first, as some browsers start a drag with one.
	await page.waitForTimeout(800);
	for (let step = 1; step <= 8; step += 1) {
		const y = from.y + from.height / 2 + ((to.y - from.y) * step) / 8;
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: point(from).x, y }]
		});
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

	await expect(page.locator('a.day.target')).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sunday}$`));
	await expect(day(page, mon).locator('.note')).toHaveText('Taco night');
	await expect(day(page, tue)).toContainText('Not planned');
	expect(dinnerRow(db, person.householdId, mon)?.id).toBe(tacosId);
});

// Swiping the week's days sideways changes the week, like Previous and Next (design 7, Menu;
// MEA-45). These send real touch input, as a phone does; page.mouse would send a mouse pointer
// even on the Pixel 7.
test.describe('swiping between weeks', () => {
	type Stroke = { from: { x: number; y: number }; to: { x: number; y: number } };

	/** Fingers pressed at their starts, moved to their ends together in steps, then lifted. */
	async function touch(page: Page, ...fingers: Stroke[]) {
		const at = (step: number) =>
			fingers.map(({ from, to }, id) => ({
				id,
				x: from.x + ((to.x - from.x) * step) / 8,
				y: from.y + ((to.y - from.y) * step) / 8
			}));
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
		for (let step = 1; step <= 8; step += 1) {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await cdp.detach();
	}

	/**
	 * A finger's way across the middle of what's there: `across` pixels to the right (negative
	 * is to the left) and `down` pixels down (negative is up).
	 */
	async function stroke(on: Locator, across: number, down = 0): Promise<Stroke> {
		const box = await on.boundingBox();
		if (!box) throw new Error('Nothing there to swipe');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		return {
			from: { x: x - across / 2, y: y - down / 2 },
			to: { x: x + across / 2, y: y + down / 2 }
		};
	}

	/** One finger across the middle of what's there, as `stroke` describes. */
	async function swipe(on: Locator, across: number, down = 0) {
		await touch(on.page(), await stroke(on, across, down));
	}

	/**
	 * The week from that Sunday is showing: its address, heading and dates, and on each day the
	 * note of its dinner, or "Not planned".
	 */
	async function showsWeek(page: Page, sunday: string, notes: Record<string, string> = {}) {
		const dates = Array.from({ length: 7 }, (_, index) => addDays(sunday, index));
		await expect(page).toHaveURL(new RegExp(`/menu\\?week=${sunday}$`));
		await expect(page.getByRole('navigation', { name: 'Weeks' }).locator('.label')).toHaveText(
			weekRange(sunday)
		);
		await expect(page.locator('a.day .date')).toHaveText(dates.map((date) => dayLabel(date)));
		await expect(page.locator('a.day')).toHaveText(
			dates.map((date) => new RegExp(notes[date] ?? 'Not planned'))
		);
	}

	test('goes a week on for each swipe left, and a week back for each swipe right', async ({
		page,
		db,
		person
	}) => {
		const sunday = sundayOf(today());
		const next = addDays(sunday, 7);
		const after = addDays(sunday, 14);
		const [mon, nextTue, afterThu] = [addDays(sunday, 1), addDays(next, 2), addDays(after, 4)];
		addDinner(db, person.householdId, mon, { note: 'Taco night' });
		addDinner(db, person.householdId, nextTue, { note: 'Pizza' });
		addDinner(db, person.householdId, afterThu, { note: 'Soup' });
		await open(page, '/menu');
		const weeks = page.getByRole('navigation', { name: 'Weeks' });

		// One week however far the swipe goes, without opening the day it crossed.
		await swipe(day(page, addDays(sunday, 3)), -300);
		await showsWeek(page, next, { [nextTue]: 'Pizza' });
		await swipe(day(page, addDays(next, 3)), -80);
		await showsWeek(page, after, { [afterThu]: 'Soup' });
		await swipe(day(page, addDays(after, 3)), 300);
		await showsWeek(page, next, { [nextTue]: 'Pizza' });
		await swipe(day(page, addDays(next, 3)), 80);
		await showsWeek(page, sunday, { [mon]: 'Taco night' });
		await expect(weeks.getByRole('link', { name: 'This week' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(day(page, today()).locator('.today-badge')).toHaveText('Today');

		// The buttons go on from a week swiped to, and swiping from theirs.
		await weeks.getByRole('link', { name: 'Next' }).tap();
		await showsWeek(page, next, { [nextTue]: 'Pizza' });
		await swipe(day(page, addDays(next, 3)), 200);
		await showsWeek(page, sunday, { [mon]: 'Taco night' });

		// Menu help tells people about it.
		await page.getByRole('banner').getByRole('button', { name: 'Help', exact: true }).tap();
		const help = page.getByRole('dialog', { name: 'Help: Menu' });
		await expect(help).toContainText(
			'Previous and Next change the week, or swipe the days left or right.'
		);
		await help.getByRole('button', { name: 'Close' }).tap();
		await expect(help).toBeHidden();

		// Tapping a day still opens it.
		await day(page, mon).tap();
		await expect(page).toHaveURL(new RegExp(`/menu/${mon}$`));
		await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Taco night');
	});

	test('swipes from December into January of the next year, and back', async ({
		page,
		db,
		person
	}) => {
		addDinner(db, person.householdId, '2026-12-31', { note: "New Year's Eve" });
		addDinner(db, person.householdId, '2027-01-01', { note: "New Year's Day" });
		const newYear = { '2026-12-31': "New Year's Eve", '2027-01-01': "New Year's Day" };
		await open(page, '/menu?week=2026-12-20');

		await swipe(day(page, '2026-12-23'), -200);
		await showsWeek(page, '2026-12-27', newYear);
		await swipe(day(page, '2026-12-30'), -200);
		await showsWeek(page, '2027-01-03');
		await swipe(day(page, '2027-01-06'), 200);
		await showsWeek(page, '2026-12-27', newYear);
		await swipe(day(page, '2026-12-30'), 200);
		await showsWeek(page, '2026-12-20');
	});

	test('keeps the week for scrolling, short, slanted and two-finger swipes, and swipes off the days', async ({
		page,
		person: _
	}) => {
		const sunday = sundayOf(today());
		await open(page, '/menu');
		// The weeks the page loads, to show that only the real swipe loaded one.
		const loads: (string | null)[] = [];
		page.on('request', (request) => {
			const url = new URL(request.url());
			if (url.pathname === '/menu/__data.json') loads.push(url.searchParams.get('week'));
		});
		// Wednesday in whichever week shows, so a wrong week change fails at the end, not here.
		const wednesday = page.locator('a.day').nth(3);
		const heading = page.getByRole('navigation', { name: 'Weeks' }).locator('.label');

		// Less than 60 pixels across.
		await swipe(wednesday, -50);
		// More than half as far down as across.
		await swipe(wednesday, -160, 100);
		// Across the week's heading rather than its days.
		await swipe(heading, -200);
		// Up the screen, which scrolls the page as before, even straying 70 pixels sideways.
		await swipe(wednesday, 70, -300);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

		// Once the page stops moving, a real swipe still goes a week on from the week shown, and
		// that's the only week loaded. (A tap would leave a mouse pointer over a link, which
		// loads its page ahead of time.)
		await wednesday.scrollIntoViewIfNeeded();
		await swipe(wednesday, -200);
		await showsWeek(page, addDays(sunday, 7));
		expect(loads).toEqual([addDays(sunday, 7)]);

		// With a second finger, off the days, as in a pinch. It goes last because full Chrome's
		// touch emulation, unlike the headless shell CI runs, then holds the second finger down
		// for the rest of the page, so every later swipe would be a pinch too (MEA-79).
		await touch(page, await stroke(wednesday, -200), await stroke(heading, -200));
		await showsWeek(page, addDays(sunday, 7));
		expect(loads).toEqual([addDays(sunday, 7)]);
	});
});
