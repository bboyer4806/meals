import { formatQuantity } from './text.ts';

// What the recipe pages show besides amounts and steps (design 7: Recipes, Recipe and Cooking
// view). Amounts are in scaling.ts and steps in steps.ts.

/** The most servings a recipe can be shown at, the editor's limit too. */
export const MAX_SERVINGS = 100;

/** A time in minutes: "45 min", "1 hr" or "1 hr 15 min". */
export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min`;
	return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Prep plus cook time, counting a missing one as none. Null when neither is set. */
export function totalMinutes(prep: number | null, cook: number | null): number | null {
	if (prep === null && cook === null) return null;
	return (prep ?? 0) + (cook ?? 0);
}

/**
 * The servings to show a recipe at, from the page's `?servings=`: a whole number from 1 to 100.
 * Anything else, or no param, means the recipe's own servings.
 */
export function targetServings(param: string | null, recipeServings: number): number {
	if (param === null || !/^\d+$/.test(param)) return recipeServings;
	const servings = Number(param);
	return servings >= 1 && servings <= MAX_SERVINGS ? servings : recipeServings;
}

/** "1 serving", "8 servings". */
export function servingsLabel(servings: number): string {
	return servings === 1 ? '1 serving' : `${servings} servings`;
}

/** The dish id in a recipe page's path, or null when it isn't one. */
export function parseRecipeId(param: string): number | null {
	if (!/^\d+$/.test(param)) return null;
	const id = Number(param);
	return id > 0 && Number.isSafeInteger(id) ? id : null;
}

/** The source as a link when it's a web address. Anything else, such as a book, is plain text. */
export function sourceLink(source: string): string | null {
	return /^https?:\/\//i.test(source) ? source : null;
}

/** An ingredient as the recipe pages show it. The data layer's DishIngredient is one. */
export type IngredientRow = {
	id: number;
	section: string | null;
	amount: number | null;
	unit: string | null;
	itemName: string;
	prepNote: string | null;
};

/**
 * Ingredients grouped under their section headings (Q31), in order. Each row stores its own
 * section, so a heading starts wherever the section changes. Rows before the first heading have
 * none.
 */
export function groupBySection<T extends { section: string | null }>(
	rows: readonly T[]
): { section: string | null; rows: T[] }[] {
	const groups: { section: string | null; rows: T[] }[] = [];
	for (const row of rows) {
		const group = groups.at(-1);
		if (group && group.section === row.section) group.rows.push(row);
		else groups.push({ section: row.section, rows: [row] });
	}
	return groups;
}

/** Nutrition per serving (Q31b), only the values that were entered. */
export function nutritionFacts(dish: {
	calories: number | null;
	proteinG: number | null;
	carbsG: number | null;
	fatG: number | null;
}): { label: string; value: string }[] {
	const facts = [
		{ label: 'Calories', value: dish.calories, unit: '' },
		{ label: 'Protein', value: dish.proteinG, unit: ' g' },
		{ label: 'Carbs', value: dish.carbsG, unit: ' g' },
		{ label: 'Fat', value: dish.fatG, unit: ' g' }
	];
	return facts.flatMap(({ label, value, unit }) =>
		value === null ? [] : [{ label, value: `${formatQuantity(value)}${unit}` }]
	);
}
