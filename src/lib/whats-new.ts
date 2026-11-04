// What's new (design 7): what each release changed, written for the people using the app.
// When a sprint closes, one pull request adds its release at the top. Internal changes, such as
// tests or instruction files, aren't listed.

export type Release = {
	/** The sprint's version, such as "1.2" for Jira's "Meals 1.2". */
	version: string;
	/** The day the sprint closed, as YYYY-MM-DD. */
	released: string;
	/** One line per change people will notice. */
	lines: string[];
};

/** Newest first. */
export const RELEASES: [Release, ...Release[]] = [
	{
		version: '1.10',
		released: '2026-11-04',
		lines: [
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
		]
	},
	{
		version: '1.9',
		released: '2026-11-03',
		lines: [
			"On a dinner's page, tap a dish in the suggestions to add it right away, with the role shown beside Add. The suggestions now show below the role and Add instead of covering them.",
			"Tapping Tried it or a star on a recipe's page keeps the servings you picked instead of resetting them.",
			'On the Menu, swipe the days left for the next week or right for the previous one.',
			"Under the stars on a recipe's page, see who rated it and how many stars each person gave."
		]
	},
	{
		version: '1.8',
		released: '2026-11-02',
		lines: [
			"Requests now show on a day's page too, under its dinners. Tap Add on a requested dish to put it on that day's dinner, and the request is removed.",
			"Eating out dinners have a Restaurant field, and the Menu shows the restaurant. On a day's page, tap Add on a requested restaurant to plan eating out there as a new dinner.",
			'On Recipes, tap more than one tag to see only recipes with all of them. Tap a tag again to remove it.',
			"The Menu shows each dinner's whole note instead of cutting it off after two lines."
		]
	},
	{
		version: '1.7',
		released: '2026-10-26',
		lines: [
			"On New recipe, paste a recipe's web address in Link and tap Import to fill in the recipe from the page. Check it, then tap Save.",
			"Tap Request on a recipe's page, under the stars, to add it to Requests on the Menu. The recipe then says Requested until it's removed from Requests.",
			"Ask to eat out with Request a restaurant, under Requests on the Menu. The request shows Eating out and the restaurant's name."
		]
	},
	{
		version: '1.6',
		released: '2026-10-24',
		lines: [
			'Add many recipes at once from a CSV file with Import, beside New recipe. Download template gives the columns to fill in, one recipe per row.',
			"Recipes, History and Items search as you type, so there's no Search button to tap.",
			'On a computer, drag a day onto another day on the Menu to swap their dinners.',
			"Requesting a dish that isn't in Recipes adds it there, ready for its recipe, and every request now links to its recipe."
		]
	},
	{
		version: '1.5',
		released: '2026-10-21',
		lines: [
			"Add a dinner on a day's page to plan up to 5 dinners that day, such as one for the kids and one for the adults. Each has its own label, dishes, servings and note.",
			'Check Tried it on a recipe once your household has made it. Tried recipes show a Tried badge on the Recipes list.',
			"Rate a recipe from 1 to 5 stars on its page. Your household's average shows on the recipe and on its card in Recipes.",
			'Sort Recipes by name or by rating with Sort, beside the search box.'
		]
	},
	{
		version: '1.4',
		released: '2026-10-21',
		lines: [
			'Tap Help at the top of any page to see what that page is for and how to use it.',
			'The first time you open the Grocery list, a short tour points out Groceries, Menu, Recipes, More, Help and Send feedback.'
		]
	},
	{
		version: '1.3',
		released: '2026-10-21',
		lines: [
			'Send feedback from any page with the button at the bottom right.',
			'Request a dish on the Menu page, under Requests. Everyone in your household sees who asked for what.',
			"What's new, in the More menu, lists what changed in each release, and a dot shows when there's something new."
		]
	},
	{
		version: '1.2',
		released: '2026-10-20',
		lines: [
			'Recipe, History and Items have a Back link at the top.',
			'Going somewhere is now called Bringing a dish.',
			"Tap a dinner's date at the top of its page to move it to another day.",
			'A day with no dinner starts as Cooking at home, ready for its note and servings.'
		]
	},
	{
		version: '1.1',
		released: '2026-10-14',
		lines: [
			"Saving a dinner's servings and note takes you back to the week, where the day says Saved.",
			'Check pantry is hidden for now.'
		]
	}
];
