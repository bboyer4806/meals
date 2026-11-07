import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import {
	getDish,
	importDishes,
	listDishes,
	rateDish,
	setDishArchived,
	setDishTried
} from './data/dishes.ts';
import { createItem, findItemByName, itemsByName, setItemArchived } from './data/items.ts';
import { transaction } from './db/index.ts';
import { importRecipeFile, importSummary, templateCsv } from './recipe-import.ts';
import { TEST_ENV, freshDb, ingredient, makeDish, makeHousehold, recipe } from './testing.ts';
import { NORMALIZE_MAX_LENGTH } from '../text.ts';

const NOW = Date.UTC(2026, 9, 3, 17, 0);

let householdId: number;
let userId: number;

// Where new items' standard images go (design 6.14).
let dataDir: string;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	dataDir = mkdtempSync(join(tmpdir(), 'meals-recipe-import-'));
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

function form(csv: BlobPart, fields: Record<string, string> = {}): FormData {
	const data = new FormData();
	data.set('file', new File([csv], 'recipes.csv', { type: 'text/csv' }));
	for (const [name, value] of Object.entries(fields)) data.set(name, value);
	return data;
}

function names(): string[] {
	return listDishes(householdId, { search: '', tags: [], archived: false, sort: 'name' }).map(
		(dish) => dish.name
	);
}

function dishNamed(name: string) {
	const found = listDishes(householdId, { search: name, tags: [], archived: false, sort: 'name' });
	const summary = found.find((dish) => dish.name === name);
	if (!summary) throw new Error(`No ${name}`);
	return getDish(householdId, summary.id);
}

describe('templateCsv', () => {
	it('is the header row alone, after a byte order mark so Excel keeps it UTF-8 (MEA-71)', () => {
		expect(templateCsv()).toBe(
			'\uFEFFRecipe,Servings,Prep (min),Cook (min),Tags,Ingredients,Steps,Notes,Source,Calories,Protein (g),Carbs (g),Fat (g)\r\n'
		);
	});
});

