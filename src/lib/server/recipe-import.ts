import { parseCsv } from '../csv.ts';
import { splitIngredient } from '../ingredient-text.ts';
import { foldCase, normalizeName } from '../text.ts';
import { createDish, findDishByName, updateDish, type DishInput } from './data/dishes.ts';
import { getHousehold } from './data/households.ts';
import { findItemByName } from './data/items.ts';
import { transaction } from './db/index.ts';
import { nameField } from './forms.ts';
import { readRows, recipeDetailFields, type RecipeRow } from './recipe-form.ts';

// Import recipes (design 7): a CSV file with one recipe per row, checked as the recipe editor
// checks a recipe, then added all together or not at all.

/** The template's header row, in order. Each names a field of the recipe editor. */
export const RECIPE_COLUMNS = [
	'Recipe',
	'Servings',
	'Prep (min)',
	'Cook (min)',
	'Tags',
	'Ingredients',
	'Steps',
	'Notes',
	'Source',
	'Calories',
	'Protein (g)',
	'Carbs (g)',
	'Fat (g)'
] as const;

type Column = (typeof RECIPE_COLUMNS)[number];

/** The template: just the header row. */
export function templateCsv(): string {
	return `${RECIPE_COLUMNS.join(',')}\r\n`;
}

// Big enough for thousands of recipes, and well under the app's upload limit.
const MAX_FILE_BYTES = 1_000_000;

/** A problem with the file, on its row as a spreadsheet numbers it (the header is row 1). */
type Problem = { row: number; text: string };

type FileRecipe = { row: number; data: DishInput };

export type DuplicateChoice = 'skip' | 'replace' | 'rename';

/** A recipe in the file whose name is already in Recipes, with what to do about it. */
export type Duplicate = {
	row: number;
	name: string;
	archived: boolean;
	choice: DuplicateChoice;
	/** The name typed for Rename. */
	rename: string;
};

export type ImportResult =
	| { kind: 'imported'; imported: number; replaced: number; skipped: number; ignored: string[] }
	| { kind: 'problems'; problems: string[] }
	/** The file has no problems, and these choices are still to make or fix. */
	| { kind: 'duplicates'; duplicates: Duplicate[]; problems: string[] };

/** Several entries in one cell, separated by |. Blank entries are left out. */
function entries(cell: string): string[] {
	return cell
		.split('|')
		.map((entry) => normalizeName(entry))
		.filter((entry) => entry !== '');
}

