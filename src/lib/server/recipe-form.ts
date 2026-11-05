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
import { idList, nameField, sentMax, sentPhoto, type PhotoUpload } from './forms.ts';
import { discardPhoto, savePhoto } from './photos.ts';

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

export type RecipeSubmission = {
	data: DishInput;
	/** A new photo, or null to keep the current one. */
	photo: PhotoUpload | null;
	/** Whether to clear the current photo. Never true with a new photo, which replaces it anyway. */
	removePhoto: boolean;
	/** The archived items the person agreed to restore, if the recipe uses them (design 6.10). */
	restoreItemIds: number[];
};

/** A field of the editor other than the ingredient rows, named as the form sends it. */
export type RecipeField = Exclude<keyof RecipeFormValues, 'rows'>;

/** A field of an ingredient row: a section's heading, or one of an ingredient's fields. */
export type RowField = 'heading' | 'amount' | 'unit' | 'item' | 'prepNote';

/** A problem with a field of the ingredient row at `row`, its place in the rows sent. */
export type RowProblem = { row: number; field: RowField; message: string };

/**
 * Why a save didn't go through (design 7, Edit recipe). `error` is a problem that isn't about one
 * field, shown above the form. `fields` holds each field's problem and `rows` the ingredient rows',
 * each shown beside its field (MEA-207). archivedId is an archived recipe that has the name, which
 * the page offers to restore. archivedItems are archived items the recipe would start using, which
 * the page offers to restore by saving again.
 */
export type RecipeFailure = {
	action: string;
	error?: string;
	fields?: Partial<Record<RecipeField, string>>;
	rows?: RowProblem[];
	archivedId?: number;
	archivedItems?: { id: number; name: string }[];
};

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

/**
 * Comma-separated, each tag once ignoring case. The first spelling wins, as when saving. The
 * field's length, the editor's limit, is checked before the tags are normalized (text.ts).
 */
