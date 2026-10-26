import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRecipe, schemaRecipeValues, type JsonLdNode } from './recipe-schema.ts';
import { newRecipeValues, type RecipeFormValues } from './server/recipe-form.ts';

// Each JSON file in src/lib/test-pages holds the application/ld+json blocks of a real recipe
// page, parsed, in the page's order. The recipe-scrapers project saved the pages for its tests.
function page(name: string): unknown {
	return JSON.parse(readFileSync(`src/lib/test-pages/${name}.json`, 'utf8'));
}

// A new recipe's fields at the household's usual 4 servings, with the link as its source.
const START: RecipeFormValues = { ...newRecipeValues(4), source: 'https://example.com/recipe' };

/** The page's Recipe, filled into a new recipe. */
function imported(name: string): RecipeFormValues {
	const recipe = findRecipe(page(name));
	if (!recipe) throw new Error(`No Recipe in ${name}`);
	return schemaRecipeValues(recipe, START);
}

/** A Recipe with these fields, filled into a new recipe. */
function fromRecipe(fields: JsonLdNode): RecipeFormValues {
	return schemaRecipeValues({ '@type': 'Recipe', ...fields }, START);
}

/** The ingredient rows as [amount, unit, item, prep note]. */
function ingredients(values: RecipeFormValues): string[][] {
	return values.rows.map((row) =>
		row.kind === 'ingredient' ? [row.amount, row.unit, row.item, row.prepNote] : [row.heading]
	);
}

describe('findRecipe', () => {
	it('finds the Recipe at the top level, in a list or in an @graph', () => {
		// The first of three blocks.
		expect(findRecipe(page('tasty'))).toMatchObject({ name: expect.stringMatching(/^Red Wine/) });
		// [{ "@type": ["Recipe"] }]
		expect(findRecipe(page('allrecipes'))).toMatchObject({ name: 'Four Cheese Margherita Pizza' });
		// The last node of an @graph, after the article, the website and its owner.
		expect(findRecipe(page('sallysbakingaddiction'))).toMatchObject({
			name: 'Cake Batter Chocolate Chip Cookies'
		});
	});

	it('is null for a page without a Recipe', () => {
		expect(findRecipe([])).toBeNull();
		const notRecipes = [
			{ '@type': 'WebSite', name: 'Recipes' },
			{ '@graph': [{ '@type': 'Organization' }] },
			// A page listing recipes isn't one recipe.
			{ '@type': 'ItemList', itemListElement: [{ '@type': 'Recipe', name: 'Soup' }] },
			'Recipe',
			null,
			4
		];
		expect(findRecipe(notRecipes)).toBeNull();
	});
});

