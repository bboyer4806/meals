import type { Page } from '@playwright/test';
import { expect, signInAs, test } from './fixtures.ts';

// What's new (design 7). 1.14 was released on 2026-11-07, the same day as 1.13.

function setCreatedAt(db: import('better-sqlite3').Database, userId: number, ms: number) {
	db.prepare('update users set created_at = ? where id = ?').run(ms, userId);
}

/** The version of the newest release the person has seen. */
function seen(db: import('better-sqlite3').Database, userId: number) {
	return db.prepare('select whats_new_seen from users where id = ?').pluck().get(userId);
}

const more = (page: Page) => page.getByRole('banner').locator('summary');
const link = (page: Page) =>
	page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^What's new/ });

test('lists the releases from More, newest first', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	await more(page).click();
	await expect(page.getByRole('navigation', { name: 'More' }).getByRole('link')).toHaveText([
		'Items',
		'History',
		'Household',
		"What's new"
	]);
	await link(page).click();

	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['1.14', '1.13', '1.12', '1.11', '1.10', '1.9', '1.8', '1.7', '1.6', '1.5', '1.4', '1.3', '1.2', '1.1']);
	const [v114, v113, v112, v111, v110, v19, v18, v17, v16, v15, v14, v13, v12, v11] = [
		page.locator('section').nth(0),
		page.locator('section').nth(1),
		page.locator('section').nth(2),
		page.locator('section').nth(3),
		page.locator('section').nth(4),
		page.locator('section').nth(5),
		page.locator('section').nth(6),
		page.locator('section').nth(7),
		page.locator('section').nth(8),
		page.locator('section').nth(9),
		page.locator('section').nth(10),
		page.locator('section').nth(11),
		page.locator('section').nth(12),
		page.locator('section').nth(13)
	];
	await expect(v114.getByText('Released November 7, 2026')).toBeVisible();
	await expect(v114.getByRole('listitem')).toHaveText([
		'Import recipes now handles a large file much faster, without freezing Meals for everyone meanwhile. It takes up to 1,000 recipes in one file, and a file with more says which row to split it at.',
		'On Items, Household and Admin, and for stores on the grocery list, a name that starts with an accented letter, such as Éclairs, now sorts with that letter instead of after Z.',
		"A recipe's photo and the rest of its changes now save together or not at all. Before, a failed save could keep the other changes with the photo unchanged, and trying again on a new recipe said a recipe was already called that."
	]);
	await expect(v113.getByText('Released November 7, 2026')).toBeVisible();
	await expect(v113.getByRole('listitem')).toHaveText([
		"Everyone was signed out once with this release, because Meals now keeps your sign-in so other websites can't tamper with it.",
		"On Recipes, tap Grouped, under the search box, to see recipes by when they were last on the Menu: Recently made for the past 60 days, Haven't made in a long time and Never made. Each card there shows when it was last made, and List shows them as before.",
		'On the Menu, each request now has Complete beside Remove. Complete moves it to Completed requests, under Requests, with who asked and when it was completed. Tap Completed requests to open it.',
		"On a day's page, tapping Add on a request now moves it to Completed requests too, instead of removing it. On the Menu, Remove still deletes a request for good, and no longer takes you back to this week.",
		'On the Menu, the days now slide with your finger as you swipe to the next or previous week, and the page stays scrolled where it was instead of jumping to the top.',
		"On a recipe's page, tapping a star twice before the stars change, as with a double tap or on a slow connection, now keeps that rating instead of clearing it.",
		'Copy a dinner now copies the dishes it showed you, even if that dinner changed after you opened the page. If no past dinner still has those dishes, it says that dinner has changed and asks you to pick again.',
		"On Recipes, what you type in the search box right after tapping a tag no longer disappears when the tag's list loads.",
		'After an import, Recipes sums up ignored columns, such as Step, Rating and 12 more, rather than listing every one. A file with hundreds of extra columns now gets that summary too, instead of an error page.'
	]);
	await expect(v112.getByText('Released November 6, 2026')).toBeVisible();
	await expect(v112.getByRole('listitem')).toHaveText([
		"Grocery items can have an image. On Items, tap an item, then tap Add image to pick one, or paste an image's link and tap Get image. The image shows beside the item's name on the grocery list, on Items and in History.",
		"Items now lists 288 common groceries and household goods, from Apples to Cat Litter, ready to pick when you add to the grocery list or a recipe. Your list stays as it was, and items you already had aren't added again.",
		'Each of those 288 items comes with a photo, and items you already had with those names got one too, unless they had an image. Change or remove any photo on Items.'
	]);
	await expect(v111.getByText('Released November 5, 2026')).toBeVisible();
	await expect(v111.getByRole('listitem')).toHaveText([
		'Send feedback can include a screenshot. Tap Add screenshot to pick a PNG or JPEG up to 3 MB, and it goes along with your message.',
		"On a dinner's page, Back and Forward bring back what you typed and didn't save, including a dish name typed in Add a dish.",
		"Import recipes' ‹ Recipes returns to Recipes as you left it, and going back from there no longer opens Import recipes again.",
		'Imports read amounts such as 1 and 1/3 cup as one amount. Import from a link also reads nutrition such as 1 250 kcal in full.',
		'Import recipes takes up to 100,000 characters in one file. A longer file says which row to split it at.',
		"A date's browser tab shows the year when the date is in another year."
	]);
	await expect(v110.getByText('Released November 4, 2026')).toBeVisible();
	await expect(v110.getByRole('listitem')).toHaveText([
		"Coming back to Meals without a connection keeps the page and what you typed instead of showing Something went wrong. The page says Couldn't refresh at the bottom and reloads once you're back online.",
		'Saving a dinner now scrolls the week to that day, so you can see it say Saved.',
		'Mark all ordered and Mark all received now say how many items they marked, and change only the items they asked about, so an item added meanwhile waits for the next order.',
		"When a recipe can't be saved, every problem shows at once, each under its field, instead of only the first one at the top.",
		"On a dinner's page, the servings, label, restaurant and note you typed come back if your phone reloads the page while you're in another app. Leaving with a dish name typed but not added asks first.",
		'Tap outside the More menu, or press Escape, to close it.',
		'Scrolling in a panel, such as the one a grocery line opens, no longer moves the page behind it.',
		"In Request a dish, the suggestions show under Dish instead of covering Note and Request. A requested dish's name is also easier to tap to open its recipe.",
		'Cancel in the recipe editor or Import recipes, and Back to recipe in the cooking view, return to where you were, as you left it. Going back from there no longer opens them again.',
		'On New recipe, importing from a link keeps the photo, tags and notes you added and asks before replacing anything else you typed. Leaving after an import, before Save, asks first.',
		'In Got fewer on a grocery line, the button is now Save received, and a problem shows right under it instead of at the top.',
		"On a dinner's page, dish suggestions scroll under the header and tabs, so tapping Help, More or a tab no longer adds a dish. A line now separates the dinners on a day with several.",
		'History shows the year on dates from earlier years, and moving a dinner shows the year when the new date is in another year.',
		'On a slow connection, quick changes on a day with no dinner yet all go through, instead of saying someone put another dinner on this date.',
		'Imports read ingredients such as 2 cloves of garlic, 500g flour and 1 (14 oz) can of tomatoes correctly. Import from a link also keeps é, ° and ½ from older sites and reads nutrition such as 1,250 kcal in full.',
		"T., Tb and TB now count as tablespoons and t. as teaspoons. A step with a time such as 1 1\u20442 hours no longer says its amounts aren't scaled.",
		'Import recipes reads ingredients and steps on their own lines in a cell, and an inch mark like 9" no longer merges rows. A file not saved as CSV UTF-8 is refused with how to fix it, instead of garbling é, ½ and °.',
		'When a page still shows a grocery line, request, invite or member someone else already removed, tapping it no longer changes a newer one or shows Not found.'
	]);
	await expect(v19.getByText('Released November 3, 2026')).toBeVisible();
	await expect(v19.getByRole('listitem')).toHaveText([
		"On a dinner's page, tap a dish in the suggestions to add it right away, with the role shown beside Add. The suggestions now show below the role and Add instead of covering them.",
		"Tapping Tried it or a star on a recipe's page keeps the servings you picked instead of resetting them.",
		'On the Menu, swipe the days left for the next week or right for the previous one.',
		"Under the stars on a recipe's page, see who rated it and how many stars each person gave."
	]);
	await expect(v18.getByText('Released November 2, 2026')).toBeVisible();
	await expect(v18.getByRole('listitem')).toHaveText([
		"Requests now show on a day's page too, under its dinners. Tap Add on a requested dish to put it on that day's dinner, and the request is removed.",
		"Eating out dinners have a Restaurant field, and the Menu shows the restaurant. On a day's page, tap Add on a requested restaurant to plan eating out there as a new dinner.",
		'On Recipes, tap more than one tag to see only recipes with all of them. Tap a tag again to remove it.',
		"The Menu shows each dinner's whole note instead of cutting it off after two lines."
	]);
	await expect(v17.getByText('Released October 26, 2026')).toBeVisible();
	await expect(v17.getByRole('listitem')).toHaveText([
		"On New recipe, paste a recipe's web address in Link and tap Import to fill in the recipe from the page. Check it, then tap Save.",
		"Tap Request on a recipe's page, under the stars, to add it to Requests on the Menu. The recipe then says Requested until it's removed from Requests.",
		"Ask to eat out with Request a restaurant, under Requests on the Menu. The request shows Eating out and the restaurant's name."
	]);
	await expect(v16.getByText('Released October 24, 2026')).toBeVisible();
	await expect(v16.getByRole('listitem')).toHaveText([
		'Add many recipes at once from a CSV file with Import, beside New recipe. Download template gives the columns to fill in, one recipe per row.',
		"Recipes, History and Items search as you type, so there's no Search button to tap.",
		'On a computer, drag a day onto another day on the Menu to swap their dinners.',
		"Requesting a dish that isn't in Recipes adds it there, ready for its recipe, and every request now links to its recipe."
	]);
	await expect(v15.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v15.getByRole('listitem')).toHaveText([
		"Add a dinner on a day's page to plan up to 5 dinners that day, such as one for the kids and one for the adults. Each has its own label, dishes, servings and note.",
		'Check Tried it on a recipe once your household has made it. Tried recipes show a Tried badge on the Recipes list.',
		"Rate a recipe from 1 to 5 stars on its page. Your household's average shows on the recipe and on its card in Recipes.",
		'Sort Recipes by name or by rating with Sort, beside the search box.'
	]);
	await expect(v14.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v14.getByRole('listitem')).toHaveText([
		'Tap Help at the top of any page to see what that page is for and how to use it.',
		'The first time you open the Grocery list, a short tour points out Groceries, Menu, Recipes, More, Help and Send feedback.'
	]);
	await expect(v13.getByText('Released October 21, 2026')).toBeVisible();
	await expect(v13.getByRole('listitem')).toHaveText([
		'Send feedback from any page with the button at the bottom right.',
		'Request a dish on the Menu page, under Requests. Everyone in your household sees who asked for what.',
		"What's new, in the More menu, lists what changed in each release, and a dot shows when there's something new."
	]);
	await expect(v12.getByText('Released October 20, 2026')).toBeVisible();
	await expect(v12.getByRole('listitem')).toHaveText([
		'Recipe, History and Items have a Back link at the top.',
		'Going somewhere is now called Bringing a dish.',
		"Tap a dinner's date at the top of its page to move it to another day.",
		'A day with no dinner starts as Cooking at home, ready for its note and servings.'
	]);
	await expect(v11.getByText('Released October 14, 2026')).toBeVisible();
	await expect(v11.getByRole('listitem')).toHaveText([
		"Saving a dinner's servings and note takes you back to the week, where the day says Saved.",
		'Check pantry is hidden for now.'
	]);
	await expect(page.getByText(/sprint/i)).toHaveCount(0);
});