const tagsField = z
	.string()
	.max(400, 'Keep the tags under 400 characters')
	.transform((text, ctx) => {
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
const MAX_ROWS = 1000;
// 1000 rows with every field at its longest come to about 250,000 characters.
const MAX_LENGTH = 300_000;
const UNREADABLE = "The ingredients couldn't be read. Reload the page and try again.";

// Two amounts joined like a range: "2-3", "2 to 3", "½ or 1", or with an en or em dash.
const RANGE = /[\d¼½¾⅓⅔⅛⅜⅝⅞]\s*(?:-|\u2013|\u2014|to|or)\s*[\d.¼½¾⅓⅔⅛⅜⅝⅞]/i;

/**
 * A problem with the ingredient rows. Its path, like a Zod issue's, is the row's place in the
 * rows and the field it's about, or empty for a problem with the rows as a whole.
 */
type RowsProblem = { path: [] | [number, RowField]; message: string };

type ReadRows = { ingredients: IngredientInput[] } | { problems: RowsProblem[] };

/** A problem with the rows as a whole. */
function rowsProblem(message: string): ReadRows {
	return { problems: [{ path: [], message }] };
}

/** The ingredient rows as ingredients, in order, or every problem with them. */
function readIngredients(json: string): ReadRows {
	// Both limits are checked before the rows are read: JSON.parse of 5 MB of nested brackets,
	// and Zod noting a problem for each of millions of bad rows, each take seconds.
	if (json.length > MAX_LENGTH) return rowsProblem(UNREADABLE);
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return rowsProblem(UNREADABLE);
	}
	if (!Array.isArray(raw) || raw.length > MAX_ROWS) return rowsProblem(UNREADABLE);
	const rows = rowsSchema.safeParse(raw);
	if (!rows.success) return rowsProblem(UNREADABLE);

	// Rows are numbered as the editor labels them: blank rows count, and headings are counted
	// apart from ingredients.
	let ingredientNumber = 0;
	let sectionNumber = 0;
	const labeled = rows.data.map((row) => {
		if (row.kind === 'section') {
			sectionNumber += 1;
			return { row, label: `Section ${sectionNumber}` };
		}
		ingredientNumber += 1;
		return { row, label: `Ingredient ${ingredientNumber}` };
	});
	return readRows(labeled);
}

/**
 * The problem with a row's field over its limit, such as "Ingredient 2: keep the item under 80
 * characters". A field is checked as sent, against sentMax (forms.ts), before it's normalized,
 * and then as normalized.
 */
function tooLong(label: string, field: string, max: number): string {
	return `${label}: keep the ${field} under ${max} characters`;
}

/**
 * The rows as ingredients, in order, each in the section of the heading above it, or every
 * problem with them, in the order of the rows. A problem with a row starts with its label. Fully
 * blank rows are left out.
 */
export function readRows(rows: { row: RecipeRow; label: string }[]): ReadRows {
	const ingredients: IngredientInput[] = [];
	const problems: RowsProblem[] = [];
	// Ingredient rows that aren't blank, whether or not they have a problem.
	let filled = 0;
	let section: string | null = null;
	for (const [at, { row, label }] of rows.entries()) {
		if (row.kind === 'section') {
			const heading = row.heading.length > sentMax(60) ? null : normalizeName(row.heading);
			if (heading === null || heading.length > 60) {
				problems.push({ path: [at, 'heading'], message: tooLong(label, 'heading', 60) });
				continue;
			}
			// A blank heading ends the section above it. A heading with no ingredients after it
			// is dropped, since sections are stored on ingredients.
			section = orNull(heading);
			continue;
		}
		const ingredient = readIngredient(row, at, label, section);
		if (ingredient === null) continue;
		filled += 1;
		if (Array.isArray(ingredient)) problems.push(...ingredient);
		else ingredients.push(ingredient);
	}
	if (filled > 100) problems.push({ path: [], message: 'Use 100 ingredients or fewer' });
	return problems.length > 0 ? { problems } : { ingredients };
}

/**
 * One ingredient row, at `at` in the rows: null when it's blank, or every problem with it, at
 * most one for each field, in the order they're checked.
 */
function readIngredient(
	row: Extract<RecipeRow, { kind: 'ingredient' }>,
	at: number,
	label: string,
	section: string | null
): IngredientInput | null | RowsProblem[] {
	const problems: RowsProblem[] = [];
	const problem = (field: RowField, message: string) => {
		problems.push({ path: [at, field], message });
	};
	// A field over sentMax isn't normalized (tooLong), so it's undefined here.
	const unit = row.unit.length > sentMax(20) ? undefined : normalizeUnit(row.unit);
	const itemName = row.item.length > sentMax(80) ? undefined : normalizeName(row.item);
	const prepNote = row.prepNote.length > sentMax(80) ? undefined : normalizeName(row.prepNote);
	if (unit === undefined) problem('unit', tooLong(label, 'unit', 20));
	if (itemName === undefined) problem('item', tooLong(label, 'item', 80));
	if (prepNote === undefined) problem('prepNote', tooLong(label, 'prep note', 80));
	const amountText = row.amount.trim();
	// An empty row, such as the one a new recipe starts with, is left out.
	if (amountText === '' && unit === null && itemName === '' && prepNote === '') return null;

	let amount: number | null = null;
	if (amountText !== '') {
		amount = parseAmount(amountText);
		if (amount === null) {
			// One amount per ingredient; a range goes in the prep note (design 2.3).
			problem(
				'amount',
				RANGE.test(amountText)
					? `${label}: enter one amount, and put a range like 2 to 3 in the prep note`
					: `${label}: enter an amount like 1 1/2`
			);
		} else if (amount > 10_000) {
			problem('amount', `${label}: enter a smaller amount`);
		} else if (amount < 0.001) {
			// The smallest amount a recipe shows (amounts.ts).
			problem('amount', `${label}: enter a larger amount`);
		}
	}
	if (typeof unit === 'string' && unit.length > 20) problem('unit', tooLong(label, 'unit', 20));
	// A unit alone can't be scaled or shown (design 5).
	if (typeof unit === 'string' && amountText === '') {
		problem('amount', `${label}: enter an amount, or clear the unit`);
	}
	if (itemName === '') problem('item', `${label} needs an item`);
	else if (itemName !== undefined && itemName.length > 80) {
		problem('item', tooLong(label, 'item', 80));
	}
	if (prepNote !== undefined && prepNote.length > 80) {
		problem('prepNote', tooLong(label, 'prep note', 80));
	}
	// A field over sentMax always has a problem, so the rest were normalized.
	if (
		problems.length > 0 ||
		unit === undefined ||
		itemName === undefined ||
		prepNote === undefined
	) {
		return problems;
	}
	return { section, amount, unit, itemName, prepNote: orNull(prepNote) };
}

// Each problem with the rows is an issue on `ingredients`, at its row and field.
const ingredientsField = z.string({ error: UNREADABLE }).transform((json, ctx) => {
	const read = readIngredients(json);
	if ('ingredients' in read) return read.ingredients;
	for (const problem of read.problems) ctx.addIssue({ code: 'custom', ...problem });
	return z.NEVER;
});

// In the order of the form. Import recipes names a row's first problem in this order.
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

/** The editor's fields other than the ingredients, with the same checks, for Import recipes. */
export const recipeDetailFields = recipeFields.omit({ ingredients: true });

/**
 * The ids the editor's "Restore and save" button sends: the archived items the recipe would start
 * using (6.10). A recipe has at most 100 ingredients, so there are at most 100 ids, and 1000
 * characters fits 100 ids of up to 9 digits. The length is checked before the ids are split, as
 * splitting 5 MB of commas takes seconds and gigabytes of memory (MEA-65).
 */
const restoreItemsField = z.string().max(1000).pipe(idList);

/**
 * The failure for fields with problems (MEA-207): each field's first problem, and each ingredient
 * row's, by the row's place and field. A problem with the ingredients as a whole isn't about one
 * field, so it's the failure's `error`.
 */
function fieldsFailure(issues: z.ZodError['issues']): ActionFailure<RecipeFailure> {
	let error: string | undefined;
	const fields: Partial<Record<RecipeField, string>> = {};
	const rows: RowProblem[] = [];
	for (const { path, message } of issues) {
		// As recipeFields and readRows make them: a field's name, or `ingredients` and, for a
		// row's field, the row's place and the field.
		const [field, row, rowField] = path as [RecipeField | 'ingredients', number?, RowField?];
		if (field !== 'ingredients') fields[field] ??= message;
		else if (row === undefined || rowField === undefined) error ??= message;
		else rows.push({ row, field: rowField, message });
	}
	return fail(400, { action: ACTION, error, fields, rows });
}

/**
 * Reads the recipe editor's form. Names, units and amounts are normalized as they're stored,
 * blank optional fields are null, and the rows in `ingredients` become the ingredients, each in
 * the section of the heading above it. Fully blank rows are left out. A failure has every
 * problem with the fields at once (fieldsFailure), or else the one with the photo or the items
 * to restore.
 *
 * A new photo comes as two files, `photo` and `thumb`. `removePhoto` set to '1' asks to clear the
 * current photo. `restoreItems`, sent by the editor's "Restore and save" button, lists the ids of
 * the archived items it asked about, joined by commas.
 */
export function parseRecipeForm(
	formData: FormData
): RecipeSubmission | { failure: ActionFailure<RecipeFailure> } {
	const parsed = recipeFields.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { failure: fieldsFailure(parsed.error.issues) };
	const data: DishInput = parsed.data;

	const photo = sentPhoto(formData);
	if (photo === undefined) {
		return { failure: failure("The photo couldn't be uploaded. Choose it again.") };
	}

	const restore = formData.get('restoreItems');
	let restoreItemIds: number[] = [];
	if (restore !== null) {
		const ids = restoreItemsField.safeParse(restore);
		if (!ids.success) {
			return {
				failure: failure("The items to restore couldn't be read. Reload the page and try again.")
			};
		}
		restoreItemIds = ids.data;
	}
	return {
		data,
		photo,
		removePhoto: photo === null && formData.get('removePhoto') === '1',
		restoreItemIds
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
 * The failure for a recipe that would start using archived items (createDish and updateDish
 * return `archived`). Saving again with their ids in `restoreItems` restores them (design 6.10).
 */
export function archivedItemsFailure(
	items: { id: number; name: string }[]
): ActionFailure<RecipeFailure> {
	const names = items.map((item) => item.name);
	const one = names.length === 1;
	// "Salt", "Salt and Pepper", or "Salt, Pepper and Cumin".
	const list = one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
	const error = one
		? `${list} is archived. Restore it and save the recipe?`
		: `${list} are archived. Restore them and save the recipe?`;
	return fail(400, { action: ACTION, error, archivedItems: items });
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
	const { data, photo, removePhoto, restoreItemIds } = parsed;

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
				? createDish(householdId, data, restoreItemIds, now)
				: updateDish(householdId, dishId, data, restoreItemIds, now);
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
	if (saved.kind === 'archived') {
		if (photoKey !== null) discardPhoto(photoKey);
		return { failure: archivedItemsFailure(saved.items) };
	}
	if (previousKey !== null) discardPhoto(previousKey);
	return { id: saved.id };
}