/** "Row 7: enter an amount like 1 1/2." from the editor's "Enter an amount like 1 1/2". */
function sentence(text: string): string {
	return `${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

/** An entry of the Ingredients cell as an editor row. "# Batter" is a section heading. */
function ingredientRow(entry: string): RecipeRow {
	if (entry.startsWith('#')) return { kind: 'section', heading: entry.slice(1) };
	return { kind: 'ingredient', ...splitIngredient(entry) };
}

/** One row of the file as a recipe, or its first problem, in the order of the editor. */
function readRecipe(cell: (column: Column) => string, defaultServings: number): DishInput | string {
	const details = recipeDetailFields.safeParse({
		name: cell('Recipe'),
		// A blank Servings is the household's usual servings, as a new recipe starts at (design 7).
		servings: cell('Servings').trim() || String(defaultServings),
		prepMinutes: cell('Prep (min)'),
		cookMinutes: cell('Cook (min)'),
		tags: cell('Tags'),
		steps: entries(cell('Steps')).join('\n'),
		notes: cell('Notes'),
		source: cell('Source'),
		calories: cell('Calories'),
		proteinG: cell('Protein (g)'),
		carbsG: cell('Carbs (g)'),
		fatG: cell('Fat (g)')
	});
	if (!details.success) return sentence(details.error.issues[0]?.message ?? 'Check this row');
	const ingredients = readRows(
		entries(cell('Ingredients')).map((entry) => ({ row: ingredientRow(entry), label: `'${entry}'` }))
	);
	if (typeof ingredients === 'string') return sentence(ingredients);
	return { ...details.data, ingredients };
}

/**
 * The file's recipes and the problems with it. Columns are matched by name ignoring case, in
 * any order; only Recipe is needed, and the names of columns that aren't recipe fields are
 * returned as `ignored`. Blank rows are left out.
 */
function readFile(
	text: string,
	defaultServings: number
): { recipes: FileRecipe[]; problems: Problem[]; ignored: string[] } {
	const [header = [], ...rows] = parseCsv(text);
	const problems: Problem[] = [];
	const ignored: string[] = [];
	const columns = new Map<Column, number>();
	header.forEach((cell, index) => {
		const name = normalizeName(cell);
		const column = RECIPE_COLUMNS.find((known) => foldCase(known) === foldCase(name));
		if (column === undefined) {
			if (name !== '') ignored.push(name);
		} else if (columns.has(column)) {
			problems.push({ row: 1, text: `${column} is there twice. Keep one ${column} column.` });
		} else {
			columns.set(column, index);
		}
	});
	if (!columns.has('Recipe')) {
		problems.push({ row: 1, text: 'add a Recipe column with the name of each recipe.' });
		return { recipes: [], problems, ignored };
	}

	const recipes: FileRecipe[] = [];
	const rowsByName = new Map<string, number>();
	rows.forEach((cells, index) => {
		const row = index + 2;
		if (cells.every((cell) => cell.trim() === '')) return;
		const cell = (column: Column) => {
			const at = columns.get(column);
			return at === undefined ? '' : (cells[at] ?? '');
		};
		const data = readRecipe(cell, defaultServings);
		if (typeof data === 'string') {
			problems.push({ row, text: data });
			return;
		}
		const key = foldCase(data.name);
		const first = rowsByName.get(key);
		if (first !== undefined) {
			problems.push({ row, text: `${data.name} is also on row ${first}.` });
			return;
		}
		rowsByName.set(key, row);
		recipes.push({ row, data });
	});
	if (recipes.length === 0 && problems.length === 0) {
		problems.push({ row: 1, text: 'add a row under the header for each recipe.' });
	}
	return { recipes, problems, ignored };
}

/** The archived items the recipe names, each once, as problems. Importing doesn't restore them. */
function archivedItemProblems(householdId: number, recipe: FileRecipe): Problem[] {
	const problems: Problem[] = [];
	const seen = new Set<number>();
	for (const ingredient of recipe.data.ingredients) {
		const item = findItemByName(householdId, ingredient.itemName);
		if (item && item.archivedAt !== null && !seen.has(item.id)) {
			seen.add(item.id);
			problems.push({
				row: recipe.row,
				text: `${item.name} is archived. Restore it on Items first.`
			});
		}
	}
	return problems;
}

function formatProblems(problems: Problem[]): string[] {
	return problems
		.toSorted((a, b) => a.row - b.row)
		.map((problem) => `Row ${problem.row}: ${problem.text}`);
}

/** The choice sent for a duplicate's row, or null before the person has made one. */
function sentChoice(formData: FormData, row: number): DuplicateChoice | null {
	const choice = formData.get(`choice-${row}`);
	return choice === 'skip' || choice === 'replace' || choice === 'rename' ? choice : null;
}

const renameField = nameField(80, 'a new name');

/** Problems with the names typed for Rename. Each must be new to Recipes and to the file. */
function renameProblems(
	householdId: number,
	recipes: FileRecipe[],
	duplicates: Duplicate[]
): Problem[] {
	const problems: Problem[] = [];
	const rowsByName = new Map(recipes.map((recipe) => [foldCase(recipe.data.name), recipe.row]));
	for (const duplicate of duplicates) {
		if (duplicate.choice !== 'rename') continue;
		const name = renameField.safeParse(duplicate.rename);
		if (!name.success) {
			const message = name.error.issues[0]?.message ?? 'Enter a new name';
			problems.push({ row: duplicate.row, text: sentence(message) });
			continue;
		}
		const key = foldCase(name.data);
		const other = rowsByName.get(key);
		if (other !== undefined) {
			problems.push({ row: duplicate.row, text: `${name.data} is also on row ${other}.` });
		} else if (findDishByName(householdId, name.data)) {
			problems.push({ row: duplicate.row, text: `a recipe is already called ${name.data}.` });
		} else {
			rowsByName.set(key, duplicate.row);
		}
	}
	return problems;
}

/**
 * Imports the CSV file in the form's `file` field. Nothing is imported while the file has a
 * problem. Recipes whose names are already in Recipes, archived ones included, are returned
 * as duplicates until the form has a choice for each, sent as `choice-<row>` (skip, replace or
 * rename) and `rename-<row>` (the new name). Everything is checked and saved in one
 * transaction, so the household's recipes can't change in between.
 */
export async function importRecipeFile(
	householdId: number,
	formData: FormData,
	now: number
): Promise<ImportResult> {
	const file = formData.get('file');
	if (!(file instanceof File) || file.size === 0) {
		return { kind: 'problems', problems: ['Choose a CSV file to import.'] };
	}
	if (file.size > MAX_FILE_BYTES) {
		return { kind: 'problems', problems: ['Choose a file under 1 MB.'] };
	}
	const text = await file.text();

	return transaction((): ImportResult => {
		const { recipes, problems, ignored } = readFile(
			text,
			getHousehold(householdId).defaultServings
		);
		for (const recipe of recipes) problems.push(...archivedItemProblems(householdId, recipe));
		if (problems.length > 0) return { kind: 'problems', problems: formatProblems(problems) };

		const duplicates: Duplicate[] = [];
		// The existing recipe for each duplicate's row.
		const dishIds = new Map<number, number>();
		let unchosen = false;
		for (const recipe of recipes) {
			const dish = findDishByName(householdId, recipe.data.name);
			if (!dish) continue;
			dishIds.set(recipe.row, dish.id);
			const choice = sentChoice(formData, recipe.row);
			if (choice === null) unchosen = true;
			duplicates.push({
				row: recipe.row,
				name: dish.name,
				archived: dish.archivedAt !== null,
				// Skip is selected to start.
				choice: choice ?? 'skip',
				rename: String(formData.get(`rename-${recipe.row}`) ?? '')
			});
		}
		if (unchosen) return { kind: 'duplicates', duplicates, problems: [] };
		const renaming = renameProblems(householdId, recipes, duplicates);
		if (renaming.length > 0) {
			return { kind: 'duplicates', duplicates, problems: formatProblems(renaming) };
		}

		const choices = new Map(duplicates.map((duplicate) => [duplicate.row, duplicate]));
		let imported = 0;
		let replaced = 0;
		let skipped = 0;
		for (const recipe of recipes) {
			const duplicate = choices.get(recipe.row);
			const dishId = dishIds.get(recipe.row);
			if (duplicate?.choice === 'skip') {
				skipped += 1;
				continue;
			}
			// Everything was checked above, in this transaction, so each save goes through. The
			// saves' own transactions are savepoints in this one.
			let saved;
			if (duplicate?.choice === 'replace' && dishId !== undefined) {
				// The details change, and the name stays as it is in Recipes.
				saved = updateDish(householdId, dishId, { ...recipe.data, name: duplicate.name }, [], now);
				replaced += 1;
			} else {
				const name = duplicate ? normalizeName(duplicate.rename) : recipe.data.name;
				saved = createDish(householdId, { ...recipe.data, name }, [], now);
				imported += 1;
			}
			if (saved.kind !== 'saved') throw new Error(`Row ${recipe.row} couldn't be saved`);
		}
		return { kind: 'imported', imported, replaced, skipped, ignored };
	});
}
