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
		version: '1.16',
		released: '2026-11-12',
		lines: [
			"The site admin can now connect the AI assistants ChatGPT and Claude to Meals. A connected assistant can read every household's information, including your lists, recipes, menu and requests, and members' names and email addresses. What it reads is sent to OpenAI or Anthropic. It can propose changes, which happen only if the admin approves them. The Privacy page now says this.",
			'Adding more of an item already on the grocery list now adds up the amounts when the same unit is spelled another way, so 1 lbs of butter on top of 2 lb suggests 3 lb instead of 1 lbs.',
			"When signing in with Google doesn't finish, such as when you cancel at Google, Meals now takes you back to the sign-in page and says what happened, instead of showing an error page with nothing to tap. If Google stops answering, Meals says so after 10 seconds instead of showing an error page after about a minute."
		]
	},
	{
		version: '1.15',
		released: '2026-11-08',
		lines: [
			"On Groceries, tap Party lists, beside Items and Grocery History, to plan what a party needs. Start one with New list, add food, drinks and supplies, then tap Add to Groceries, or Add all to Groceries, to put what's still needed on the grocery list. What's bought on either list shows on both.",
			'History is now called Grocery History.',
			"Household, requests and the ratings under a recipe's stars now show each person's first name. People in your household who share a first name show their whole names.",
			"Each request now has Edit, beside Complete and Remove on the Menu and beside Add on a day's page, to change its dish or restaurant and its note. Who asked and its place in the list stay the same.",
			"On Edit recipe, paste a recipe's web address in Link and tap Import to update the recipe from the page. Empty fields fill in, and you choose what to keep, what to replace and which new ingredients to add. Tap Apply, check it, then tap Save.",
			"On a dinner's page, the suggestions in Add a dish now open above the tabs and your phone's keyboard, with the page scrolling just enough to show them. When there's little room above the keyboard, the list gets shorter and scrolls, so you can still tap any dish.",
			"On a dinner's page, what you typed and didn't save now stays with its dinner when someone else clears or moves it while you're in another app. The page says what happened, and for a moved dinner, Open takes what you typed to its new date.",
			'Adding more of an item already on the grocery list no longer suggests amounts such as 3.3000000000000003, and Got fewer no longer leaves amounts like that or a line with 0 left.',
			'Imports now read amounts such as 1 and a half cups, 2 and a third cups and 1 & 1/3 cup as one amount.',
			"Import from a link now reads the recipe on some sites where it said Couldn't find a recipe on that page.",
			'In a recipe or an import, an amount such as ½1 is now refused with how to write it, instead of being saved as 1/21.'
		]
	},
	{
		version: '1.14',
		released: '2026-11-07',
		lines: [
			'Import recipes now handles a large file much faster, without freezing Meals for everyone meanwhile. It takes up to 1,000 recipes in one file, and a file with more says which row to split it at.',
			'On Items, Household and Admin, and for stores on the grocery list, a name that starts with an accented letter, such as Éclairs, now sorts with that letter instead of after Z.',
			"A recipe's photo and the rest of its changes now save together or not at all. Before, a failed save could keep the other changes with the photo unchanged, and trying again on a new recipe said a recipe was already called that."
		]
	},
	{
		version: '1.13',
		released: '2026-11-07',
		lines: [
			"Everyone was signed out once with this release, because Meals now keeps your sign-in so other websites can't tamper with it.",
			"On Recipes, tap Grouped, under the search box, to see recipes by when they were last on the Menu: Recently made for the past 60 days, Haven't made in a long time and Never made. Each card there shows when it was last made, and List shows them as before.",
			'On the Menu, each request now has Complete beside Remove. Complete moves it to Completed requests, under Requests, with who asked and when it was completed. Tap Completed requests to open it.',
			"On a day's page, tapping Add on a request now moves it to Completed requests too, instead of removing it. On the Menu, Remove still deletes a request for good, and no longer takes you back to this week.",
			'On the Menu, the days now slide with your finger as you swipe to the next or previous week, and the page stays scrolled where it was instead of jumping to the top.',
			"On a recipe's page, tapping a star twice before the stars change, as with a double tap or on a slow connection, now keeps that rating instead of clearing it.",
			'Copy a dinner now copies the dishes it showed you, even if that dinner changed after you opened the page. If no past dinner still has those dishes, it says that dinner has changed and asks you to pick again.',
			"On Recipes, what you type in the search box right after tapping a tag no longer disappears when the tag's list loads.",
			'After an import, Recipes sums up ignored columns, such as Step, Rating and 12 more, rather than listing every one. A file with hundreds of extra columns now gets that summary too, instead of an error page.'
		]
	},
	{
		version: '1.12',
		released: '2026-11-06',
		lines: [
			"Grocery items can have an image. On Items, tap an item, then tap Add image to pick one, or paste an image's link and tap Get image. The image shows beside the item's name on the grocery list, on Items and in History.",
			"Items now lists 288 common groceries and household goods, from Apples to Cat Litter, ready to pick when you add to the grocery list or a recipe. Your list stays as it was, and items you already had aren't added again.",
			'Each of those 288 items comes with a photo, and items you already had with those names got one too, unless they had an image. Change or remove any photo on Items.'
		]
	},
	{
		version: '1.11',
		released: '2026-11-05',
		lines: [
			'Send feedback can include a screenshot. Tap Add screenshot to pick a PNG or JPEG up to 3 MB, and it goes along with your message.',
			"On a dinner's page, Back and Forward bring back what you typed and didn't save, including a dish name typed in Add a dish.",
			"Import recipes' ‹ Recipes returns to Recipes as you left it, and going back from there no longer opens Import recipes again.",
			'Imports read amounts such as 1 and 1/3 cup as one amount. Import from a link also reads nutrition such as 1 250 kcal in full.',
			'Import recipes takes up to 100,000 characters in one file. A longer file says which row to split it at.',
			"A date's browser tab shows the year when the date is in another year."
		]
	},
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