test("shows a dot until What's new is opened, on every device", async ({
	page,
	db,
	person,
	browser,
	baseURL
}) => {
	setCreatedAt(db, person.userId, Date.UTC(2026, 9, 1, 17));
	await page.goto('/groceries');
	await expect(more(page).locator('.dot')).toBeVisible();
	await expect(more(page).getByText('new', { exact: true })).toHaveClass('visually-hidden');
	await more(page).click();
	await expect(link(page).locator('.dot')).toBeVisible();
	await expect(link(page)).toHaveAccessibleName("What's new new");

	// Hovering doesn't open it.
	await link(page).hover();
	await page.waitForTimeout(500);
	await page.reload();
	await expect(more(page).locator('.dot')).toBeVisible();

	await more(page).click();
	await link(page).click();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await page.goto('/groceries');
	await more(page).click();
	await expect(link(page)).toHaveAccessibleName("What's new");

	const other = await browser.newContext();
	await signInAs(db, other, baseURL, person.userId);
	const phone = await other.newPage();
	await phone.goto('/groceries');
	await expect(phone.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(more(phone).locator('.dot')).toHaveCount(0);
	await other.close();
});

test('shows a dot for a release newer than the one each person last saw', async ({
	page,
	db,
	person,
	browser,
	baseURL
}) => {
	// Two members of the household who joined before 1.14 and have seen 1.13, released the same day.
	const joined = Date.UTC(2026, 9, 1, 17);
	setCreatedAt(db, person.userId, joined);
	db.prepare("update users set whats_new_seen = '1.13' where id = ?").run(person.userId);
	const memberId = Number(
		db
			.prepare(
				"insert into users (household_id, google_sub, email, name, created_at, tour_seen, whats_new_seen) values (?, ?, ?, 'Robin', ?, 0, '1.13')"
			)
			.run(
				person.householdId,
				`sub-member-${person.userId}`,
				`member-${person.userId}@example.com`,
				joined
			).lastInsertRowid
	);

	await page.goto('/groceries');
	await expect(more(page).locator('.dot')).toBeVisible();
	await more(page).click();
	await link(page).click();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	expect(seen(db, person.userId)).toBe('1.14');

	// Opening it cleared only their own dot.
	const other = await browser.newContext();
	await signInAs(db, other, baseURL, memberId);
	const phone = await other.newPage();
	await phone.goto('/groceries');
	await expect(more(phone).locator('.dot')).toBeVisible();
	expect(seen(db, memberId)).toBe('1.13');
	await other.close();
});

test('shows no dot to someone who joined after the newest release', async ({
	page,
	db,
	person
}) => {
	setCreatedAt(db, person.userId, Date.UTC(2026, 10, 7, 17));
	await page.goto('/groceries');
	await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
	await expect(more(page).locator('.dot')).toHaveCount(0);
	await more(page).click();
	await expect(link(page)).toHaveAccessibleName("What's new");
});
