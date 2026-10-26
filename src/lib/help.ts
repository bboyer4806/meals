import type { PageRouteId } from '$app/types';

// Help (design 7, "Help"): what each screen after household setup is for and how to do its
// main tasks, in a few short points. The map covers every one of those screens, so a new
// screen without help fails the type check.

export type Help = {
	/** The screen's name, shown as "Help: <title>". */
	title: string;
	/** About 6 short points at most. */
	points: string[];
};

/** Every page in the app layout. Feedback's route only takes the feedback sheet's form. */
export type HelpRouteId = Exclude<Extract<PageRouteId, `/(app)/${string}`>, '/(app)/feedback'>;

const EDIT_RECIPE = [
	'Only the name and servings are needed. Fill in the rest now or later.',
	'Photo: take one or choose one from the phone.',
	'Ingredients: each row has an amount, a unit, an item and a prep note. Amounts can be like 2, 1 1/2 or ½. Pick a unit or type your own, like cloves.',
	'Move rows with the arrows. Add section adds a heading, like For the sauce.',
	'Steps: one step per line.',
	'Save keeps the recipe. Cancel leaves without saving.'
];

export const HELP: Record<HelpRouteId, Help> = {
	'/(app)/groceries': {
		title: 'Grocery list',
		points: [
			'The list your household shops from. Everyone in it sees the same list.',
			'To add something, type its name at the top, set the amount, unit and store, and tap Add.',
			'Lines are grouped by store. Tap a store to fold its group away.',
			'Tap the circle next to a line when you have it. Tapped by mistake? Tap it again under Received today.',
			"Tap a line to change it, mark it ordered, say it didn't come or you got fewer, or delete it.",
			'Ordering online? Mark all ordered on a store, then Mark all received when it arrives.'
		]
	},
	'/(app)/groceries/history': {
		title: 'History',
		points: [
			'Everything your household checked off as received, by date, newest first.',
			'Search for an item to see when you last bought it.',
			'Show older shows earlier dates.',
			'‹ Groceries goes back to the list.'
		]
	},
	'/(app)/groceries/items': {
		title: 'Items',
		points: [
			'Everything your household has added to the list or to a recipe.',
			'Each item shows its usual store and when and where it was last bought.',
			'Tap an item to rename it or add notes, like a brand or size. Notes show under its name on the list.',
			"Archive an item you don't buy anymore. It stops being suggested, and recipes and history keep it.",
			'Show archived items to find one and restore it.',
			'‹ Groceries goes back to the list.'
		]
	},
	'/(app)/recipes': {
		title: 'Recipes',
		points: [
			"Your household's recipes. Tap one to open it.",
			'Search by name, or tap a tag to see only recipes with it.',
			'New recipe adds one. Import adds many at once from a spreadsheet.',
			'No recipe means a dish has a name but no ingredients or steps yet.',
			'Show archived lists recipes you archived, so you can restore them.'
		]
	},
	'/(app)/recipes/new': {
		title: 'New recipe',
		points: [
			'Found the recipe online? Paste its web address in Link and tap Import to fill in the recipe from the page. Check it, then tap Save.',
			...EDIT_RECIPE
		]
	},
	'/(app)/recipes/import': {
		title: 'Import recipes',
		points: [
			'Download template gives a spreadsheet layout to fill in, one recipe per row, saved as CSV. Only the Recipe column is needed, and columns can be in any order.',
			'Ingredients and Steps hold several entries separated by |, like 2 cups flour|1 egg|1 cup milk. An ingredient starting with #, like # Batter, is a section heading.',
			'Each ingredient is read as an amount, a unit, an item and, after a comma, a prep note: 1 1/2 cups flour, sifted. A range like 2-3 cloves goes in the prep note.',
			"Tags are separated by commas. A blank Servings uses your household's usual servings.",
			'If anything is wrong, nothing is imported, and each problem is listed with its row number. The header is row 1.',
			'For a recipe already in Recipes, choose Skip, Replace (keeping its name, photo, Tried, ratings and dinners) or Rename.'
		]
	},
	'/(app)/recipes/[id]': {
		title: 'Recipe',
		points: [
			'Change the servings with − and +, and the ingredient amounts change to match.',
			"A step with amounts that don't change with the servings says so.",
			'Cook opens a big-text view to cook from.',
			'Print prints the recipe at the servings shown.',
			'Edit changes the recipe. Archive hides it from Recipes, and past dinners keep it.',
			'‹ Recipes goes back to the list.'
		]
	},
	'/(app)/recipes/[id]/edit': { title: 'Edit recipe', points: EDIT_RECIPE },
	'/(app)/recipes/[id]/cook': {
		title: 'Cooking view',
		points: [
			'The recipe in big text to cook from, at the servings you chose.',
			'The screen stays on while this page is open, if the browser allows it.',
			'Tap an ingredient or step to check it off, and tap it again to uncheck it.',
			'Back to recipe goes back to the full recipe.'
		]
	},
	'/(app)/menu': {
		title: 'Menu',
		points: [
			"The week's dinners, Sunday to Saturday. Today is highlighted.",
			'Tap a day to plan or change its dinner.',
			'On a computer, drag a day onto another day to swap their dinners.',
			'Previous and Next change the week. This week comes back to today.',
			'Requests lists dishes people in your household would like. Request a dish to add one, and Remove one when it is done.'
		]
	},
	'/(app)/menu/[date]': {
		title: 'Dinner',
		points: [
			'Pick the type: Cooking at home, Eating out, Bringing a dish or Leftovers.',
			"Add a dish by searching or typing a new name, then pick its role. Each dish links to its recipe at this dinner's servings.",
			'Set the servings and a note, then tap Save. Everything else saves as soon as you do it.',
			"Copy a dinner reuses the dishes of a dinner you've had before.",
			'Tap the date at the top to move this dinner to another day. If that day has a dinner, the two swap.',
			'Clear removes the dinner. ‹ Week of goes back to the week.'
		]
	},
	'/(app)/household': {
		title: 'Household',
		points: [
			'Settings: the household name, the usual number of servings for new recipes and dinners, and the time zone.',
			'Members: everyone in your household. Any member can remove another.',
			'Invite someone with their Google email. They join when they first sign in with it.',
			'Cancel an invite while it waits for them to sign in.',
			'Stores: add the stores you buy from. Edit renames or archives one, and archived stores can be restored.'
		]
	},
	'/(app)/whats-new': {
		title: "What's new",
		points: [
			'What changed in each update of Meals, newest first.',
			"A dot on More and What's new means there's something you haven't seen. Opening this page clears it."
		]
	},
	'/(app)/admin': {
		title: 'Admin',
		points: [
			"Only the app's admin sees this page.",
			'Backups shows when the last nightly backup ran.',
			'Invite a household with their Google email. They set up their own household when they first sign in.',
			'Households lists every household and when it started.'
		]
	}
};

/** The help for a page in the app layout, which all have help. */
export function helpFor(routeId: string | null): Help {
	if (routeId === null || !Object.hasOwn(HELP, routeId)) throw new Error(`No help for ${routeId}`);
	return HELP[routeId as HelpRouteId];
}
