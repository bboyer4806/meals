import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { exactAmount, parseAmount } from '../amounts.ts';
import { foldCase, normalizeName } from '../text.ts';
import { normalizeUnit } from '../units.ts';
import {
	createDish,
	setDishPhoto,
	updateDish,
	type DishInput,
	type DishSaveResult,
	type IngredientInput
} from './data/dishes.ts';
import { nameField, parseForm, type FormFailure } from './forms.ts';
import { deletePhoto, savePhoto } from './photos.ts';

// The recipe editor's form (design 7, Edit recipe): the text its fields start with, what it
// sends back, checked and normalized for createDish and updateDish, and saving it. The editor's
// maxlength attributes use the same limits.

/**
 * One row of the ingredient editor, as typed. A section row is a heading for the ingredient rows
 * after it. The editor sends its rows as JSON in the `ingredients` field.
 */
export type RecipeRow =
	| { kind: 'section'; heading: string }
	| { kind: 'ingredient'; amount: string; unit: string; item: string; prepNote: string };

/** Every field of the editor as text, named as the form sends them. */
export type RecipeFormValues = {
	name: string;
	servings: string;
	prepMinutes: string;
	cookMinutes: string;
	tags: string;
	steps: string;
	notes: string;
	source: string;
	calories: string;
	proteinG: string;
	carbsG: string;
	fatG: string;
	rows: RecipeRow[];
};

/** A photo picked in the editor and resized on the phone, with its thumbnail. */
export type PhotoUpload = { photo: File; thumb: File };

export type RecipeSubmission = {
	data: DishInput;
	/** A new photo, or null to keep the current one. */
	photo: PhotoUpload | null;
	/** Whether to clear the current photo. Never true with a new photo, which replaces it anyway. */
	removePhoto: boolean;
};

/** archivedId is an archived recipe that has the name, which the page offers to restore. */
export type RecipeFailure = FormFailure & { archivedId?: number };

const ACTION = 'recipe';

function failure(error: string): ActionFailure<RecipeFailure> {
	return fail(400, { action: ACTION, error });
}

/** A new recipe: blank, at the household's usual servings (design 7). */
export function newRecipeValues(servings: number): RecipeFormValues {
	return {
		name: '',
		servings: String(servings),
		prepMinutes: '',
		cookMinutes: '',
		tags: '',
		steps: '',
		notes: '',
		source: '',
		calories: '',
		proteinG: '',
		carbsG: '',
		fatG: '',
		rows: []
	};
}

/**
 * An amount as the editor shows it: as entered (formatExact) when that reads back as the same
 * number, otherwise in full, so saving again doesn't change it (1/6 or 0.0004, say).
 */
function amountText(amount: number): string {
	const shown = exactAmount(amount);
	return Math.abs(shown.value - amount) <= 1e-9 ? shown.text : String(amount);
}

/**
 * A saved recipe as the editor shows it. Amounts show as entered (formatExact), and a heading
 * row starts each run of ingredients in the same section, so the form reads back as the same
 * recipe.
 */
export function recipeValues(recipe: DishInput): RecipeFormValues {
	const rows: RecipeRow[] = [];
	let section: string | null = null;
	for (const ingredient of recipe.ingredients) {
		// Ingredients without a section after ones with a section get a blank heading.
		if (ingredient.section !== section) {
			rows.push({ kind: 'section', heading: ingredient.section ?? '' });
			section = ingredient.section;
		}
		rows.push({
			kind: 'ingredient',
			amount: ingredient.amount === null ? '' : amountText(ingredient.amount),
			unit: ingredient.unit ?? '',
			item: ingredient.itemName,
			prepNote: ingredient.prepNote ?? ''
		});
	}
	return {
		name: recipe.name,
		servings: String(recipe.servings),
		prepMinutes: numberText(recipe.prepMinutes),
		cookMinutes: numberText(recipe.cookMinutes),
		tags: recipe.tags.join(', '),
		steps: recipe.steps ?? '',
		notes: recipe.notes ?? '',
		source: recipe.source ?? '',
		calories: numberText(recipe.calories),
		proteinG: numberText(recipe.proteinG),
		carbsG: numberText(recipe.carbsG),
		fatG: numberText(recipe.fatG),
		rows
	};
}