describe('importRecipeFile', () => {
	it('adds each row as a recipe, with sections, ranges and the usual servings', async () => {
		const csv = [
			'recipe,INGREDIENTS,Steps,Tags,Rating,Prep (min)',
			'Pancakes,"# Batter|1 1/2 cups flour, sifted|2-3 cloves garlic|3 eggs|Salt, to taste",Mix|Cook,"Breakfast, Quick",5,10',
			',,,,,',
			'Toast,,,,,'
		].join('\r\n');
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({
			kind: 'imported',
			imported: 2,
			replaced: 0,
			skipped: 0,
			ignored: ['Rating']
		});

		const pancakes = dishNamed('Pancakes');
		expect(pancakes).toMatchObject({
			servings: 4,
			prepMinutes: 10,
			steps: 'Mix\nCook',
			tags: ['Breakfast', 'Quick']
		});
		expect(
			pancakes.ingredients.map(({ section, amount, unit, itemName, prepNote }) => [
				section,
				amount,
				unit,
				itemName,
				prepNote
			])
		).toEqual([
			['Batter', 1.5, 'cup', 'flour', 'sifted'],
			['Batter', 2, 'cloves', 'garlic', '2 to 3'],
			['Batter', 3, null, 'eggs', null],
			['Batter', null, null, 'Salt', 'to taste']
		]);
		// New items join the catalog, as from the editor.
		expect(findItemByName(householdId, 'garlic')).toBeDefined();
		expect(names()).toEqual(['Pancakes', 'Toast']);
	});

	it('splits Ingredients and Steps cells on line breaks as well as | (MEA-73)', async () => {
		// Excel ends a row with \r\n and a line in a cell (Alt+Enter) with \n. A blank line is left out.
		const csv = [
			'Recipe,Ingredients,Steps',
			'Pancakes,"# Batter\n1 1/2 cups flour, sifted\n\n2 eggs|1 cup milk","Mix\nCook\r\nServe"'
		].join('\r\n');
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({ kind: 'imported', imported: 1, replaced: 0, skipped: 0, ignored: [] });

		const pancakes = dishNamed('Pancakes');
		expect(pancakes.steps).toBe('Mix\nCook\nServe');
		expect(
			pancakes.ingredients.map(({ section, amount, unit, itemName, prepNote }) => [
				section,
				amount,
				unit,
				itemName,
				prepNote
			])
		).toEqual([
			['Batter', 1.5, 'cup', 'flour', 'sifted'],
			['Batter', 2, null, 'eggs', null],
			['Batter', 1, 'cup', 'milk', null]
		]);
	});

	it('lists every problem by row and imports nothing', async () => {
		createItem(householdId, 'Saffron', NOW);
		const saffron = findItemByName(householdId, 'Saffron');
		if (!saffron) throw new Error('No saffron');
		setItemArchived(householdId, saffron.id, true, NOW);
		const csv = [
			'Recipe,Ingredients,Servings',
			'Pound cake,1 cup flour,',
			',1 egg,',
			'Rice,2 cups,',
			'Paella,1 pinch saffron,',
			'pound cake,,',
			'Soup,0 cups water,',
			'Stew,,abc'
		].join('\n');
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({
			kind: 'problems',
			problems: [
				'Row 3: enter a recipe name.',
				"Row 4: '2 cups' needs an item.",
				'Row 5: Saffron is archived. Restore it on Items first.',
				'Row 6: pound cake is also on row 2.',
				"Row 7: '0 cups water': enter an amount like 1 1/2.",
				'Row 8: enter a number of servings.'
			]
		});
		expect(names()).toEqual([]);
	});

	it('refuses a cell over 10000 characters before reading it (MEA-64)', async () => {
		const most = 'a'.repeat(NORMALIZE_MAX_LENGTH);
		const over = `${most}a`;
		// Row 2's steps fit, and its Rating is ignored, however long.
		const csv = ['Recipe,Steps,Rating', `Toast,${most},${over}`, `Soup,${over},`].join('\n');
		expect(await importRecipeFile(householdId, form(csv), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 3: keep each cell under 10000 characters.']
		});
		expect(await importRecipeFile(householdId, form(`Recipe,${over}\nToast`), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 1: keep each cell under 10000 characters.']
		});
		expect(names()).toEqual([]);

		const steps = ['Recipe,Steps', `Toast,${most}`].join('\n');
		expect(await importRecipeFile(householdId, form(steps), NOW)).toMatchObject({ imported: 1 });
		expect(dishNamed('Toast').steps).toBe(most);
	});

	it('reads up to 100000 characters of cells, and stops on the row where they pass it (MEA-234)', async () => {
		const most = 'a'.repeat(NORMALIZE_MAX_LENGTH);
		// The header's cells come to 17 characters, and rows 2 to 10 to 10,001 each: 90,026 in all.
		// Rating is ignored, so its cells don't count.
		const file = (lastSteps: number, after: string[] = []) =>
			[
				'Recipe,Steps,Rating',
				...[...'ABCDEFGHI'].map((name) => `${name},${most},${most}`),
				`J,${'a'.repeat(lastSteps)}`,
				...after
			].join('\n');
		// Row 11 passes 100,000 by one, so row 12, named as row 2 is, isn't read.
		expect(await importRecipeFile(householdId, form(file(9_974, ['A'])), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 11: the file is too long to import at once. Split it into smaller files.']
		});
		expect(names()).toEqual([]);
		expect(await importRecipeFile(householdId, form(file(9_973)), NOW)).toMatchObject({
			kind: 'imported',
			imported: 10
		});
	});

	it('counts the header, and not a row refused for a cell over 10000 characters (MEA-234)', async () => {
		const most = 'a'.repeat(NORMALIZE_MAX_LENGTH);
		const header = ['Recipe', ...Array<string>(10).fill(most)].join(',');
		expect(await importRecipeFile(householdId, form(`${header}\nToast`), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 1: the file is too long to import at once. Split it into smaller files.']
		});
		// Row 2 is refused unread, so its 900,000 characters don't count.
		const csv = ['Recipe,Steps', `Toast,${'a'.repeat(900_000)}`, `Soup,${most}`].join('\n');
		expect(await importRecipeFile(householdId, form(csv), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 2: keep each cell under 10000 characters.']
		});
	});

	it('refuses a file of cells written to be slow to normalize in under a second (MEA-234)', async () => {
		// Runs of combining marks, each of which takes a few hundredths of a second to normalize
		// (text.ts). The 49 rows, nearly 1 MB, would take seconds.
		const steps = `a${'̖́'.repeat(4_999)}`;
		const rows = Array.from({ length: 49 }, (_, index) => `Dish ${index},${steps}`);
		const csv = ['Recipe,Steps', ...rows].join('\n');
		const started = performance.now();
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(performance.now() - started).toBeLessThan(1000);
		expect(result).toEqual({
			kind: 'problems',
			problems: ['Row 11: the file is too long to import at once. Split it into smaller files.']
		});
	});

	it('refuses a file over 1 MB unread', async () => {
		// Extra is ignored, however long its cell.
		const start = 'Recipe,Extra\nToast,';
		const most = `${start}${'x'.repeat(1_000_000 - start.length)}`;
		expect(await importRecipeFile(householdId, form(`${most}x`), NOW)).toEqual({
			kind: 'problems',
			problems: ['Choose a file under 1 MB.']
		});
		expect(await importRecipeFile(householdId, form(most), NOW)).toMatchObject({ imported: 1 });
	});

	it('reads up to 1000 recipes, not counting blank rows, and stops on the row past them (MEA-89)', async () => {
		const rows = Array.from({ length: 1_000 }, (_, index) => `Dish ${index + 1}`);
		// Blank rows 3 and 1003 don't count, so row 1004 is the 1001st recipe, and row 1005, named
		// as row 2 is, isn't read.
		const file = (after: string[]) =>
			['Recipe', ...rows.slice(0, 1), '', ...rows.slice(1), '', ...after].join('\n');
		expect(await importRecipeFile(householdId, form(file(['Toast', 'Dish 1'])), NOW)).toEqual({
			kind: 'problems',
			problems: ['Row 1004: the file has more than 1000 recipes. Split it into smaller files.']
		});
		expect(names()).toEqual([]);
		expect(await importRecipeFile(householdId, form(file([])), NOW)).toMatchObject({
			kind: 'imported',
			imported: 1_000
		});
	});

	it('imports the most recipes a file holds into a full household in well under a second (MEA-89)', async () => {
		// Each name was looked up among all the household's recipes or items, several times a row,
		// which took this import about 5 seconds and finding its duplicates about 2.
		const old = Array.from({ length: 1_000 }, (_, index) => ({
			dishId: null,
			input: recipe(`Old ${index}`, { ingredients: [ingredient(`Item ${index}`)] })
		}));
		importDishes(householdId, old, itemsByName(householdId), NOW);
		const rows = Array.from(
			{ length: 1_000 },
			(_, index) => `Dish ${index},Item ${index}|New ${index}|salt`
		);
		const csv = ['Recipe,Ingredients', ...rows].join('\n');

		let started = performance.now();
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(performance.now() - started).toBeLessThan(1000);
		expect(result).toEqual({
			kind: 'imported',
			imported: 1_000,
			replaced: 0,
			skipped: 0,
			ignored: []
		});
		const last = dishNamed('Dish 999').ingredients;
		expect(last.map(({ itemName }) => itemName)).toEqual(['Item 999', 'New 999', 'salt']);
		expect(last[0]?.itemId).toBe(findItemByName(householdId, 'Item 999')?.id);
		expect(itemsByName(householdId).size).toBe(2_001);

		// Sent again, every recipe is already in Recipes.
		started = performance.now();
		const again = await importRecipeFile(householdId, form(csv), NOW);
		expect(performance.now() - started).toBeLessThan(1000);
		if (again.kind !== 'duplicates') throw new Error('Expected duplicates');
		expect(again.duplicates).toHaveLength(1_000);
	});

	it('reads the template saved as CSV UTF-8, with its byte order mark, é, ½ and ° (MEA-71)', async () => {
		const csv = `${templateCsv()}Crème brûlée,,,,,½ cup sugar|1 cup crème fraîche,Bake at 325 °F.\r\n`;
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({ kind: 'imported', imported: 1, replaced: 0, skipped: 0, ignored: [] });
		const dish = dishNamed('Crème brûlée');
		expect(dish.steps).toBe('Bake at 325 °F.');
		expect(dish.ingredients.map(({ amount, unit, itemName }) => [amount, unit, itemName])).toEqual([
			[0.5, 'cup', 'sugar'],
			[1, 'cup', 'crème fraîche']
		]);
	});

	it("refuses a file that isn't UTF-8, as Excel's CSV (Comma delimited) isn't (MEA-71)", async () => {
		// Windows-1252 is Latin-1 for these characters.
		const csv = Buffer.from('Recipe,Ingredients\nCrème brûlée,½ cup sugar\n', 'latin1');
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({
			kind: 'problems',
			problems: ['Save the file as CSV UTF-8, then import it again.']
		});
		expect(names()).toEqual([]);
	});

	it('keeps a quote inside a cell, as in Use a 9" pan', async () => {
		const csv = 'Recipe,Notes\nPizza,Use a 9" pan\nToast,Butter';
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({ kind: 'imported', imported: 2, replaced: 0, skipped: 0, ignored: [] });
		expect(dishNamed('Pizza').notes).toBe('Use a 9" pan');
		expect(names()).toEqual(['Pizza', 'Toast']);
	});

	it('lists a quote that is never closed on its row and imports nothing', async () => {
		const csv = 'Recipe,Notes\nPizza,Hot\nToast,"Butter\nRice,Plain';
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({
			kind: 'problems',
			problems: ["Row 3: a cell starts with a quote that isn't closed."]
		});
		expect(names()).toEqual([]);
	});

	it('needs a Recipe column', async () => {
		const result = await importRecipeFile(householdId, form('Name,Steps\nToast,Eat'), NOW);
		expect(result).toEqual({
			kind: 'problems',
			problems: ['Row 1: add a Recipe column with the name of each recipe.']
		});
	});

	it('asks about names already in Recipes, Skip selected, archived ones included', async () => {
		makeDish(householdId, recipe('Pound cake'));
		const archived = makeDish(householdId, recipe('Toast'));
		setDishArchived(householdId, archived, true, NOW);
		const csv = 'Recipe\npound cake\nSoup\ntoast';
		const result = await importRecipeFile(householdId, form(csv), NOW);
		expect(result).toEqual({
			kind: 'duplicates',
			problems: [],
			duplicates: [
				{ row: 2, name: 'Pound cake', archived: false, choice: 'skip', rename: '' },
				{ row: 4, name: 'Toast', archived: true, choice: 'skip', rename: '' }
			]
		});
		expect(names()).toEqual(['Pound cake']);
	});

	it('skips, replaces and renames as chosen', async () => {
		const cake = makeDish(
			householdId,
			recipe('Pound cake', { notes: 'Old', ingredients: [ingredient('Butter', 1, 'cup')] })
		);
		setDishTried(householdId, cake, true);
		rateDish(householdId, cake, userId, 4);
		makeDish(householdId, recipe('Soup', { notes: 'Old soup' }));
		makeDish(householdId, recipe('Toast', { notes: 'Old toast' }));
		const csv = 'Recipe,Notes,Ingredients\npound CAKE,New,2 cups flour\nSoup,New soup,\nToast,New toast,\nRice,,';
		const result = await importRecipeFile(
			householdId,
			form(csv, {
				'choice-2': 'replace',
				'choice-3': 'skip',
				'choice-4': 'rename',
				'rename-4': ' Cinnamon  toast '
			}),
			NOW
		);
		expect(result).toEqual({ kind: 'imported', imported: 2, replaced: 1, skipped: 1, ignored: [] });

		const replaced = getDish(householdId, cake);
		expect(replaced).toMatchObject({ notes: 'New', tried: true, rating: { average: 4, count: 1 } });
		expect(replaced.ingredients.map((row) => row.itemName)).toEqual(['flour']);
		expect(dishNamed('Soup').notes).toBe('Old soup');
		expect(dishNamed('Toast').notes).toBe('Old toast');
		expect(dishNamed('Cinnamon toast').notes).toBe('New toast');
		expect(names()).toEqual(['Cinnamon toast', 'Pound cake', 'Rice', 'Soup', 'Toast']);
	});

	it("needs a rename that isn't taken", async () => {
		makeDish(householdId, recipe('Toast'));
		makeDish(householdId, recipe('Soup'));
		const csv = 'Recipe\nToast\nRice';
		const cases: [rename: string, problem: string][] = [
			['', 'Row 2: enter a new name.'],
			['soup', 'Row 2: a recipe is already called soup.'],
			['RICE', 'Row 2: RICE is also on row 3.'],
			// Refused before it's normalized, which would throw for it (text.ts; MEA-64).
			['x'.repeat(NORMALIZE_MAX_LENGTH + 1), 'Row 2: keep a new name under 80 characters.']
		];
		for (const [rename, problem] of cases) {
			const result = await importRecipeFile(
				householdId,
				form(csv, { 'choice-2': 'rename', 'rename-2': rename }),
				NOW
			);
			expect(result).toEqual({
				kind: 'duplicates',
				problems: [problem],
				duplicates: [{ row: 2, name: 'Toast', archived: false, choice: 'rename', rename }]
			});
		}
		expect(names()).toEqual(['Soup', 'Toast']);
	});

	it('gives new items with standard names their images, and stores none when nothing is imported', async () => {
		const csv = ['Recipe,Ingredients', 'Omelet,3 eggs|1/4 cup shredded gruyère'].join('\r\n');
		expect(await importRecipeFile(householdId, form('Recipe\r\n,'), NOW)).toMatchObject({
			kind: 'problems'
		});
		expect(readdirSync(dataDir)).toEqual([]);

		await importRecipeFile(householdId, form(csv), NOW);

		const eggs = findItemByName(householdId, 'eggs')?.photoKey;
		expect(eggs).toMatch(/^[0-9a-f]{32}$/);
		expect(findItemByName(householdId, 'shredded gruyère')?.photoKey).toBeNull();
		expect(readdirSync(join(dataDir, 'photos')).sort()).toEqual([`${eggs}-thumb.jpg`, `${eggs}.jpg`]);
	});

	it('rolls back the recipes it saved when the import throws after saving them', () => {
		// The import's saves run in importDishes' own transaction, nested in the import's.
		expect(() =>
			transaction(() => {
				importDishes(
					householdId,
					[{ dishId: null, input: recipe('Rice') }],
					itemsByName(householdId),
					NOW
				);
				throw new Error('Broken');
			})
		).toThrow('Broken');
		expect(names()).toEqual([]);
	});
});

