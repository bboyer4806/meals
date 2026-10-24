import { beforeEach, describe, expect, it } from 'vitest';
import { getDish, listDishes, rateDish, setDishArchived, setDishTried } from './data/dishes.ts';
import { createItem, findItemByName, setItemArchived } from './data/items.ts';
import { transaction } from './db/index.ts';
import { importRecipeFile, templateCsv } from './recipe-import.ts';
import { freshDb, ingredient, makeDish, makeHousehold, recipe } from './testing.ts';

const NOW = Date.UTC(2026, 9, 3, 17, 0);

let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
});

function form(csv: string, fields: Record<string, string> = {}): FormData {
	const data = new FormData();
	data.set('file', new File([csv], 'recipes.csv', { type: 'text/csv' }));
	for (const [name, value] of Object.entries(fields)) data.set(name, value);
	return data;
}

function names(): string[] {
	return listDishes(householdId, { search: '', tag: null, archived: false, sort: 'name' }).map(
		(dish) => dish.name
	);
}

function dishNamed(name: string) {
	const found = listDishes(householdId, { search: name, tag: null, archived: false, sort: 'name' });
	const summary = found.find((dish) => dish.name === name);
	if (!summary) throw new Error(`No ${name}`);
	return getDish(householdId, summary.id);
}

describe('templateCsv', () => {
	it('is the header row alone', () => {
		expect(templateCsv()).toBe(
			'Recipe,Servings,Prep (min),Cook (min),Tags,Ingredients,Steps,Notes,Source,Calories,Protein (g),Carbs (g),Fat (g)\r\n'
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
			['RICE', 'Row 2: RICE is also on row 3.']
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

	it("rolls back recipes saved earlier when a later save throws", () => {
		// The import's saves run in createDish's own transactions, nested in the import's.
		expect(() =>
			transaction(() => {
				makeDish(householdId, recipe('Rice'));
				throw new Error('Broken');
			})
		).toThrow('Broken');
		expect(names()).toEqual([]);
	});
});
