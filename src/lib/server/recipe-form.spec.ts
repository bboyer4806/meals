import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import {
	createDish,
	getDish,
	listDishes,
	setDishArchived,
	setDishPhoto,
	updateDish,
	type DishInput
} from './data/dishes.ts';
import { deletePhoto, PHOTO_MAX_BYTES, photoPath, THUMB_MAX_BYTES } from './photos.ts';
import {
	nameTakenFailure,
	newRecipeValues,
	parseRecipeForm,
	recipeValues,
	saveRecipe,
	type RecipeFormValues,
	type RecipeRow
} from './recipe-form.ts';
import { freshDb, ingredient, makeDish, makeHousehold, recipe } from './testing.ts';

// The real functions, which a test can make fail once.
vi.mock('./data/dishes.ts', async (importOriginal) => {
	const dishes = await importOriginal<typeof import('./data/dishes.ts')>();
	return { ...dishes, setDishPhoto: vi.fn(dishes.setDishPhoto) };
});
vi.mock('./photos.ts', async (importOriginal) => {
	const photos = await importOriginal<typeof import('./photos.ts')>();
	return { ...photos, deletePhoto: vi.fn(photos.deletePhoto) };
});

/** The form as the editor sends it: every field, with the rows as JSON in `ingredients`. */
function formData(
	values: Partial<RecipeFormValues> = {},
	extra: Record<string, string | File> = {}
): FormData {
	const { rows, ...fields } = { ...newRecipeValues(4), name: 'Pound cake', ...values };
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	data.set('ingredients', JSON.stringify(rows));
	for (const [key, value] of Object.entries(extra)) data.set(key, value);
	return data;
}

function parse(values: Partial<RecipeFormValues> = {}, extra: Record<string, string | File> = {}) {
	const result = parseRecipeForm(formData(values, extra));
	if ('failure' in result) throw new Error(`Expected it to parse: ${result.failure.data.error}`);
	return result;
}

/** The message the form shows. */
function problem(
	values: Partial<RecipeFormValues> = {},
	extra: Record<string, string | File> = {}
): string {
	return problemIn(formData(values, extra));
}

function problemIn(data: FormData): string {
	const result = parseRecipeForm(data);
	if (!('failure' in result)) throw new Error('Expected a failure');
	expect(result.failure.status).toBe(400);
	expect(result.failure.data.action).toBe('recipe');
	return result.failure.data.error;
}

function row(amount = '', unit = '', item = '', prepNote = ''): RecipeRow {
	return { kind: 'ingredient', amount, unit, item, prepNote };
}

function heading(text: string): RecipeRow {
	return { kind: 'section', heading: text };
}

/** The ingredients the rows become. */
function ingredients(...rows: RecipeRow[]) {
	return parse({ rows }).data.ingredients;
}

/** The message for these rows. */
function rowProblem(...rows: RecipeRow[]) {
	return problem({ rows });
}

function withIngredients(json: string | null): FormData {
	const data = formData();
	if (json === null) data.delete('ingredients');
	else data.set('ingredients', json);
	return data;
}