describe('importSummary', () => {
	// One recipe imported, and nothing replaced, skipped or ignored.
	const one = { kind: 'imported' as const, imported: 1, replaced: 0, skipped: 0, ignored: [] };

	it('says what was imported, leaving out the parts that are 0 or empty', () => {
		expect(importSummary(one)).toBe('Imported 1 recipe.');
		expect(importSummary({ ...one, imported: 9, replaced: 2, skipped: 3 })).toBe(
			'Imported 9 recipes, replaced 2 and skipped 3.'
		);
		expect(importSummary({ ...one, imported: 0, skipped: 3 })).toBe(
			'Imported 0 recipes and skipped 3.'
		);
	});

	it('names at most three ignored columns, counting the rest (MEA-81)', () => {
		expect(importSummary({ ...one, ignored: ['Rating'] })).toBe(
			'Imported 1 recipe. Ignored column: Rating.'
		);
		expect(importSummary({ ...one, ignored: ['Step', 'Rating', 'Photo'] })).toBe(
			'Imported 1 recipe. Ignored columns: Step, Rating and Photo.'
		);
		expect(importSummary({ ...one, ignored: ['Step', 'Rating', 'Photo', 'Cost'] })).toBe(
			'Imported 1 recipe. Ignored columns: Step, Rating and 2 more.'
		);
		const extra = Array.from({ length: 12 }, (_, index) => `Extra ${index + 1}`);
		expect(importSummary({ ...one, ignored: ['Step', 'Rating', ...extra] })).toBe(
			'Imported 1 recipe. Ignored columns: Step, Rating and 12 more.'
		);
	});
});