function numberText(value: number | null): string {
	return value === null ? '' : String(value);
}

function orNull(text: string): string | null {
	return text === '' ? null : text;
}

// A number as a number field sends it: digits with an optional decimal point. Number() alone
// would also take "0x10", "1e3" and "Infinity".
const PLAIN_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A number of at least 0 that may be left blank, for null. */
function optionalNumber(
	max: number,
	whole: boolean,
	messages: { invalid: string; tooBig: string }
) {
	return z
		.string()
		.trim()
		.transform((text, ctx) => {
			if (text === '') return null;
			const value = Number(text);
			if (!PLAIN_NUMBER.test(text) || (whole && !Number.isInteger(value))) {
				ctx.addIssue({ code: 'custom', message: messages.invalid });
				return z.NEVER;
			}
			if (value > max) {
				ctx.addIssue({ code: 'custom', message: messages.tooBig });
				return z.NEVER;
			}
			return value;
		});
}

/** Text over several lines. Browsers send line breaks as \r\n; they're stored as \n. */
function multiline(max: number, what: string) {
	return z
		.string()
		.transform((text) => text.replace(/\r\n?/g, '\n').trim())
		.pipe(z.string().max(max, `Keep the ${what} under ${max} characters`))
		.transform(orNull);
}

/** Comma-separated, each tag once ignoring case. The first spelling wins, as when saving. */
const tagsField = z.string().transform((text, ctx) => {
	const tags = new Map<string, string>();
	for (const part of text.split(',')) {
		const tag = normalizeName(part);
		const key = foldCase(tag);
		if (tag !== '' && !tags.has(key)) tags.set(key, tag);
	}
	const list = [...tags.values()];
	if (list.some((tag) => tag.length > 30)) {
		ctx.addIssue({ code: 'custom', message: 'Keep each tag under 30 characters' });
		return z.NEVER;
	}
	if (list.length > 10) {
		ctx.addIssue({ code: 'custom', message: 'Use 10 tags or fewer' });
		return z.NEVER;
	}
	return list;
});

const rowsSchema = z.array(
	z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('section'), heading: z.string() }),
		z.object({
			kind: z.literal('ingredient'),
			amount: z.string(),
			unit: z.string(),
			item: z.string(),
			prepNote: z.string()
		})
	])
);

// Only a broken page or a hand-made request sends rows that don't fit rowsSchema.
const UNREADABLE = "The ingredients couldn't be read. Reload the page and try again.";

// Two amounts joined like a range: "2-3", "2 to 3", "½ or 1", or with an en or em dash.
const RANGE = /[\d¼½¾⅓⅔⅛⅜⅝⅞]\s*(?:-|\u2013|\u2014|to|or)\s*[\d.¼½¾⅓⅔⅛⅜⅝⅞]/i;

/** The ingredient rows as ingredients, in order, or the first problem with them. */
function readIngredients(json: string): IngredientInput[] | string {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return UNREADABLE;
	}
	const rows = rowsSchema.safeParse(raw);
	if (!rows.success) return UNREADABLE;

	const ingredients: IngredientInput[] = [];
	let section: string | null = null;
	// Rows are numbered as the editor labels them: blank rows count, and headings are counted
	// apart from ingredients.
	let ingredientNumber = 0;
	let sectionNumber = 0;
	for (const row of rows.data) {
		if (row.kind === 'section') {
			sectionNumber += 1;
			const heading = normalizeName(row.heading);
			if (heading.length > 60) {
				return `Section ${sectionNumber}: keep the heading under 60 characters`;
			}
			// A blank heading ends the section above it. A heading with no ingredients after it
			// is dropped, since sections are stored on ingredients.
			section = orNull(heading);
			continue;
		}
		ingredientNumber += 1;
		const ingredient = readIngredient(row, `Ingredient ${ingredientNumber}`, section);
		if (typeof ingredient === 'string') return ingredient;
		if (ingredient) ingredients.push(ingredient);
	}
	if (ingredients.length > 100) return 'Use 100 ingredients or fewer';
	return ingredients;
}

