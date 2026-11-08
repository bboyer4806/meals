import { parseAmount } from './amounts.ts';
import type { LinkValues } from './recipe-schema.ts';
import type { RecipeFormValues, RecipeRow } from './server/recipe-form.ts';
import { foldCase, normalizeName } from './text.ts';
import { normalizeUnit } from './units.ts';

// Import from a link on Edit recipe (design 7; MEA-264): what the page's recipe would change in
// the editor, compared with the editor as it is, unsaved changes included, and the editor once
// the review is applied. An empty field fills in from the page, but nothing in the editor is
// replaced, and no ingredient added, unless the person chooses it. A field the page has none of
// stays as it is. The photo, tags and notes are never compared.

/** The fields compared one by one, in the editor's order. The steps are one field. */
const FIELDS = [
	'name',
	'servings',
	'prepMinutes',
	'cookMinutes',
	'steps',
	'source',
	'calories',
	'proteinG',
	'carbsG',
	'fatG'
] as const;

export type ReviewField = (typeof FIELDS)[number];

// The fields that hold numbers, which are the same when their numbers are.
const NUMBER_FIELDS = new Set<ReviewField>([
	'servings',
	'prepMinutes',
	'cookMinutes',
	'calories',
	'proteinG',
	'carbsG',
	'fatG'
]);

/** An empty field of the editor, and the page's value, which fills it in. */
export type Fill = { field: ReviewField; imported: string };

/** A field the page has something else for, and whether to replace it, which starts false. */
export type Conflict = { field: ReviewField; current: string; imported: string; replace: boolean };

/** An ingredient row's fields. */
export type Ingredient = Omit<Extract<RecipeRow, { kind: 'ingredient' }>, 'kind'>;

/** An ingredient in the editor: its place in the rows, its label there and its fields. */
export type EditorIngredient = { at: number; label: string; ingredient: Ingredient };

/**
 * What to do with one of the page's ingredients: nothing ('skip'), add it at the end ('add'), or
 * replace the editor's ingredient at that place in the rows.
 */
export type IngredientChoice = 'skip' | 'add' | number;

/**
 * One of the page's ingredients that isn't already in the editor, and the choice made for it,
 * which starts at 'skip'. It's `new` when the editor has no ingredient with its item, so it can
 * be added. It's a `match` when the editor has one with its item and the page no other, so it can
 * replace that one. Otherwise the editor or the page has its item more than once, so the person
 * chooses: replace one of the `candidates`, or add it.
 */
export type IngredientEntry =
	| { kind: 'new'; imported: Ingredient; choice: IngredientChoice }
	| { kind: 'match'; imported: Ingredient; current: EditorIngredient; choice: IngredientChoice }
	| {
			kind: 'choose';
			imported: Ingredient;
			candidates: EditorIngredient[];
			choice: IngredientChoice;
	  };

/** What the page's recipe would change in the editor, and what the person chose. */
export type Review = { fills: Fill[]; conflicts: Conflict[]; ingredients: IngredientEntry[] };

/** Whether a field's two values are the same: numbers by value, text without spaces at its ends. */
function sameField(field: ReviewField, a: string, b: string): boolean {
	if (NUMBER_FIELDS.has(field)) return Number(a) === Number(b);
	return a.trim() === b.trim();
}

/** An item's name as item names are matched (2.3): ignoring case and runs of spaces. */
function itemKey(item: string): string {
	return foldCase(normalizeName(item));
}

/** Whether two amounts are the same number as saving reads them, or else the same text. */
function sameAmount(a: string, b: string): boolean {
	const x = parseAmount(a);
	const y = parseAmount(b);
	if (x === null || y === null) return a.trim() === b.trim();
	return Math.abs(x - y) <= 1e-9;
}

/** Whether two ingredients would be saved with the same amount, unit and prep note. */
function sameDetails(a: Ingredient, b: Ingredient): boolean {
	return (
		sameAmount(a.amount, b.amount) &&
		normalizeUnit(a.unit) === normalizeUnit(b.unit) &&
		normalizeName(a.prepNote) === normalizeName(b.prepNote)
	);
}

/**
 * The editor's ingredients that have an item, each with its label: ingredients are numbered as
 * the editor numbers them, blank rows included and headings left out ("Ingredient 3").
 */
function editorIngredients(rows: RecipeRow[]): EditorIngredient[] {
	const found: EditorIngredient[] = [];
	let number = 0;
	rows.forEach((row, at) => {
		if (row.kind !== 'ingredient') return;
		number += 1;
		const { kind: _, ...ingredient } = row;
		if (normalizeName(ingredient.item) !== '') {
			found.push({ at, label: `Ingredient ${number}`, ingredient });
		}
	});
	return found;
}

/**
 * The page's ingredients that aren't already in the editor, in the page's order, each matched to
 * the editor's by item (IngredientEntry). One the editor has with the same item, amount, unit and
 * prep note is already there; it's paired with that ingredient, which then matches no other.
 */
