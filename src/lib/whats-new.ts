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
