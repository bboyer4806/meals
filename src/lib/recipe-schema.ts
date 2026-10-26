import { splitIngredient } from './ingredient-text.ts';
import { normalizeName } from './text.ts';
import type { RecipeFormValues, RecipeRow } from './server/recipe-form.ts';

// Reading a web page's schema.org Recipe, which most recipe sites embed as JSON-LD for search
// engines, into the recipe editor's fields (design 7, Import from a link). It only reads JSON
// that's already parsed, so the browser can use it too.

/** A JSON-LD node: a parsed JSON object. */
export type JsonLdNode = { [key: string]: unknown };

function isNode(value: unknown): value is JsonLdNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The first schema.org Recipe in a page's parsed JSON-LD: a node, a list of nodes, or a node
 * whose @graph holds them. Null when there's none.
 */
export function findRecipe(jsonLd: unknown): JsonLdNode | null {
	if (Array.isArray(jsonLd)) {
		for (const node of jsonLd) {
			const recipe = findRecipe(node);
			if (recipe) return recipe;
		}
		return null;
	}
	if (!isNode(jsonLd)) return null;
	if ([jsonLd['@type']].flat().includes('Recipe')) return jsonLd;
	return findRecipe(jsonLd['@graph']);
}

// The character references recipe sites use, such as &amp; and &frac12;. Numeric ones, such as
// &#39;, are all read. The fractions are the ones amounts can be typed with (6.5).
const ENTITIES = new Map([
	['amp', '&'],
	['lt', '<'],
	['gt', '>'],
	['quot', '"'],
	['apos', "'"],
	['nbsp', ' '],
	['deg', '°'],
	['ndash', '–'],
	['mdash', '—'],
	['lsquo', '‘'],
	['rsquo', '’'],
	['ldquo', '“'],
	['rdquo', '”'],
	['hellip', '…'],
	['frac14', '¼'],
	['frac12', '½'],
	['frac34', '¾'],
	['frac13', '⅓'],
	['frac23', '⅔'],
	['frac18', '⅛'],
	['frac38', '⅜'],
	['frac58', '⅝'],
	['frac78', '⅞']
]);
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|([a-z\d]+));/gi;

function decodeEntities(text: string): string {
	return text.replace(ENTITY, (entity, decimal?: string, hex?: string, name?: string) => {
		if (name !== undefined) return ENTITIES.get(name) ?? entity;
		const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16);
		return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
}

// A line break in HTML: <br>, or the start or end of a paragraph, list item or the like. A tag
// ends at the next < as well as at >, so each search for one stops where the next could start:
// text written to make the search backtrack would otherwise take minutes.
const BREAK = /<\/?(?:br|p|div|li|ol|ul|h[1-6])\b[^<>]*>/gi;
// Any other tag, such as a link around an ingredient's name.
const TAG = /<\/?[a-z][^<>]*>/gi;

/** Text that can hold HTML, as one line without tags or character references. */
function plain(text: string): string {
	return normalizeName(decodeEntities(text.replace(BREAK, ' ').replace(TAG, '')));
}

/** Whether a line says anything: some sites put a comma alone between paragraphs. */
function hasText(line: string): boolean {
	return /[\p{L}\p{N}]/u.test(line);
}

/** The recipe's name, or null when it has none. */
function recipeName(value: unknown): string | null {
	const text = typeof value === 'string' ? plain(value) : '';
	return hasText(text) ? text : null;
}

/** The first whole number in recipeYield, such as 4 in "4 servings" or ["28", "28-32 cookies"]. */
function servings(recipeYield: unknown): string | null {
	for (const entry of [recipeYield].flat()) {
		if (typeof entry !== 'string' && typeof entry !== 'number') continue;
		const number = /\d+/.exec(String(entry));
		if (number) return number[0];
	}
	return null;
}

// A duration as schema.org writes times, in ISO 8601: PT1H30M, or P0DT0H20M.
const DURATION =
	/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/** A duration in whole minutes, such as 90 for PT1H30M, or null when it isn't one. */
function minutes(duration: unknown): string | null {
	if (typeof duration !== 'string') return null;
	const parts = DURATION.exec(duration.trim())?.slice(1);
	if (!parts || parts.every((part) => part === undefined)) return null;
	const [days = 0, hours = 0, mins = 0, seconds = 0] = parts.map((part) => Number(part ?? 0));
	return String(Math.round(days * 24 * 60 + hours * 60 + mins + seconds / 60));
}

/** Each entry of recipeIngredient as an editor row, split as Import recipes splits them. */
function ingredientRows(recipeIngredient: unknown): RecipeRow[] | null {
	const rows = [recipeIngredient]
		.flat()
		.filter((entry) => typeof entry === 'string')
		.map(plain)
		.filter(hasText)
		.map((line): RecipeRow => ({ kind: 'ingredient', ...splitIngredient(line) }));
	return rows.length > 0 ? rows : null;
}

/**
 * recipeInstructions as one line per step: text, such as paragraphs, split into its lines; or
 * steps, with or without HowToSections around them, whose names are left out.
 */
function stepLines(instructions: unknown): string[] {
	if (typeof instructions === 'string') {
		return instructions.replace(BREAK, '\n').split('\n').map(plain);
	}
	if (Array.isArray(instructions)) {
		return instructions.flatMap((step) =>
			typeof step === 'string' ? [plain(step)] : stepLines(step)
		);
	}
	if (!isNode(instructions)) return [];
	// A HowToSection holds its HowToSteps in itemListElement.
	if (instructions.itemListElement !== undefined) return stepLines(instructions.itemListElement);
	return typeof instructions.text === 'string' ? [plain(instructions.text)] : [];
}

function steps(instructions: unknown): string | null {
	const lines = stepLines(instructions).filter(hasText);
	return lines.length > 0 ? lines.join('\n') : null;
}

/** The number a nutrition value starts with, such as 240 in "240 kcal" or 12.5 in "12.5 g". */
function nutrient(value: unknown): string | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	return /\d*\.?\d+/.exec(String(value))?.[0] ?? null;
}

/**
 * The editor's fields filled in from a Recipe: its name, servings, prep and cook minutes,
 * ingredients, steps one per line, and calories, protein, carbs and fat. A field the Recipe leaves
 * out, or that can't be read, keeps its value in `start`, as do tags, notes and source. Values are
 * as the page writes them, and the editor checks them when the recipe is saved.
 */
export function schemaRecipeValues(recipe: JsonLdNode, start: RecipeFormValues): RecipeFormValues {
	const nutrition = isNode(recipe.nutrition) ? recipe.nutrition : {};
	return {
		...start,
		name: recipeName(recipe.name) ?? start.name,
		servings: servings(recipe.recipeYield) ?? start.servings,
		prepMinutes: minutes(recipe.prepTime) ?? start.prepMinutes,
		cookMinutes: minutes(recipe.cookTime) ?? start.cookMinutes,
		steps: steps(recipe.recipeInstructions) ?? start.steps,
		calories: nutrient(nutrition.calories) ?? start.calories,
		proteinG: nutrient(nutrition.proteinContent) ?? start.proteinG,
		carbsG: nutrient(nutrition.carbohydrateContent) ?? start.carbsG,
		fatG: nutrient(nutrition.fatContent) ?? start.fatG,
		rows: ingredientRows(recipe.recipeIngredient) ?? start.rows
	};
}