function matchIngredients(rows: RecipeRow[], imported: RecipeRow[]): IngredientEntry[] {
	const editor = editorIngredients(rows).map((found) => ({
		found,
		key: itemKey(found.ingredient.item)
	}));
	// The places of the editor's ingredients already the same as one of the page's.
	const same = new Set<number>();
	const left: { ingredient: Ingredient; key: string }[] = [];
	for (const row of imported) {
		if (row.kind !== 'ingredient') continue;
		const { kind: _, ...ingredient } = row;
		const key = itemKey(ingredient.item);
		const twin = editor.find(
			({ found, key: other }) =>
				other === key && !same.has(found.at) && sameDetails(found.ingredient, ingredient)
		);
		if (twin) same.add(twin.found.at);
		else left.push({ ingredient, key });
	}
	return left.map(({ ingredient, key }): IngredientEntry => {
		const candidates = editor
			.filter(({ found, key: other }) => other === key && !same.has(found.at))
			.map(({ found }) => found);
		const fromPage = left.filter((other) => other.key === key).length;
		const [first] = candidates;
		if (!first) return { kind: 'new', imported: ingredient, choice: 'skip' };
		if (candidates.length === 1 && fromPage === 1) {
			return { kind: 'match', imported: ingredient, current: first, choice: 'skip' };
		}
		return { kind: 'choose', imported: ingredient, candidates, choice: 'skip' };
	});
}

/**
 * What the page's recipe would change in the editor's values, `current`. Each field the page has
 * fills in when it's empty in the editor, and is a conflict, kept until chosen, when the editor
 * has something else in it. A field the page has none of (null) stays as it is. Ingredients are
 * matched by item (matchIngredients).
 */
export function reviewImport(current: RecipeFormValues, imported: LinkValues): Review {
	const fills: Fill[] = [];
	const conflicts: Conflict[] = [];
	for (const field of FIELDS) {
		const value = imported[field];
		if (value === null) continue;
		const now = current[field];
		if (now.trim() === '') fills.push({ field, imported: value });
		else if (!sameField(field, now, value)) {
			conflicts.push({ field, current: now, imported: value, replace: false });
		}
	}
	const ingredients = imported.rows === null ? [] : matchIngredients(current.rows, imported.rows);
	return { fills, conflicts, ingredients };
}

/** Whether the page has nothing the editor doesn't already have, so there's nothing to review. */
export function nothingToReview(review: Review): boolean {
	return (
		review.fills.length === 0 && review.conflicts.length === 0 && review.ingredients.length === 0
	);
}

/** Whether applying the review changes the editor: a field fills in, or something was chosen. */
export function changesEditor(review: Review): boolean {
	return (
		review.fills.length > 0 ||
		review.conflicts.some((conflict) => conflict.replace) ||
		review.ingredients.some((entry) => entry.choice !== 'skip')
	);
}

/** The editor's ingredient with the page's amount, unit and prep note. The item stays. */
export function replacement(current: Ingredient, imported: Ingredient): Ingredient {
	return { ...current, amount: imported.amount, unit: imported.unit, prepNote: imported.prepNote };
}

function isBlank(row: RecipeRow | undefined): boolean {
	return (
		row?.kind === 'ingredient' &&
		[row.amount, row.unit, row.item, row.prepNote].every((text) => text.trim() === '')
	);
}

/**
 * The rows with ingredients added at the end, in place of blank rows there. When the last rows
 * are under a heading, a blank heading goes first, which ends that section (design 7), so the
 * added ingredients aren't in it.
 */
function withAdded(rows: RecipeRow[], added: RecipeRow[]): RecipeRow[] {
	const kept = [...rows];
	while (isBlank(kept.at(-1))) kept.pop();
	let heading = '';
	for (const row of kept) if (row.kind === 'section') heading = row.heading.trim();
	const end: RecipeRow[] = heading === '' ? [] : [{ kind: 'section', heading: '' }];
	return [...kept, ...end, ...added];
}

/**
 * The editor's values, `current`, as the review leaves them: the fields it fills in and those
 * chosen to replace, the ingredients chosen to replace changed in place (replacement), and those
 * chosen to add at the end, in the page's order (withAdded). Everything else stays as it was, the
 * rows' order and headings included.
 */
export function applyImport(current: RecipeFormValues, review: Review): RecipeFormValues {
	const next = { ...current, rows: [...current.rows] };
	for (const { field, imported } of review.fills) next[field] = imported;
	for (const { field, imported, replace } of review.conflicts) {
		if (replace) next[field] = imported;
	}
	const added: RecipeRow[] = [];
	for (const { imported, choice } of review.ingredients) {
		if (choice === 'add') {
			added.push({ kind: 'ingredient', ...imported });
		} else if (choice !== 'skip') {
			const row = next.rows[choice];
			if (row?.kind !== 'ingredient') throw new Error(`Row ${choice} isn't an ingredient`);
			next.rows[choice] = { kind: 'ingredient', ...replacement(row, imported) };
		}
	}
	if (added.length > 0) next.rows = withAdded(next.rows, added);
	return next;
}

/** An ingredient as one line, as Import recipes reads one: "1 1/2 cups flour, sifted". */
export function ingredientText({ amount, unit, item, prepNote }: Ingredient): string {
	const line = [amount, unit, item]
		.map((part) => part.trim())
		.filter((part) => part !== '')
		.join(' ');
	const note = prepNote.trim();
	return note === '' ? line : `${line}, ${note}`;
}
