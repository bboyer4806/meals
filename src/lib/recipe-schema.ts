import { splitIngredient } from './ingredient-text.ts';
import { IMPORT_MAX_LENGTH, NORMALIZE_MAX_LENGTH, normalizeName } from './text.ts';
import type { RecipeFormValues, RecipeRow } from './server/recipe-form.ts';

// Reading a web page's schema.org Recipe, which most recipe sites embed as JSON-LD for search
// engines, into the recipe editor's fields (design 7, Import from a link). It only reads JSON
// that's already parsed, so the browser can use it too.

/** A JSON-LD node: a parsed JSON object. */
export type JsonLdNode = { [key: string]: unknown };

/** A field the page has more of than the editor takes, so the rest was left out (MEA-84). */
export type LeftOut = 'ingredients' | 'steps';

/** The editor's fields a page's Recipe fills in (design 7, Import from a link). */
export type PageField =
	| 'name'
	| 'servings'
	| 'prepMinutes'
	| 'cookMinutes'
	| 'steps'
	| 'calories'
	| 'proteinG'
	| 'carbsG'
	| 'fatG'
	| 'rows';

/**
 * A Recipe read into the editor's fields: each as the page writes it, or null where the page has
 * none or it can't be read, so a field the page leaves out never replaces what the editor has
 * (MEA-264).
 */
export type PageValues = { [F in PageField]: RecipeFormValues[F] | null };

/** A Recipe read into the editor's fields, and the fields it has more of than the editor takes. */
export type PageRecipe = { values: PageValues; leftOut: LeftOut[] };

/** What Import from a link gives Edit recipe: the page's fields, and the link as its Source. */
export type LinkValues = PageValues & { source: string };

/** What Import from a link gives New recipe: every field, filled in as filledIn fills them. */
export type ImportedRecipe = { values: RecipeFormValues; leftOut: LeftOut[] };

// The editor's limits (server/recipe-form.ts): a recipe takes up to 100 ingredients and 10,000
// characters of steps. Reading stops there, so a page of millions of them can't hold up the
// server or send the person's phone rows that Save would refuse (MEA-84).
const MAX_INGREDIENTS = 100;
const MAX_STEPS_LENGTH = 10_000;

// How many lists, @graphs and sections deep findRecipe and stepTexts look. Pages nest a few, and
// following a broken page's millions would run out of stack (MEA-84).
const MAX_DEPTH = 32;

function isNode(value: unknown): value is JsonLdNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The first schema.org Recipe in a page's parsed JSON-LD: a node, a list of nodes, or a node
 * whose @graph holds them, up to MAX_DEPTH lists and @graphs deep. Null when there's none.
 * `depth` is how deep `jsonLd` is.
 */
