import { describe, expect, it } from 'vitest';
import {
	applyImport,
	changesEditor,
	ingredientText,
	nothingToReview,
	reviewImport,
	type IngredientEntry,
	type Review
} from './recipe-merge.ts';
import type { LinkValues } from './recipe-schema.ts';
import type { RecipeFormValues, RecipeRow } from './server/recipe-form.ts';

const LINK = 'https://recipes.example/pancakes';

function ingredient(amount: string, unit: string, item: string, prepNote = '') {
	return { kind: 'ingredient' as const, amount, unit, item, prepNote };
}

function section(heading: string): RecipeRow {
	return { kind: 'section', heading };
}

// The editor as it is when Import's answer comes: a saved recipe, perhaps changed since.
const EDITOR: RecipeFormValues = {
	name: 'Pancakes',
	servings: '4',
	prepMinutes: '10',
	cookMinutes: '',
	tags: 'Breakfast',
	steps: 'Mix.\nFry.',
	notes: 'Family favorite',
	source: '',
	calories: '',
	proteinG: '',
	carbsG: '',
	fatG: '',
	rows: [ingredient('2', 'cups', 'Flour'), ingredient('1', 'cup', 'Milk')]
};

// A page with none of the editor's fields, imported from LINK.
const NOTHING: LinkValues = {
	name: null,
	servings: null,
	prepMinutes: null,
	cookMinutes: null,
	steps: null,
	source: LINK,
	calories: null,
	proteinG: null,
	carbsG: null,
	fatG: null,
	rows: null
};

/** The editor with these ingredient rows. */
function withRows(rows: RecipeRow[]): RecipeFormValues {
	return { ...EDITOR, source: LINK, rows };
}

/** The review of a page that has only these ingredients. */
function ingredientsOf(editor: RecipeFormValues, rows: RecipeRow[]): IngredientEntry[] {
	return reviewImport(editor, { ...NOTHING, rows }).ingredients;
}

/** The review with these choices made for its ingredients, in order. */
function choosing(review: Review, choices: IngredientEntry['choice'][]): Review {
	return {
		...review,
		ingredients: review.ingredients.map((entry, at) => ({
			...entry,
			choice: choices[at] ?? 'skip'
		}))
	};
}

