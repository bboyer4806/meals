import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRecipe, schemaRecipeValues, type JsonLdNode } from './recipe-schema.ts';
import { newRecipeValues, type RecipeFormValues } from './server/recipe-form.ts';
import { NORMALIZE_MAX_LENGTH } from './text.ts';

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
			['2', '', 'pre-baked pizza crusts', '12 inch'],
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

	it('reads commas between thousands in nutrition, and leaves other commas blank', () => {
		const nutrition = {
			calories: '1,250 kcal',
			proteinContent: '1,000.5 g',
			carbohydrateContent: '1,250,000 g',
			fatContent: '12,5 g'
		};
		expect(fromRecipe({ nutrition })).toMatchObject({
			calories: '1250',
			proteinG: '1000.5',
			carbsG: '1250000',
			// The comma could be a decimal point, so it isn't guessed at (MEA-76).
			fatG: ''
		});
		for (const calories of ['1,25 kcal', '1,2500 kcal', '1.250,5 kcal', '1,250,5 kcal']) {
			expect(fromRecipe({ nutrition: { calories } }).calories).toBe('');
		}
	});

	it('reads spaces between thousands in nutrition, and a period as a decimal point', () => {
		const nutrition = {
			calories: '1 250 kcal',
			// A no-break space, and a narrow one, as French pages write thousands.
			proteinContent: '1\u00a0000.5 g',
			carbohydrateContent: '1\u202f250\u202f000 g',
			fatContent: '1.250 g'
		};
		expect(fromRecipe({ nutrition })).toMatchObject({
			calories: '1250',
			proteinG: '1000.5',
			carbsG: '1250000',
			// A period isn't a comma: it's a decimal point even before three digits (MEA-233).
			fatG: '1.250'
		});
		// A space after something other than a digit doesn't join numbers.
		expect(fromRecipe({ nutrition: { calories: 'Approx. 250 kcal' } }).calories).toBe('250');
		// Other commas are still left blank (MEA-76).
		expect(fromRecipe({ nutrition: { calories: '1 250,5 kcal' } }).calories).toBe('');
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
			['2', 'cups', 'medium rye flour', '212g'],
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
		// Cut to the most normalizing takes (text.ts).
		expect(values.name).toHaveLength(NORMALIZE_MAX_LENGTH);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it('cuts text over 10000 characters in one place before normalizing it (MEA-64)', () => {
		const long = 'x'.repeat(NORMALIZE_MAX_LENGTH + 5);
		const values = fromRecipe({
			name: long,
			recipeIngredient: [`2 cups ${long}`],
			recipeInstructions: [long, 'Bake.']
		});
		const most = 'x'.repeat(NORMALIZE_MAX_LENGTH);
		expect(values.name).toBe(most);
		expect(ingredients(values)).toEqual([['2', 'cups', most.slice('2 cups '.length), '']]);
		expect(values.steps).toBe(`${most}\nBake.`);
		// Combining marks that would hold up the server for minutes if normalized all together.
		const marks = 'a' + '\u0301\u0316'.repeat(1_000_000);
		expect(fromRecipe({ name: marks }).name.length).toBeLessThanOrEqual(NORMALIZE_MAX_LENGTH);
	});

	it('reads up to 100000 characters in all, the name, ingredients and then steps (MEA-234)', () => {
		const most = 'x'.repeat(NORMALIZE_MAX_LENGTH);
		// The name and ingredients come to 40,005 characters, and the steps pass 100,000 in their
		// sixth line, which is cut. The lines after it are left out.
		const values = fromRecipe({
			recipeInstructions: [...Array<string>(7).fill(most), 'Serve.'],
			recipeIngredient: Array<string>(4).fill(most),
			name: 'Toast'
		});
		expect(values.name).toBe('Toast');
		expect(ingredients(values)).toEqual(Array(4).fill(['', '', most, '']));
		expect(values.steps.split('\n')).toEqual([...Array<string>(5).fill(most), 'x'.repeat(9_995)]);
	});

	it('reads a page written to be slow to normalize in under a second (MEA-234)', () => {
		// Runs of 10,000 combining marks, each of which takes a few hundredths of a second to
		// normalize (text.ts). The 250 lines, 5 MB as a page sends them, would take seconds.
		const run = `a${'\u0301\u0316'.repeat(4_999)}\u0301`;
		const started = performance.now();
		const values = fromRecipe({ recipeInstructions: Array<string>(250).fill(run) });
		expect(performance.now() - started).toBeLessThan(1000);
		// 10 lines come to 100,000 characters.
		expect(values.steps.split('\n')).toHaveLength(10);
	});

	it("keeps a new recipe's fields when the Recipe has none of them", () => {
		expect(fromRecipe({})).toEqual(START);
		const empty = { name: ' ', recipeIngredient: [], recipeInstructions: [], nutrition: 'None' };
		expect(fromRecipe(empty)).toEqual(START);
	});
});