describe('schemaRecipeValues', () => {
	it('fills in the editor from a recipe page', () => {
		const values = imported('allrecipes');
		expect(values).toEqual({
			...START,
			name: 'Four Cheese Margherita Pizza',
			servings: '8',
			prepMinutes: '15',
			cookMinutes: '10',
			steps: [
				'Stir together olive oil, garlic, and salt; toss with tomatoes, and allow to stand for 15 minutes. Preheat oven to 400 degrees F (200 degrees C).',
				'Brush each pizza crust with some of the tomato marinade. Sprinkle the pizzas evenly with Mozzarella and Fontina cheeses. Arrange tomatoes overtop, then sprinkle with shredded basil, Parmesan, and feta cheese.',
				'Bake in preheated oven until the cheese is bubbly and golden brown, about 10 minutes.'
			].join('\n'),
			calories: '551',
			proteinG: '29',
			carbsG: '54',
			fatG: '26',
			rows: values.rows
		});
		// Split as Import recipes splits each ingredient.
		expect(ingredients(values)).toEqual([
			['0.25', 'cup', 'olive oil', ''],
			['1', 'tablespoon', 'minced garlic', ''],
			['0.5', 'teaspoon', 'sea salt', ''],
			['8', '', 'Roma tomatoes', 'sliced'],
			['2', '', '(12 inch) pre-baked pizza crusts', ''],
			['8', 'ounces', 'shredded Mozzarella cheese', ''],
			['4', 'ounces', 'shredded Fontina cheese', ''],
			['10', '', 'fresh basil leaves', 'washed, dried'],
			['0.5', 'cup', 'freshly grated Parmesan cheese', ''],
			['0.5', 'cup', 'crumbled feta cheese', '']
		]);
	});

	it('reads times in hours and minutes, and character references', () => {
		const values = imported('sallysbakingaddiction');
		// PT2H15M and PT10M, and the yield ["28", "28-32 cookies"].
		expect(values).toMatchObject({ servings: '28', prepMinutes: '135', cookMinutes: '10' });
		// &amp;, and &#8220; and &#8221;.
		expect(ingredients(values)[0]?.[2]).toContain('(spooned & leveled)');
		expect(values.steps).toContain('Shape your cookie dough balls to be “taller” than they are wide');
		expect(values.steps.split('\n')).toHaveLength(8);
		// The page has no nutrition.
		expect(values).toMatchObject({ calories: '', proteinG: '', carbsG: '', fatG: '' });
	});

	it('reads the steps of HowToSections, leaving out the section names', () => {
		const values = imported('preppykitchen');
		expect(values.steps.split('\n')).toEqual([
			'In a medium bowl, whisk together the soy sauce, water, brown sugar, ginger, and garlic. Set aside.',
			'In a large bowl, toss the steak with the cornstarch until well coated.',
			expect.stringMatching(/^In a large skillet or wok, heat the oil/),
			expect.stringMatching(/^With the skillet still over medium-high heat/),
			expect.stringMatching(/^Cook, stirring often, until the beef is well coated/)
		]);
		expect(values).toMatchObject({
			name: 'Mongolian Beef Recipe',
			servings: '4',
			calories: '385',
			proteinG: '27',
			carbsG: '33',
			fatG: '16'
		});
	});

	it('reads servings like "4 servings", and keeps what the page leaves out', () => {
		const values = imported('tasty');
		// The page has no times or nutrition.
		expect(values).toEqual({
			...START,
			name: 'Red Wine-Braised Short Ribs With Cashew Cauliflower Mash Recipe by Tasty',
			servings: '4',
			steps: values.steps,
			rows: values.rows
		});
		expect(values.steps.split('\n')).toHaveLength(15);
		expect(ingredients(values)).toHaveLength(18);
		expect(ingredients(values).at(-1)).toEqual([
			'¼',
			'cup',
			'fresh parsley',
			'chopped, for garnish'
		]);
	});

	it('reads durations in whole minutes', () => {
		expect(fromRecipe({ prepTime: 'PT1H30M', cookTime: 'P0DT0H20M' })).toMatchObject({
			prepMinutes: '90',
			cookMinutes: '20'
		});
		expect(fromRecipe({ prepTime: 'P1DT2H', cookTime: 'pt1.5h' })).toMatchObject({
			prepMinutes: '1560',
			cookMinutes: '90'
		});
		expect(fromRecipe({ prepTime: 'PT0M', cookTime: 'PT45S' })).toMatchObject({
			prepMinutes: '0',
			cookMinutes: '1'
		});
		for (const time of ['', 'PT', '20 minutes', 20, null]) {
			expect(fromRecipe({ prepTime: time, cookTime: time })).toMatchObject({
				prepMinutes: '',
				cookMinutes: ''
			});
		}
	});

	it('takes the first whole number in the yield as the servings', () => {
		expect(fromRecipe({ recipeYield: 6 }).servings).toBe('6');
		expect(fromRecipe({ recipeYield: 'Serves 6 to 8' }).servings).toBe('6');
		expect(fromRecipe({ recipeYield: ['', 'Makes 12'] }).servings).toBe('12');
		// The household's usual servings stay.
		expect(fromRecipe({ recipeYield: 'A crowd' }).servings).toBe('4');
	});

	it('reads nutrition as numbers', () => {
		const nutrition = {
			calories: '240 kcal',
			proteinContent: '12.5 g',
			carbohydrateContent: 30,
			fatContent: '0g'
		};
		expect(fromRecipe({ nutrition })).toMatchObject({
			calories: '240',
			proteinG: '12.5',
			carbsG: '30',
			fatG: '0'
		});
		expect(fromRecipe({ nutrition: { calories: 'unknown' } }).calories).toBe('');
	});

	it('reads steps written as text, one step per line', () => {
		// As King Arthur Baking writes them: paragraphs, with a comma between them.
		const paragraphs = '<p>Preheat the oven to 325°F.</p>\n, <p>Weigh your flour.</p>\n, ';
		expect(fromRecipe({ recipeInstructions: paragraphs }).steps).toBe(
			'Preheat the oven to 325°F.\nWeigh your flour.'
		);
		expect(fromRecipe({ recipeInstructions: 'Mix.\r\n\r\nBake<br>Cool.' }).steps).toBe(
			'Mix.\nBake\nCool.'
		);
		const list = ['Mix the  batter.', '', { '@type': 'HowToStep', text: 'Bake &amp; cool.' }];
		expect(fromRecipe({ recipeInstructions: list }).steps).toBe('Mix the batter.\nBake & cool.');
	});

	it('takes the text out of HTML in the name and ingredients', () => {
		const values = fromRecipe({
			name: 'Mom&#39;s <em>best</em> pie',
			recipeIngredient: [
				// As King Arthur Baking links an ingredient to its shop.
				'2 cups (212g) <a href="https://shop.example.com/rye" data-price="$9.95">medium rye flour</a>',
				'2 &frac12; pounds peaches, peeled',
				' ',
				'<br>'
			]
		});
		expect(values.name).toBe("Mom's best pie");
		expect(ingredients(values)).toEqual([
			['2', 'cups', '(212g) medium rye flour', ''],
			['2 ½', 'pounds', 'peaches', 'peeled']
		]);
	});

	it('reads text written to be slow to search as fast as any other', () => {
		const started = performance.now();
		// 1 MB each of tags that never close.
		const values = fromRecipe({
			name: '<a '.repeat(330_000),
			recipeInstructions: '<p '.repeat(330_000)
		});
		expect(values.name).toHaveLength(989_999);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("keeps a new recipe's fields when the Recipe has none of them", () => {
		expect(fromRecipe({})).toEqual(START);
		const empty = { name: ' ', recipeIngredient: [], recipeInstructions: [], nutrition: 'None' };
		expect(fromRecipe(empty)).toEqual(START);
	});
});