/** One ingredient row, null when it's blank, or its problem. */
function readIngredient(
	row: Extract<RecipeRow, { kind: 'ingredient' }>,
	label: string,
	section: string | null
): IngredientInput | null | string {
	const amountText = row.amount.trim();
	const unit = normalizeUnit(row.unit);
	const itemName = normalizeName(row.item);
	const prepNote = normalizeName(row.prepNote);
	// An empty row, such as the one a new recipe starts with, is left out.
	if (amountText === '' && unit === null && itemName === '' && prepNote === '') return null;

	let amount: number | null = null;
	if (amountText !== '') {
		amount = parseAmount(amountText);
		if (amount === null) {
			// One amount per ingredient; a range goes in the prep note (design 2.3).
			return RANGE.test(amountText)
				? `${label}: enter one amount, and put a range like 2 to 3 in the prep note`
				: `${label}: enter an amount like 1 1/2`;
		}
		if (amount > 10_000) return `${label}: enter a smaller amount`;
	}
	if (unit !== null && unit.length > 20) return `${label}: keep the unit under 20 characters`;
	// A unit alone can't be scaled or shown (design 5).
	if (unit !== null && amount === null) return `${label}: enter an amount, or clear the unit`;
	if (itemName === '') return `${label} needs an item`;
	if (itemName.length > 80) return `${label}: keep the item under 80 characters`;
	if (prepNote.length > 80) return `${label}: keep the prep note under 80 characters`;
	return { section, amount, unit, itemName, prepNote: orNull(prepNote) };
}

const ingredientsField = z.string({ error: UNREADABLE }).transform((json, ctx) => {
	const ingredients = readIngredients(json);
	if (typeof ingredients === 'string') {
		ctx.addIssue({ code: 'custom', message: ingredients });
		return z.NEVER;
	}
	return ingredients;
});

// In the order of the form, so a failure names the first problem on it.
const recipeFields = z.object({
	name: nameField(80, 'a recipe name'),
	servings: z.coerce
		.number({ error: 'Enter a number of servings' })
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(100, 'Enter 100 servings or fewer'),
	prepMinutes: optionalNumber(10_000, true, {
		invalid: 'Enter the prep time in whole minutes',
		tooBig: 'Enter a prep time of 10000 minutes or less'
	}),
	cookMinutes: optionalNumber(10_000, true, {
		invalid: 'Enter the cook time in whole minutes',
		tooBig: 'Enter a cook time of 10000 minutes or less'
	}),
	tags: tagsField,
	ingredients: ingredientsField,
	steps: multiline(10_000, 'steps'),
	notes: multiline(2_000, 'notes'),
	source: z.string().trim().max(500, 'Keep the source under 500 characters').transform(orNull),
	calories: optionalNumber(100_000, false, {
		invalid: 'Enter calories as a number, 0 or more',
		tooBig: 'Enter 100000 calories or less'
	}),
	proteinG: optionalNumber(100_000, false, {
		invalid: 'Enter protein in grams, 0 or more',
		tooBig: 'Enter 100000 g of protein or less'
	}),
	carbsG: optionalNumber(100_000, false, {
		invalid: 'Enter carbs in grams, 0 or more',
		tooBig: 'Enter 100000 g of carbs or less'
	}),
	fatG: optionalNumber(100_000, false, {
		invalid: 'Enter fat in grams, 0 or more',
		tooBig: 'Enter 100000 g of fat or less'
	})
});

/** A file that was sent, null for none, or undefined for something that isn't a file. */
function upload(value: FormDataEntryValue | null): File | null | undefined {
	if (value === null) return null;
	if (!(value instanceof File)) return undefined;
	// A file input left empty sends an empty file.
	return value.size === 0 ? null : value;
}