describe('reviewImport', () => {
	it('fills in empty fields, and asks before replacing ones with something else', () => {
		const review = reviewImport(EDITOR, {
			...NOTHING,
			name: 'Buttermilk pancakes',
			servings: '6',
			cookMinutes: '15',
			steps: 'Whisk.\nFry.',
			calories: '300'
		});
		expect(review).toEqual({
			fills: [
				{ field: 'cookMinutes', imported: '15' },
				{ field: 'source', imported: LINK },
				{ field: 'calories', imported: '300' }
			],
			// Kept until chosen.
			conflicts: [
				{ field: 'name', current: 'Pancakes', imported: 'Buttermilk pancakes', replace: false },
				{ field: 'servings', current: '4', imported: '6', replace: false },
				{ field: 'steps', current: 'Mix.\nFry.', imported: 'Whisk.\nFry.', replace: false }
			],
			ingredients: []
		});
	});

	it('leaves the fields the page has none of as they are, even empty ones', () => {
		// The editor's prep time stays, and its empty cook time and nutrition stay empty.
		expect(reviewImport(EDITOR, NOTHING)).toEqual({
			fills: [{ field: 'source', imported: LINK }],
			conflicts: [],
			ingredients: []
		});
		expect(nothingToReview(reviewImport({ ...EDITOR, source: LINK }, NOTHING))).toBe(true);
	});

	it('compares numbers by value, and other fields without the spaces at their ends', () => {
		const editor = { ...EDITOR, name: ' Pancakes ', steps: 'Mix.\nFry.\n', calories: '1.25' };
		const page = { ...NOTHING, name: 'Pancakes', steps: 'Mix.\nFry.', calories: '1.250' };
		expect(nothingToReview(reviewImport({ ...editor, source: LINK }, page))).toBe(true);
	});

	it('needs nothing for an ingredient the editor already has, however it is written', () => {
		const editor = withRows([
			ingredient('2', 'cups', 'Flour'),
			ingredient('1/2', 'tsp', 'Salt'),
			ingredient('', '', 'Pepper', 'to  taste')
		]);
		const page = [
			ingredient('2', 'cup', 'flour'),
			ingredient('½', 'teaspoon', 'salt'),
			ingredient('', '', 'pepper', 'to taste')
		];
		expect(ingredientsOf(editor, page)).toEqual([]);
	});

	it('matches an ingredient by item when the editor and the page each have it once', () => {
		const entries = ingredientsOf(EDITOR, [ingredient('2 1/2', 'cups', 'flour', 'sifted')]);
		expect(entries).toEqual([
			{
				kind: 'match',
				imported: { amount: '2 1/2', unit: 'cups', item: 'flour', prepNote: 'sifted' },
				current: {
					at: 0,
					label: 'Ingredient 1',
					ingredient: { amount: '2', unit: 'cups', item: 'Flour', prepNote: '' }
				},
				choice: 'skip'
			}
		]);
	});

	it("offers to add an ingredient whose item the editor doesn't have", () => {
		expect(ingredientsOf(EDITOR, [ingredient('2', '', 'eggs')])).toEqual([
			{
				kind: 'new',
				imported: { amount: '2', unit: '', item: 'eggs', prepNote: '' },
				choice: 'skip'
			}
		]);
	});

	it('asks which ingredient to replace when the editor has the item more than once', () => {
		const editor = withRows([
			section('Batter'),
			ingredient('', '', '', ''),
			ingredient('1', 'cup', 'Sugar'),
			section('Topping'),
			ingredient('2', 'tbsp', 'Sugar')
		]);
		const [entry, ...rest] = ingredientsOf(editor, [ingredient('3/4', 'cup', 'sugar')]);
		expect(rest).toEqual([]);
		// Numbered as the editor numbers them: blank rows count, and headings don't.
		expect(entry).toEqual({
			kind: 'choose',
			imported: { amount: '3/4', unit: 'cup', item: 'sugar', prepNote: '' },
			candidates: [
				{
					at: 2,
					label: 'Ingredient 2',
					ingredient: { amount: '1', unit: 'cup', item: 'Sugar', prepNote: '' }
				},
				{
					at: 4,
					label: 'Ingredient 3',
					ingredient: { amount: '2', unit: 'tbsp', item: 'Sugar', prepNote: '' }
				}
			],
			choice: 'skip'
		});
	});

	it('asks which ingredient to replace when the page has the item more than once', () => {
		const editor = withRows([ingredient('1', 'cup', 'Sugar')]);
		const entries = ingredientsOf(editor, [
			ingredient('1/2', 'cup', 'sugar'),
			ingredient('1', 'tbsp', 'sugar')
		]);
		expect(entries.map((entry) => entry.kind)).toEqual(['choose', 'choose']);
		expect(entries.map((entry) => entry.kind === 'choose' && entry.candidates.length)).toEqual([
			1, 1
		]);
	});

	it("leaves an ingredient already the same as one of the page's out of the matching", () => {
		const editor = withRows([
			ingredient('1', 'cup', 'Sugar'),
			ingredient('2', 'tbsp', 'Sugar'),
			ingredient('1', 'tsp', 'Salt')
		]);
		const entries = ingredientsOf(editor, [
			ingredient('1', 'cup', 'sugar'),
			ingredient('3', 'tbsp', 'sugar'),
			ingredient('1', 'tsp', 'salt'),
			ingredient('1', 'pinch', 'salt')
		]);
		// The 1 cup of sugar is already there, so the other is matched to the 2 tbsp. The salt is
		// there too, so another salt is new.
		expect(entries).toMatchObject([
			{ kind: 'match', imported: { amount: '3' }, current: { at: 1 } },
			{ kind: 'new', imported: { amount: '1', unit: 'pinch' } }
		]);
	});
});