export function findRecipe(jsonLd: unknown, depth = 0): JsonLdNode | null {
	if (depth > MAX_DEPTH) return null;
	if (Array.isArray(jsonLd)) {
		for (const node of jsonLd) {
			const recipe = findRecipe(node, depth + 1);
			if (recipe) return recipe;
		}
		return null;
	}
	if (!isNode(jsonLd)) return null;
	if ([jsonLd['@type']].flat().includes('Recipe')) return jsonLd;
	return findRecipe(jsonLd['@graph'], depth + 1);
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

/** Reads one piece of a page's text (plainReader). */
type Plain = (text: string) => string;

/**
 * Reads pieces of text that can hold HTML, each as one line without tags or character
 * references. A piece over the most normalizing takes (text.ts) is cut to it first. Once the
 * pieces come to the most one import reads (text.ts), the piece there is cut and the rest read as
 * blank (MEA-234). The editor shows what was read before anything is saved.
 */
function plainReader(): Plain {
	let left = IMPORT_MAX_LENGTH;
	return (text) => {
		if (left === 0) return '';
		const line = decodeEntities(text.replace(BREAK, ' ').replace(TAG, ''));
		const read = line.slice(0, Math.min(NORMALIZE_MAX_LENGTH, left));
		left -= read.length;
		return normalizeName(read);
	};
}

/** Whether a line says anything: some sites put a comma alone between paragraphs. */
function hasText(line: string): boolean {
	return /[\p{L}\p{N}]/u.test(line);
}

/** The recipe's name, or null when it has none. */
function recipeName(value: unknown, plain: Plain): string | null {
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

/** A field as read: null when the page has none, and whether the page has more than was read. */
type Read<T> = { value: T | null; leftOut: boolean };

/** The first `count` texts in a JSON-LD value that's a list of them, or one. */
function firstTexts(value: unknown, count: number): string[] {
	const texts: string[] = [];
	for (const entry of Array.isArray(value) ? value : [value]) {
		if (texts.length === count) break;
		if (typeof entry === 'string') texts.push(entry);
	}
	return texts;
}

/**
 * Each of recipeIngredient's first 100 entries, the most the editor takes, as an editor row split
 * as Import recipes splits them. Blank entries count but make no row, so a page of millions of
 * them stops there too.
 */
function ingredientRows(recipeIngredient: unknown, plain: Plain): Read<RecipeRow[]> {
	// One more than are read, to know whether the page has more.
	const entries = firstTexts(recipeIngredient, MAX_INGREDIENTS + 1);
	const rows = entries
		.slice(0, MAX_INGREDIENTS)
		.map(plain)
		.filter(hasText)
		.map((line): RecipeRow => ({ kind: 'ingredient', ...splitIngredient(line) }));
	return { value: rows.length > 0 ? rows : null, leftOut: entries.length > MAX_INGREDIENTS };
}

/**
 * Gives recipeInstructions' text to `read` one line at a time, in order, until `read` gives false:
 * text, such as paragraphs, split into its lines; or steps, with or without HowToSections around
 * them, whose names are left out. Lists and sections more than MAX_DEPTH deep aren't read.
 * `depth` is how deep `instructions` is. False when `read` stopped it.
 */
function stepTexts(instructions: unknown, read: (text: string) => boolean, depth = 0): boolean {
	if (depth > MAX_DEPTH) return true;
	if (typeof instructions === 'string') {
		return instructions.replace(BREAK, '\n').split('\n').every(read);
	}
	if (Array.isArray(instructions)) {
		return instructions.every((step) =>
			typeof step === 'string' ? read(step) : stepTexts(step, read, depth + 1)
		);
	}
	if (!isNode(instructions)) return true;
	// A HowToSection holds its HowToSteps in itemListElement.
	if (instructions.itemListElement !== undefined) {
		return stepTexts(instructions.itemListElement, read, depth + 1);
	}
	return typeof instructions.text === 'string' ? read(instructions.text) : true;
}

/**
 * The steps, one per line, in the whole lines that fit in the 10,000 characters the editor takes.
 * Every line read counts, with a line break between each, blank ones too, so a page of millions of
 * blank lines stops there as well. Blank lines then make no step.
 */
function steps(instructions: unknown, plain: Plain): Read<string> {
	const lines: string[] = [];
	// The first line has no line break before it.
	let length = -1;
	const leftOut = !stepTexts(instructions, (text) => {
		const line = plain(text);
		length += line.length + 1;
		if (length > MAX_STEPS_LENGTH) return false;
		if (hasText(line)) lines.push(line);
		return true;
	});
	return { value: lines.length > 0 ? lines.join('\n') : null, leftOut };
}

// A comma or space between a digit and exactly three more, as between the thousands in 1,250 or
// 1 250 (MEA-76, MEA-233). The digit before keeps "approx. 250 kcal" from reading as .250.
const THOUSANDS = /(?<=\d)[\s,](?=\d{3}(?!\d))/g;

/**
 * The number a nutrition value starts with, such as 240 in "240 kcal", 12.5 in "12.5 g" or 1250
 * in "1,250 kcal" and "1 250 kcal". A period is always a decimal point, so "1.250 kcal" is 1.25
 * (MEA-233). Null when its digits go on after any other comma, as in "12,5 g", rather than guess
 * whether that comma is a decimal point (MEA-76).
 */
function nutrient(value: unknown): string | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	const number = /\d*\.?\d+(,\d)?/.exec(String(value).replace(THOUSANDS, ''));
	return number && number[1] === undefined ? number[0] : null;
}

/**
 * The editor's fields read from a Recipe: its name, servings, prep and cook minutes, ingredients,
 * steps one per line, and calories, protein, carbs and fat. A field the Recipe leaves out, or
 * that can't be read, is null (PageValues). Values are as the page writes them, and the editor
 * checks them when the recipe is saved. The text is read in the editor's order, the name, the
 * ingredients and then the steps, so a page with more than one import reads loses its last steps
 * first (plainReader). Ingredients and steps are read up to the most the editor takes, and
 * leftOut names those the page has more of.
 */
export function schemaRecipeValues(recipe: JsonLdNode): PageRecipe {
	const nutrition = isNode(recipe.nutrition) ? recipe.nutrition : {};
	const plain = plainReader();
	const name = recipeName(recipe.name, plain);
	const rows = ingredientRows(recipe.recipeIngredient, plain);
	const stepText = steps(recipe.recipeInstructions, plain);
	const leftOut: LeftOut[] = [];
	if (rows.leftOut) leftOut.push('ingredients');
	if (stepText.leftOut) leftOut.push('steps');
	return {
		values: {
			name,
			servings: servings(recipe.recipeYield),
			prepMinutes: minutes(recipe.prepTime),
			cookMinutes: minutes(recipe.cookTime),
			steps: stepText.value,
			calories: nutrient(nutrition.calories),
			proteinG: nutrient(nutrition.proteinContent),
			carbsG: nutrient(nutrition.carbohydrateContent),
			fatG: nutrient(nutrition.fatContent),
			rows: rows.value
		},
		leftOut
	};
}

/**
 * A new recipe's fields filled in from a page's (New recipe): each field the page has, and the
 * rest as they are in `start`, which tags, notes and source always are.
 */
export function filledIn(start: RecipeFormValues, values: PageValues): RecipeFormValues {
	return {
		...start,
		name: values.name ?? start.name,
		servings: values.servings ?? start.servings,
		prepMinutes: values.prepMinutes ?? start.prepMinutes,
		cookMinutes: values.cookMinutes ?? start.cookMinutes,
		steps: values.steps ?? start.steps,
		calories: values.calories ?? start.calories,
		proteinG: values.proteinG ?? start.proteinG,
		carbsG: values.carbsG ?? start.carbsG,
		fatG: values.fatG ?? start.fatG,
		rows: values.rows ?? start.rows
	};
}