/**
 * Reads the recipe editor's form. Names, units and amounts are normalized as they're stored,
 * blank optional fields are null, and the rows in `ingredients` become the ingredients, each in
 * the section of the heading above it. Fully blank rows are left out. A failure names the first
 * problem, in the order of the form.
 *
 * A new photo comes as two files, `photo` and `thumb`. `removePhoto` set to '1' asks to clear the
 * current photo.
 */
export function parseRecipeForm(
	formData: FormData
): RecipeSubmission | { failure: ActionFailure<RecipeFailure> } {
	const parsed = parseForm(recipeFields, formData, ACTION);
	if ('failure' in parsed) return parsed;
	const data: DishInput = parsed.data;

	const photo = upload(formData.get('photo'));
	const thumb = upload(formData.get('thumb'));
	if (photo === undefined || thumb === undefined || (photo === null) !== (thumb === null)) {
		return { failure: failure("The photo couldn't be uploaded. Choose it again.") };
	}
	return {
		data,
		photo: photo && thumb ? { photo, thumb } : null,
		removePhoto: photo === null && formData.get('removePhoto') === '1'
	};
}

/**
 * The failure for a name another recipe already has (createDish and updateDish return `taken`).
 * An archived recipe can be restored instead (design 6.10).
 */
export function nameTakenFailure(
	name: string,
	taken: { archived: boolean; id: number }
): ActionFailure<RecipeFailure> {
	if (taken.archived) {
		const error = `An archived recipe is called ${name}.`;
		return fail(400, { action: ACTION, error, archivedId: taken.id });
	}
	return failure(`A recipe is already called ${name}.`);
}

/**
 * Removes a photo's files when nothing should point at them. A file left behind only takes up
 * space, so a failure here is logged rather than failing a save that has already happened.
 */
function discardPhoto(key: string): void {
	try {
		deletePhoto(key);
	} catch (e) {
		console.error(`Couldn't delete photo ${key}`, e);
	}
}

/**
 * Saves the recipe editor's form as a new recipe (`dishId` null) or over an existing one, and
 * returns its id. Problems the person can fix come back as a failure, with nothing changed.
 *
 * A new photo is stored before the recipe, so a photo the server refuses changes nothing, and
 * its files are deleted again if the recipe isn't saved or doesn't take the photo. The photo it
 * replaces, or the one removed, is deleted once the recipe no longer points at it.
 */
export async function saveRecipe(
	householdId: number,
	dishId: number | null,
	formData: FormData,
	now: number
): Promise<{ id: number } | { failure: ActionFailure<RecipeFailure> }> {
	const parsed = parseRecipeForm(formData);
	if ('failure' in parsed) return parsed;
	const { data, photo, removePhoto } = parsed;

	let photoKey: string | null = null;
	if (photo) {
		try {
			photoKey = await savePhoto(photo.photo, photo.thumb);
		} catch (e) {
			// Not a JPEG, or too large.
			if (isHttpError(e, 400)) return { failure: failure(e.body.message) };
			throw e;
		}
	}

	let saved: DishSaveResult;
	let previousKey: string | null = null;
	try {
		saved =
			dishId === null
				? createDish(householdId, data, now)
				: updateDish(householdId, dishId, data, now);
		if (saved.kind === 'saved' && (photoKey !== null || removePhoto)) {
			previousKey = setDishPhoto(householdId, saved.id, photoKey, now);
		}
	} catch (e) {
		if (photoKey !== null) discardPhoto(photoKey);
		if (isHttpError(e, 400)) return { failure: failure(e.body.message) };
		throw e;
	}

	if (saved.kind === 'taken') {
		if (photoKey !== null) discardPhoto(photoKey);
		return { failure: nameTakenFailure(data.name, saved) };
	}
	if (previousKey !== null) discardPhoto(previousKey);
	return { id: saved.id };
}