/** A file of `size` bytes that starts like a JPEG, filled with `fill` after that. */
function jpeg(size = 100, fill = 7): File {
	const bytes = new Uint8Array(size).fill(fill);
	if (size >= 3) bytes.set([0xff, 0xd8, 0xff]);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

describe('the fields', () => {
	it('reads every field', () => {
		const { data } = parse({
			name: '  Pound   cake ',
			servings: '8',
			prepMinutes: '20',
			cookMinutes: ' 70 ',
			tags: 'Dessert, Baking',
			steps: 'Cream the butter.\nBake 70 minutes.',
			notes: 'Better the next day.',
			source: ' https://example.com/pound-cake ',
			calories: '420',
			proteinG: '5.5',
			carbsG: '50',
			fatG: '22.25',
			rows: [row('1', 'cup', 'Butter', 'softened')]
		});
		expect(data).toEqual({
			name: 'Pound cake',
			servings: 8,
			prepMinutes: 20,
			cookMinutes: 70,
			steps: 'Cream the butter.\nBake 70 minutes.',
			notes: 'Better the next day.',
			source: 'https://example.com/pound-cake',
			calories: 420,
			proteinG: 5.5,
			carbsG: 50,
			fatG: 22.25,
			tags: ['Dessert', 'Baking'],
			ingredients: [ingredient('Butter', 1, 'cup', { prepNote: 'softened' })]
		} satisfies DishInput);
	});

	it('saves blank optional fields as empty', () => {
		const { data } = parse({ steps: ' \n \n', notes: '  ', source: ' ' });
		expect(data).toEqual(recipe('Pound cake'));
	});

	it('needs a name of up to 80 characters', () => {
		expect(problem({ name: '   ' })).toBe('Enter a recipe name');
		expect(problem({ name: 'a'.repeat(81) })).toBe('Keep a recipe name under 80 characters');
		expect(parse({ name: 'a'.repeat(80) }).data.name).toBe('a'.repeat(80));
	});

	it('needs a whole number of servings from 1 to 100', () => {
		expect(problem({ servings: '' })).toBe('Enter at least 1 serving');
		expect(problem({ servings: '0' })).toBe('Enter at least 1 serving');
		expect(problem({ servings: '101' })).toBe('Enter 100 servings or fewer');
		expect(problem({ servings: '2.5' })).toBe('Enter a whole number of servings');
		expect(problem({ servings: 'lots' })).toBe('Enter a number of servings');
		expect(parse({ servings: '1' }).data.servings).toBe(1);
		expect(parse({ servings: ' 100 ' }).data.servings).toBe(100);
	});

	it('takes prep and cook times in whole minutes up to 10000', () => {
		expect(parse({ prepMinutes: '0', cookMinutes: '10000' }).data).toMatchObject({
			prepMinutes: 0,
			cookMinutes: 10_000
		});
		expect(parse({ prepMinutes: '', cookMinutes: ' ' }).data).toMatchObject({
			prepMinutes: null,
			cookMinutes: null
		});
		for (const minutes of ['-5', '1.5', 'soon', '1e3', '0x10', 'Infinity']) {
			expect(problem({ prepMinutes: minutes })).toBe('Enter the prep time in whole minutes');
		}
		expect(problem({ prepMinutes: '10001' })).toBe('Enter a prep time of 10000 minutes or less');
		expect(problem({ cookMinutes: '-1' })).toBe('Enter the cook time in whole minutes');
		expect(problem({ cookMinutes: '10001' })).toBe('Enter a cook time of 10000 minutes or less');
	});

	it('takes nutrition per serving as numbers from 0 to 100000', () => {
		const { data } = parse({ calories: '0', proteinG: '12.5', carbsG: '100000', fatG: '' });
		expect(data).toMatchObject({ calories: 0, proteinG: 12.5, carbsG: 100_000, fatG: null });
		expect(parse({ fatG: '.5' }).data.fatG).toBe(0.5);
		expect(problem({ calories: '-1' })).toBe('Enter calories as a number, 0 or more');
		expect(problem({ calories: '100001' })).toBe('Enter 100000 calories or less');
		expect(problem({ proteinG: 'a lot' })).toBe('Enter protein in grams, 0 or more');
		expect(problem({ proteinG: '100001' })).toBe('Enter 100000 g of protein or less');
		expect(problem({ carbsG: '-0.5' })).toBe('Enter carbs in grams, 0 or more');
		expect(problem({ carbsG: '100001' })).toBe('Enter 100000 g of carbs or less');
		expect(problem({ fatG: 'Infinity' })).toBe('Enter fat in grams, 0 or more');
		expect(problem({ fatG: '100000.5' })).toBe('Enter 100000 g of fat or less');
	});

	it('keeps the lines of steps and notes, stored with \\n line breaks', () => {
		const { data } = parse({
			steps: '\r\nCream the butter.\r\nAdd the eggs.\rBake.\r\n',
			notes: 'Line one\r\n\r\n  Line two'
		});
		expect(data.steps).toBe('Cream the butter.\nAdd the eggs.\nBake.');
		expect(data.notes).toBe('Line one\n\n  Line two');
	});

	it('limits steps to 10000 characters, counting a line break as one', () => {
		expect(parse({ steps: 'a'.repeat(10_000) }).data.steps).toHaveLength(10_000);
		expect(problem({ steps: 'a'.repeat(10_001) })).toBe('Keep the steps under 10000 characters');
		// 5000 lines and 4999 line breaks, sent the way a browser sends them.
		const steps = Array(5000).fill('a').join('\r\n');
		expect(parse({ steps }).data.steps).toHaveLength(9999);
	});

	it('limits notes to 2000 characters and the source to 500', () => {
		expect(parse({ notes: 'a'.repeat(2000), source: 'b'.repeat(500) }).data).toMatchObject({
			notes: 'a'.repeat(2000),
			source: 'b'.repeat(500)
		});
		expect(problem({ notes: 'a'.repeat(2001) })).toBe('Keep the notes under 2000 characters');
		expect(problem({ source: 'b'.repeat(501) })).toBe('Keep the source under 500 characters');
	});

	it('names the first problem in the order of the form', () => {
		expect(problem({ name: '', servings: '0', rows: [row('x', '', 'Flour')] })).toBe(
			'Enter a recipe name'
		);
		expect(problem({ fatG: '-1', rows: [row('x', '', 'Flour')], tags: 'a'.repeat(31) })).toBe(
			'Keep each tag under 30 characters'
		);
		expect(problem({ fatG: '-1', rows: [row('x', '', 'Flour')] })).toBe(
			'Ingredient 1: enter an amount like 1 1/2'
		);
		expect(problem({ fatG: '-1', notes: 'a'.repeat(2001), rows: [row('', '', 'Salt')] })).toBe(
			'Keep the notes under 2000 characters'
		);
	});
});

describe('tags', () => {
	function tags(text: string) {
		return parse({ tags: text }).data.tags;
	}

	it('splits on commas, trims each tag and skips empty ones', () => {
		expect(tags(' Dinner ,  quick   weeknight,, ,')).toEqual(['Dinner', 'quick weeknight']);
		expect(tags('')).toEqual([]);
		expect(tags(' , ')).toEqual([]);
	});

	it('keeps each tag once ignoring case, with the first spelling', () => {
		expect(tags('Dessert, dessert, Baking, DESSERT')).toEqual(['Dessert', 'Baking']);
		expect(tags('Éclairs, éCLAIRS')).toEqual(['Éclairs']);
	});

	it('allows 10 tags, counting each once', () => {
		const ten = Array.from({ length: 10 }, (_, i) => `Tag ${i}`);
		expect(tags([...ten, 'tag 0', 'TAG 9'].join(','))).toEqual(ten);
		expect(problem({ tags: [...ten, 'Tag 10'].join(',') })).toBe('Use 10 tags or fewer');
	});

	it('allows tags of up to 30 characters', () => {
		expect(tags(`  ${'a'.repeat(30)}  `)).toEqual(['a'.repeat(30)]);
		expect(problem({ tags: `Dinner, ${'a'.repeat(31)}` })).toBe(
			'Keep each tag under 30 characters'
		);
	});
});

describe('ingredient rows', () => {
	it('reads amounts as people type them', () => {
		const amounts = ['2', '1.5', '.5', '1 1/2', '1-1/2', '1/2', '½', '1½', '1 ½', ' 3 '].map(
			(amount) => ingredients(row(amount, '', 'Flour'))[0]?.amount
		);
		expect(amounts).toEqual([2, 1.5, 0.5, 1.5, 1.5, 0.5, 0.5, 1.5, 1.5, 3]);
	});

	it('stores known units by their code and keeps custom ones as typed', () => {
		const units = [
			'Cups',
			'T',
			't',
			'tablespoons',
			'Fl. Oz.',
			'LBS',
			'cloves',
			' big   cans ',
			'',
			'  '
		].map((unit) => ingredients(row('2', unit, 'Flour'))[0]?.unit);
		expect(units).toEqual([
			'cup',
			'tbsp',
			'tsp',
			'tbsp',
			'fl oz',
			'lb',
			'cloves',
			'big cans',
			null,
			null
		]);
	});

	it('trims item names and prep notes', () => {
		expect(ingredients(row('', '', '  Brown   sugar ', ' packed,  dark '))).toEqual([
			ingredient('Brown sugar', null, null, { prepNote: 'packed, dark' })
		]);
		expect(ingredients(row('3', '', 'Eggs', '   '))).toEqual([ingredient('Eggs', 3)]);
	});

	it('puts each ingredient in the section of the heading above it', () => {
		expect(
			ingredients(
				row('1', 'tsp', 'Salt'),
				heading('  For the   cake '),
				row('1', 'cup', 'Butter'),
				row('2', 'cup', 'Flour'),
				heading('For the glaze'),
				row('1', 'cup', 'Powdered sugar')
			)
		).toEqual([
			ingredient('Salt', 1, 'tsp'),
			ingredient('Butter', 1, 'cup', { section: 'For the cake' }),
			ingredient('Flour', 2, 'cup', { section: 'For the cake' }),
			ingredient('Powdered sugar', 1, 'cup', { section: 'For the glaze' })
		]);
	});

	it('ends a section at a blank heading and drops a heading with no ingredients', () => {
		expect(
			ingredients(
				heading('For the cake'),
				row('1', 'cup', 'Butter'),
				heading(' '),
				row('', '', 'Salt'),
				heading('For the glaze'),
				heading('To serve'),
				row('', '', 'Berries'),
				heading('Nothing here')
			)
		).toEqual([
			ingredient('Butter', 1, 'cup', { section: 'For the cake' }),
			ingredient('Salt'),
			ingredient('Berries', null, null, { section: 'To serve' })
		]);
	});

	it('leaves out rows with nothing typed in them', () => {
		expect(ingredients(row(), row('  ', ' ', '  ', ' '), row('', '', 'Salt'), row())).toEqual([
			ingredient('Salt')
		]);
		expect(ingredients(row())).toEqual([]);
		expect(ingredients()).toEqual([]);
		// A blank row still belongs to its section, so the section doesn't start early.
		expect(ingredients(heading('Sauce'), row(), row('', '', 'Cream'))).toEqual([
			ingredient('Cream', null, null, { section: 'Sauce' })
		]);
	});

	it('numbers rows as the editor does: blank rows count, headings are apart', () => {
		expect(rowProblem(row('1', '', 'Eggs'), row(), heading('Sauce'), row('x', '', 'Flour'))).toBe(
			'Ingredient 3: enter an amount like 1 1/2'
		);
		expect(rowProblem(heading('Cake'), heading(''), heading('a'.repeat(61)))).toBe(
			'Section 3: keep the heading under 60 characters'
		);
		expect(ingredients(heading('a'.repeat(60)), row('', '', 'Salt'))[0]?.section).toBe(
			'a'.repeat(60)
		);
	});

	it('needs an item whenever anything else is typed', () => {
		expect(rowProblem(row('', '', 'Salt'), row('2'))).toBe('Ingredient 2 needs an item');
		expect(rowProblem(row('2', 'cups'))).toBe('Ingredient 1 needs an item');
		expect(rowProblem(row('', '', '', 'diced'))).toBe('Ingredient 1 needs an item');
	});

	it('needs an amount above 0 that it can read', () => {
		for (const amount of ['0', '-1', 'some', '1/0', '1,5', '1 1/2 cups', 'Infinity']) {
			expect(rowProblem(row(amount, '', 'Flour'))).toBe(
				'Ingredient 1: enter an amount like 1 1/2'
			);
		}
	});

	it('points ranges to the prep note', () => {
		const emDash = `2${String.fromCharCode(0x2014)}3`;
		for (const amount of ['2-3', '2 - 3', '2 to 3', '2 or 3', '2–3', emDash, '1/2 to 1', '½-1']) {
			expect(rowProblem(row(amount, 'cloves', 'Garlic'))).toBe(
				'Ingredient 1: enter one amount, and put a range like 2 to 3 in the prep note'
			);
		}
	});

	it('allows amounts up to 10000', () => {
		expect(ingredients(row('10000', 'g', 'Flour'))[0]?.amount).toBe(10_000);
		expect(rowProblem(row('10001', 'g', 'Flour'))).toBe('Ingredient 1: enter a smaller amount');
	});

	it('takes a unit only with an amount', () => {
		expect(rowProblem(row('', 'cup', 'Flour'))).toBe(
			'Ingredient 1: enter an amount, or clear the unit'
		);
	});

	it('limits units to 20 characters, items to 80 and prep notes to 80', () => {
		const ok = ingredients(row('1', 'u'.repeat(20), 'i'.repeat(80), 'p'.repeat(80)));
		expect(ok).toEqual([
			ingredient('i'.repeat(80), 1, 'u'.repeat(20), { prepNote: 'p'.repeat(80) })
		]);
		expect(rowProblem(row('1', 'u'.repeat(21), 'Flour'))).toBe(
			'Ingredient 1: keep the unit under 20 characters'
		);
		expect(rowProblem(row('1', '', 'i'.repeat(81)))).toBe(
			'Ingredient 1: keep the item under 80 characters'
		);
		expect(rowProblem(row('1', '', 'Flour', 'p'.repeat(81)))).toBe(
			'Ingredient 1: keep the prep note under 80 characters'
		);
	});

	it('allows 100 ingredients, not counting blank rows', () => {
		const hundred = Array.from({ length: 100 }, (_, i) => row('1', '', `Item ${i}`));
		expect(ingredients(...hundred, row(), row())).toHaveLength(100);
		expect(rowProblem(...hundred, row('1', '', 'One more'))).toBe('Use 100 ingredients or fewer');
	});

	it("says so when the rows can't be read", () => {
		const rows = (json: string | null) => problemIn(withIngredients(json));
		const message = "The ingredients couldn't be read. Reload the page and try again.";
		expect(rows(null)).toBe(message);
		expect(rows('')).toBe(message);
		expect(rows('not json')).toBe(message);
		expect(rows('{}')).toBe(message);
		expect(rows('[{"kind":"step","text":"Bake"}]')).toBe(message);
		expect(rows('[{"kind":"ingredient","amount":"1","item":"Flour"}]')).toBe(message);
		expect(
			rows('[{"kind":"ingredient","amount":1,"unit":"","item":"Flour","prepNote":""}]')
		).toBe(message);
		expect(rows('[{"kind":"section"}]')).toBe(message);
	});
});

describe('the photo', () => {
	it('is kept as it is when none is sent', () => {
		expect(parse()).toMatchObject({ photo: null, removePhoto: false });
	});

	it('comes as a photo and a thumbnail', () => {
		const photo = jpeg(2000);
		const thumb = jpeg(200);
		const upload = parse({}, { photo, thumb }).photo;
		expect(upload?.photo).toBe(photo);
		expect(upload?.thumb).toBe(thumb);
	});

	it('is none when the files are empty, as an empty file input sends', () => {
		expect(parse({}, { photo: jpeg(0), thumb: jpeg(0) }).photo).toBeNull();
	});

	it('needs both files', () => {
		const message = "The photo couldn't be uploaded. Choose it again.";
		expect(problem({}, { photo: jpeg() })).toBe(message);
		expect(problem({}, { thumb: jpeg() })).toBe(message);
		expect(problem({}, { photo: jpeg(), thumb: jpeg(0) })).toBe(message);
		expect(problem({}, { photo: 'photo.jpg', thumb: jpeg() })).toBe(message);
	});

	it('is checked after the other fields', () => {
		expect(problem({ name: '' }, { photo: jpeg() })).toBe('Enter a recipe name');
	});

	it('can be removed, unless a new one replaces it', () => {
		expect(parse({}, { removePhoto: '1' }).removePhoto).toBe(true);
		expect(parse({}, { removePhoto: '0' }).removePhoto).toBe(false);
		expect(parse({}, { removePhoto: '' }).removePhoto).toBe(false);
		const replaced = parse({}, { photo: jpeg(), thumb: jpeg(), removePhoto: '1' });
		expect(replaced.photo).not.toBeNull();
		expect(replaced.removePhoto).toBe(false);
	});
});

describe('the values the editor starts with', () => {
	const poundCake = recipe('Pound cake', {
		servings: 8,
		prepMinutes: 20,
		cookMinutes: null,
		steps: 'Cream the butter and sugar.\nBake 70 minutes at 325°F.',
		notes: 'Better the next day.',
		source: 'https://example.com/pound-cake',
		calories: 420,
		proteinG: 5.5,
		carbsG: 50,
		fatG: null,
		tags: ['Dessert', 'Baking'],
		ingredients: [
			ingredient('Vanilla', 2, 'tsp'),
			ingredient('Butter', 1, 'cup', { section: 'For the cake', prepNote: 'softened' }),
			ingredient('Flour', 2.25, 'cup', { section: 'For the cake' }),
			ingredient('Sugar', 1 / 3, 'cup', { section: 'For the cake' }),
			ingredient('Salt', null, null, { section: 'For the cake' }),
			ingredient('Lemons', 2, null, { section: 'For the glaze', prepNote: 'juiced' }),
			ingredient('Milk', 0.3, 'fl oz', { section: 'For the glaze' }),
			ingredient('Berries', 1, 'pint'),
			ingredient('Mint', 4, 'sprigs')
		]
	});

	it('start a new recipe blank, at the usual servings', () => {
		expect(newRecipeValues(6)).toEqual({
			name: '',
			servings: '6',
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
		} satisfies RecipeFormValues);
	});

	it('show a saved recipe as it was entered', () => {
		expect(recipeValues(poundCake)).toEqual({
			name: 'Pound cake',
			servings: '8',
			prepMinutes: '20',
			cookMinutes: '',
			tags: 'Dessert, Baking',
			steps: 'Cream the butter and sugar.\nBake 70 minutes at 325°F.',
			notes: 'Better the next day.',
			source: 'https://example.com/pound-cake',
			calories: '420',
			proteinG: '5.5',
			carbsG: '50',
			fatG: '',
			rows: [
				row('2', 'tsp', 'Vanilla'),
				heading('For the cake'),
				row('1', 'cup', 'Butter', 'softened'),
				row('2 1/4', 'cup', 'Flour'),
				row('1/3', 'cup', 'Sugar'),
				row('', '', 'Salt'),
				heading('For the glaze'),
				row('2', '', 'Lemons', 'juiced'),
				row('0.3', 'fl oz', 'Milk'),
				// Back to no section.
				heading(''),
				row('1', 'pint', 'Berries'),
				row('4', 'sprigs', 'Mint')
			]
		} satisfies RecipeFormValues);
	});

	it('read back as the same recipe', () => {
		expect(parse(recipeValues(poundCake)).data).toEqual(poundCake);
		expect(parse(recipeValues(recipe('Toast'))).data).toEqual(recipe('Toast'));
	});

	it('show amounts in full that a fraction or 3 decimals would change', () => {
		const tea = recipe('Tea', {
			ingredients: [ingredient('Sugar', 1 / 6, 'cup'), ingredient('Saffron', 0.0004, 'oz')]
		});
		expect(recipeValues(tea).rows).toEqual([
			row(String(1 / 6), 'cup', 'Sugar'),
			row('0.0004', 'oz', 'Saffron')
		]);
		expect(parse(recipeValues(tea)).data).toEqual(tea);
	});

	describe('with a saved recipe', () => {
		let householdId: number;

		beforeEach(() => {
			freshDb();
			({ householdId } = makeHousehold());
		});

		it('show it as it was entered, and save it unchanged', () => {
			const created = createDish(householdId, parse(recipeValues(poundCake)).data, 0);
			if (created.kind !== 'saved') throw new Error('Expected it to save');
			const shown = recipeValues(getDish(householdId, created.id));
			expect(shown).toEqual(recipeValues(poundCake));

			expect(updateDish(householdId, created.id, parse(shown).data, 1)).toEqual(created);
			expect(recipeValues(getDish(householdId, created.id))).toEqual(shown);
		});
	});
});

describe('nameTakenFailure', () => {
	it('names the recipe that has the name', () => {
		const failure = nameTakenFailure('Pound cake', { archived: false, id: 7 });
		expect(failure.status).toBe(400);
		expect(failure.data).toEqual({
			action: 'recipe',
			error: 'A recipe is already called Pound cake.'
		});
	});

	it('offers to restore an archived recipe with the name', () => {
		const failure = nameTakenFailure('Pound cake', { archived: true, id: 7 });
		expect(failure.status).toBe(400);
		expect(failure.data).toEqual({
			action: 'recipe',
			error: 'An archived recipe is called Pound cake.',
			archivedId: 7
		});
	});
});

describe('saveRecipe', () => {
	let dataDir: string;
	let householdId: number;

	beforeEach(() => {
		freshDb();
		({ householdId } = makeHousehold());
		dataDir = mkdtempSync(join(tmpdir(), 'meals-recipe-form-'));
		loadConfig({
			GOOGLE_CLIENT_ID: 'client-id',
			GOOGLE_CLIENT_SECRET: 'client-secret',
			ADMIN_EMAIL: 'admin@example.com',
			DATA_DIR: dataDir
		});
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
		vi.mocked(setDishPhoto).mockClear();
		vi.mocked(deletePhoto).mockClear();
	});

	function storedFiles(): string[] {
		const dir = join(dataDir, 'photos');
		return existsSync(dir) ? readdirSync(dir).sort() : [];
	}

	function filesFor(key: string): string[] {
		return [`${key}-thumb.jpg`, `${key}.jpg`];
	}

	/** A new photo for the form: a photo and a thumbnail that tell apart from other photos. */
	function newPhoto(fill = 7) {
		return { photo: jpeg(500, fill), thumb: jpeg(50, fill) };
	}

	async function save(
		dishId: number | null,
		values: Partial<RecipeFormValues> = {},
		extra: Record<string, string | File> = {}
	): Promise<number> {
		const result = await saveRecipe(householdId, dishId, formData(values, extra), 1000);
		if ('failure' in result) throw new Error(`Expected it to save: ${result.failure.data.error}`);
		return result.id;
	}

	async function refused(
		dishId: number | null,
		values: Partial<RecipeFormValues> = {},
		extra: Record<string, string | File> = {}
	) {
		const result = await saveRecipe(householdId, dishId, formData(values, extra), 1000);
		if (!('failure' in result)) throw new Error('Expected a failure');
		expect(result.failure.status).toBe(400);
		return result.failure.data;
	}

	async function expectHttpError(saving: Promise<unknown>, status: number) {
		const thrown = await saving.then(
			() => null,
			(e: unknown) => e
		);
		expect(isHttpError(thrown, status), `expected HTTP ${status}, got ${String(thrown)}`).toBe(true);
	}

	it('creates a recipe and returns its id', async () => {
		const id = await save(null, {
			servings: '6',
			tags: 'Dessert',
			rows: [heading('Cake'), row('2', 'cups', 'Flour')]
		});
		expect(getDish(householdId, id)).toMatchObject({
			name: 'Pound cake',
			servings: 6,
			photoKey: null,
			tags: ['Dessert'],
			ingredients: [{ section: 'Cake', amount: 2, unit: 'cup', itemName: 'Flour' }]
		});
	});

	it('saves over an existing recipe', async () => {
		const id = makeDish(householdId, recipe('Pound cake', { tags: ['Dessert'] }));
		expect(await save(id, { name: 'Lemon pound cake', servings: '10', tags: '' })).toBe(id);
		expect(getDish(householdId, id)).toMatchObject({
			name: 'Lemon pound cake',
			servings: 10,
			tags: []
		});
	});

	it('refuses a name another recipe has, changing nothing and keeping no photo', async () => {
		makeDish(householdId, recipe('Pound cake'));
		const id = makeDish(householdId, recipe('Toast'));

		expect(await refused(null, {}, newPhoto())).toEqual({
			action: 'recipe',
			error: 'A recipe is already called Pound cake.'
		});
		expect(await refused(id, { name: 'pound CAKE' }, newPhoto())).toEqual({
			action: 'recipe',
			error: 'A recipe is already called pound CAKE.'
		});
		expect(getDish(householdId, id)).toMatchObject({ name: 'Toast', photoKey: null });
		expect(listDishes(householdId, { search: '', tag: null, archived: false })).toHaveLength(2);
		expect(storedFiles()).toEqual([]);
	});

	it('offers to restore an archived recipe that has the name', async () => {
		const archived = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, archived, true, 0);
		expect(await refused(null)).toEqual({
			action: 'recipe',
			error: 'An archived recipe is called Pound cake.',
			archivedId: archived
		});
	});

	it('checks the form before storing anything', async () => {
		expect(await refused(null, { name: '' }, newPhoto())).toEqual({
			action: 'recipe',
			error: 'Enter a recipe name'
		});
		expect(storedFiles()).toEqual([]);
	});

	it('stores a new photo with a new recipe', async () => {
		const { photo, thumb } = newPhoto(1);
		const id = await save(null, {}, { photo, thumb });

		const key = getDish(householdId, id).photoKey;
		expect(key).toMatch(/^[0-9a-f]{32}$/);
		if (key === null) return;
		expect(storedFiles()).toEqual(filesFor(key));
		expect(readFileSync(photoPath(key, 'full'))).toEqual(Buffer.from(await photo.arrayBuffer()));
		expect(readFileSync(photoPath(key, 'thumb'))).toEqual(Buffer.from(await thumb.arrayBuffer()));
	});

	it('replaces a photo and deletes the old one', async () => {
		const id = await save(null, {}, newPhoto(1));
		const oldKey = getDish(householdId, id).photoKey;

		await save(id, {}, newPhoto(2));
		const newKey = getDish(householdId, id).photoKey;
		expect(newKey).not.toBeNull();
		expect(newKey).not.toBe(oldKey);
		if (newKey === null) return;
		expect(storedFiles()).toEqual(filesFor(newKey));
	});

	it('keeps the photo when none is sent', async () => {
		const id = await save(null, {}, newPhoto());
		const key = getDish(householdId, id).photoKey;

		await save(id, { name: 'Lemon pound cake' });
		expect(getDish(householdId, id).photoKey).toBe(key);
		expect(storedFiles()).toHaveLength(2);
		expect(setDishPhoto).toHaveBeenCalledTimes(1);
	});

	it('removes the photo and its files', async () => {
		const id = await save(null, {}, newPhoto());

		await save(id, {}, { removePhoto: '1' });
		expect(getDish(householdId, id).photoKey).toBeNull();
		expect(storedFiles()).toEqual([]);
	});

	it("refuses a photo that isn't a JPEG or is too large, saving nothing", async () => {
		const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png');
		expect(await refused(null, {}, { photo: png, thumb: jpeg() })).toEqual({
			action: 'recipe',
			error: 'The photo must be a JPEG.'
		});
		expect(await refused(null, {}, { photo: jpeg(PHOTO_MAX_BYTES + 1), thumb: jpeg() })).toEqual({
			action: 'recipe',
			error: 'That photo is too large. Try another one.'
		});
		expect(await refused(null, {}, { photo: jpeg(), thumb: jpeg(THUMB_MAX_BYTES + 1) })).toEqual({
			action: 'recipe',
			error: 'That photo is too large. Try another one.'
		});

		const id = makeDish(householdId, recipe('Toast'));
		await refused(id, { name: 'French toast' }, { photo: png, thumb: jpeg() });
		expect(getDish(householdId, id).name).toBe('Toast');
		expect(listDishes(householdId, { search: '', tag: null, archived: false })).toHaveLength(1);
		expect(storedFiles()).toEqual([]);
	});

	it("is not found for another household's recipe, and keeps no photo", async () => {
		const other = makeHousehold().householdId;
		const id = makeDish(other, recipe('Toast'));

		await expectHttpError(saveRecipe(householdId, id, formData({}, newPhoto()), 1000), 404);
		expect(getDish(other, id)).toMatchObject({ name: 'Toast', photoKey: null });
		expect(storedFiles()).toEqual([]);
	});

	it("deletes the new photo when it can't be set, keeping the old one", async () => {
		const id = await save(null, {}, newPhoto(1));
		const oldKey = getDish(householdId, id).photoKey;
		if (oldKey === null) throw new Error('Expected a photo');

		vi.mocked(setDishPhoto).mockImplementationOnce(() => {
			throw new Error('disk I/O error');
		});
		await expect(saveRecipe(householdId, id, formData({}, newPhoto(2)), 1000)).rejects.toThrow(
			'disk I/O error'
		);
		expect(getDish(householdId, id).photoKey).toBe(oldKey);
		expect(storedFiles()).toEqual(filesFor(oldKey));
	});

	it("still saves when the old photo's files can't be deleted", async () => {
		const id = await save(null, {}, newPhoto(1));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(deletePhoto).mockImplementationOnce(() => {
			throw new Error('permission denied');
		});
		try {
			expect(await save(id, {}, { removePhoto: '1' })).toBe(id);
			expect(getDish(householdId, id).photoKey).toBeNull();
			expect(logged).toHaveBeenCalledOnce();
		} finally {
			logged.mockRestore();
		}
	});
});