describe('applyImport', () => {
	it('fills in the empty fields, and replaces only the fields chosen', () => {
		const review = reviewImport(EDITOR, {
			...NOTHING,
			name: 'Buttermilk pancakes',
			servings: '6',
			prepMinutes: '5',
			cookMinutes: '15',
			steps: 'Whisk.\nFry.'
		});
		for (const conflict of review.conflicts) conflict.replace = conflict.field !== 'name';
		expect(applyImport(EDITOR, review)).toEqual({
			...EDITOR,
			servings: '6',
			prepMinutes: '5',
			cookMinutes: '15',
			steps: 'Whisk.\nFry.',
			source: LINK
		});
	});

	it('changes nothing when nothing fills in and nothing is chosen', () => {
		const review = reviewImport({ ...EDITOR, source: LINK }, { ...NOTHING, name: 'Crepes' });
		expect(changesEditor(review)).toBe(false);
		expect(applyImport({ ...EDITOR, source: LINK }, review)).toEqual({ ...EDITOR, source: LINK });
		review.conflicts[0]!.replace = true;
		expect(changesEditor(review)).toBe(true);
	});

	it('replaces chosen ingredients in place and adds chosen ones at the end, in order', () => {
		const editor = withRows([
			ingredient('2', 'cups', 'Flour'),
			section('Batter'),
			ingredient('1', 'cup', 'Sugar'),
			ingredient('2', '', 'Egg'),
			section('Topping'),
			ingredient('2', 'tbsp', 'Sugar'),
			ingredient('1', 'tbsp', 'Butter')
		]);
		const review = reviewImport(editor, {
			...NOTHING,
			rows: [
				ingredient('2', 'cups', 'flour'),
				ingredient('3/4', 'cup', 'sugar'),
				ingredient('1', 'tbsp', 'sugar'),
				ingredient('3', '', 'egg'),
				ingredient('1', 'tbsp', 'butter', 'softened'),
				ingredient('1', 'cup', 'milk'),
				ingredient('1', 'tsp', 'vanilla')
			]
		});
		expect(review.ingredients.map((entry) => entry.kind)).toEqual([
			'choose',
			'choose',
			'match',
			'match',
			'new',
			'new'
		]);
		// The first sugar replaces the batter's, the egg is replaced, the butter kept, and the milk
		// and vanilla added.
		const chosen = choosing(review, [2, 'skip', 3, 'skip', 'add', 'add']);
		expect(changesEditor(chosen)).toBe(true);
		expect(applyImport(editor, chosen).rows).toEqual([
			ingredient('2', 'cups', 'Flour'),
			section('Batter'),
			// The editor's item stays.
			ingredient('3/4', 'cup', 'Sugar'),
			ingredient('3', '', 'Egg'),
			section('Topping'),
			ingredient('2', 'tbsp', 'Sugar'),
			ingredient('1', 'tbsp', 'Butter'),
			// Out of the Topping section.
			section(''),
			ingredient('1', 'cup', 'milk'),
			ingredient('1', 'tsp', 'vanilla')
		]);
		// Nothing chosen leaves the rows as they were.
		expect(applyImport(editor, review).rows).toEqual(editor.rows);
	});

	it('adds ingredients in place of blank rows at the end, without a heading when none is needed', () => {
		const eggs = ingredient('2', '', 'eggs');
		// As a recipe without ingredients opens.
		const empty = withRows([ingredient('', '', '', '')]);
		expect(
			applyImport(empty, choosing(reviewImport(empty, { ...NOTHING, rows: [eggs] }), ['add'])).rows
		).toEqual([eggs]);

		const ended = withRows([section('Batter'), ingredient('1', 'cup', 'Flour'), section(' ')]);
		const review = choosing(reviewImport(ended, { ...NOTHING, rows: [eggs] }), ['add']);
		expect(applyImport(ended, review).rows).toEqual([...ended.rows, eggs]);
	});

	it("throws for a choice that isn't one of the editor's ingredients", () => {
		const review = choosing(
			reviewImport(EDITOR, { ...NOTHING, rows: [ingredient('3', '', 'eggs')] }),
			[5]
		);
		expect(() => applyImport(EDITOR, review)).toThrow("Row 5 isn't an ingredient");
	});
});

describe('ingredientText', () => {
	it('writes an ingredient as one line', () => {
		const line = (amount: string, unit: string, item: string, prepNote: string) =>
			ingredientText({ amount, unit, item, prepNote });
		expect(line('1 1/2', 'cups', 'flour', 'sifted')).toBe('1 1/2 cups flour, sifted');
		expect(line('3', '', 'eggs', '')).toBe('3 eggs');
		expect(line('', ' ', 'Salt', 'to taste')).toBe('Salt, to taste');
	});
});
