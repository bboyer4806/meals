import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { dishes, dishIngredients, dishTags, items } from '../db/schema.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDish,
	makeHousehold,
	recipe
} from '../testing.ts';
import {
	createDish,
	getDish,
	listDishes,
	listDishTags,
	setDishArchived,
	setDishPhoto,
	updateDish,
	type DishSummary
} from './dishes.ts';
import { createItem, findItemByName, listCatalog, setItemArchived } from './items.ts';

// Sat 2026-10-03 12:00 in Chicago.
const NOW = Date.UTC(2026, 9, 3, 17, 0);
const LATER = NOW + 60 * 60 * 1000;
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

let householdId: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
});

function list(filter: Partial<{ search: string; tag: string | null; archived: boolean }> = {}) {
	return listDishes(householdId, { search: '', tag: null, archived: false, ...filter });
}

function names(filter: Parameters<typeof list>[0] = {}) {
	return list(filter).map((dish) => dish.name);
}

function catalog() {
	return listCatalog(householdId, false, '').map((item) => item.name);
}

function timestamps(dishId: number) {
	const row = db().select().from(dishes).where(eq(dishes.id, dishId)).get();
	return [row?.createdAt, row?.updatedAt];
}

describe('saving', () => {
	it('saves every field, with its tags and its ingredients in order', () => {
		const id = makeDish(
			householdId,
			recipe('Pound cake', {
				servings: 8,
				prepMinutes: 20,
				cookMinutes: 70,
				steps: 'Cream the butter and sugar.\nBake 70 minutes at 325°F.',
				notes: 'Better the next day.',
				source: 'https://example.com/pound-cake',
				calories: 420,
				proteinG: 5.5,
				carbsG: 50,
				fatG: 22,
				tags: ['Dessert', 'Baking'],
				ingredients: [
					ingredient('Butter', 1, 'cup', { section: 'For the cake', prepNote: 'softened' }),
					ingredient('Flour', 2.25, 'cup', { section: 'For the cake' }),
					ingredient('Salt', null, null, { section: 'For the cake' }),
					ingredient('Powdered sugar', 1, 'cup', { section: 'For the glaze' }),
					ingredient('Lemons', 2, null, { section: 'For the glaze', prepNote: 'juiced' })
				]
			}),
			NOW
		);
		const row = (position: number, itemName: string) => ({
			id: expect.any(Number),
			position,
			itemId: findItemByName(householdId, itemName)?.id,
			itemName
		});
		expect(getDish(householdId, id)).toEqual({
			id,
			name: 'Pound cake',
			servings: 8,
			prepMinutes: 20,
			cookMinutes: 70,
			steps: 'Cream the butter and sugar.\nBake 70 minutes at 325°F.',
			notes: 'Better the next day.',
			source: 'https://example.com/pound-cake',
			photoKey: null,
			calories: 420,
			proteinG: 5.5,
			carbsG: 50,
			fatG: 22,
			archivedAt: null,
			tags: ['Dessert', 'Baking'],
			ingredients: [
				{ ...row(0, 'Butter'), section: 'For the cake', amount: 1, unit: 'cup', prepNote: 'softened' },
				{ ...row(1, 'Flour'), section: 'For the cake', amount: 2.25, unit: 'cup', prepNote: null },
				{ ...row(2, 'Salt'), section: 'For the cake', amount: null, unit: null, prepNote: null },
				{ ...row(3, 'Powdered sugar'), section: 'For the glaze', amount: 1, unit: 'cup', prepNote: null },
				{ ...row(4, 'Lemons'), section: 'For the glaze', amount: 2, unit: null, prepNote: 'juiced' }
			]
		});
		expect(timestamps(id)).toEqual([NOW, NOW]);
	});

	it('adds new ingredient names to the catalog and reuses existing items, ignoring case (Q1)', () => {
		const flour = createItem(householdId, 'Flour', NOW).id;
		const id = makeDish(
			householdId,
			recipe('Bread', {
				ingredients: [ingredient('FLOUR', 3, 'cup'), ingredient('  Active   dry yeast ', 1, 'tsp')]
			})
		);
		const [first, second] = getDish(householdId, id).ingredients;
		expect(first).toMatchObject({ itemId: flour, itemName: 'Flour' });
		expect(second?.itemName).toBe('Active dry yeast');
		expect(catalog()).toEqual(['Active dry yeast', 'Flour']);
	});

	it('matches ingredient names ignoring case beyond A to Z', () => {
		const id = makeDish(
			householdId,
			recipe('Mole', {
				ingredients: [ingredient('Jalapeños', 2), ingredient('JALAPEÑOS', 1, 'tbsp')]
			})
		);
		const [fresh, pickled] = getDish(householdId, id).ingredients;
		expect(pickled?.itemId).toBe(fresh?.itemId);
		expect(catalog()).toEqual(['Jalapeños']);
	});

	it('uses one item for a name that appears twice in a recipe', () => {
		const id = makeDish(
			householdId,
			recipe('Layer cake', {
				ingredients: [
					ingredient('Butter', 1, 'cup', { section: 'Cake' }),
					ingredient('butter', 2, 'tbsp', { section: 'Frosting' })
				]
			})
		);
		const [cake, frosting] = getDish(householdId, id).ingredients;
		expect(frosting?.itemId).toBe(cake?.itemId);
		expect(catalog()).toEqual(['Butter']);
	});

	it('restores an archived item that a recipe uses', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		const id = makeDish(householdId, recipe('Soup', { ingredients: [ingredient('salt')] }));
		expect(getDish(householdId, id).ingredients[0]?.itemId).toBe(salt);
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBeNull();
	});

	it('keeps each tag once, ignoring case, with its first spelling', () => {
		const id = makeDish(
			householdId,
			recipe('Chili', { tags: ['Quick', 'Spicy', 'QUICK', 'spicy', 'Crème', 'CRÈME'] })
		);
		expect(getDish(householdId, id).tags).toEqual(['Quick', 'Spicy', 'Crème']);
	});

	it('replaces everything when a recipe is updated', () => {
		const id = makeDish(
			householdId,
			recipe('Chili', {
				servings: 4,
				prepMinutes: 15,
				notes: 'Freezes well.',
				calories: 500,
				tags: ['Quick', 'Spicy'],
				ingredients: [
					ingredient('Beans', 2, 'can'),
					ingredient('Onion', 1, null, { prepNote: 'diced' }),
					ingredient('Beef', 1, 'lb')
				]
			}),
			NOW
		);
		const changed = recipe('Turkey chili', {
			servings: 6,
			cookMinutes: 45,
			tags: ['Spicy', 'Healthy'],
			ingredients: [
				ingredient('Turkey', 1.5, 'lb'),
				ingredient('Beans', 2, 'can', { section: 'From the pantry' })
			]
		});
		expect(updateDish(householdId, id, changed, LATER)).toEqual({ kind: 'saved', id });

		const dish = getDish(householdId, id);
		expect(dish).toMatchObject({
			name: 'Turkey chili',
			servings: 6,
			prepMinutes: null,
			cookMinutes: 45,
			notes: null,
			calories: null,
			tags: ['Spicy', 'Healthy']
		});
		expect(dish.ingredients.map((i) => [i.position, i.itemName, i.amount, i.unit, i.section])).toEqual([
			[0, 'Turkey', 1.5, 'lb', null],
			[1, 'Beans', 2, 'can', 'From the pantry']
		]);
		expect(db().select().from(dishIngredients).all()).toHaveLength(2);
		expect(db().select().from(dishTags).all()).toHaveLength(2);
		// Items the recipe no longer uses stay in the catalog.
		expect(catalog()).toEqual(['Beans', 'Beef', 'Onion', 'Turkey']);
		expect(timestamps(id)).toEqual([NOW, LATER]);
	});

	it('saves only the recipe fields, never a photo or archive time sent along with them', () => {
		const id = makeDish(householdId, recipe('Toast', { ingredients: [ingredient('Bread', 2)] }));
		setDishPhoto(householdId, id, KEY_A, NOW);
		// A recipe as loaded, sent back whole with other values.
		const sent = { ...getDish(householdId, id), photoKey: KEY_B, archivedAt: NOW, servings: 2 };
		expect(updateDish(householdId, id, sent, LATER)).toEqual({ kind: 'saved', id });
		expect(getDish(householdId, id)).toMatchObject({
			servings: 2,
			photoKey: KEY_A,
			archivedAt: null,
			ingredients: [{ position: 0, itemName: 'Bread', amount: 2 }]
		});
	});
});

describe('names', () => {
	it('refuses a name another dish has, ignoring case, and says which dish has it', () => {
		const cake = makeDish(householdId, recipe('Pound cake'));
		expect(createDish(householdId, recipe('POUND CAKE'), NOW)).toEqual({
			kind: 'taken',
			archived: false,
			id: cake
		});
		const pie = makeDish(householdId, recipe('Apple pie'));
		expect(updateDish(householdId, pie, recipe('pound cake'), NOW)).toEqual({
			kind: 'taken',
			archived: false,
			id: cake
		});
		expect(getDish(householdId, pie).name).toBe('Apple pie');
	});

	it('matches names ignoring case beyond A to Z', () => {
		const brulee = makeDish(householdId, recipe('Crème brûlée'));
		expect(createDish(householdId, recipe('CRÈME BRÛLÉE'), NOW)).toMatchObject({
			kind: 'taken',
			id: brulee
		});
	});

	it('counts archived dishes, so the page can offer to restore one (design 6.10)', () => {
		const cake = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, cake, true, NOW);
		expect(createDish(householdId, recipe('pound cake'), NOW)).toEqual({
			kind: 'taken',
			archived: true,
			id: cake
		});
	});

	it('lets a dish keep its name or change its case', () => {
		const cake = makeDish(householdId, recipe('Pound cake'));
		expect(updateDish(householdId, cake, recipe('Pound cake', { servings: 6 }), NOW)).toEqual({
			kind: 'saved',
			id: cake
		});
		expect(updateDish(householdId, cake, recipe('Pound Cake'), NOW)).toEqual({
			kind: 'saved',
			id: cake
		});
		expect(getDish(householdId, cake).name).toBe('Pound Cake');
	});

	it('writes nothing when the name is taken', () => {
		makeDish(householdId, recipe('Pound cake'));
		const copy = recipe('pound cake', {
			tags: ['Dessert'],
			ingredients: [ingredient('Butter', 1, 'cup')]
		});
		expect(createDish(householdId, copy, NOW)).toMatchObject({ kind: 'taken' });
		expect(db().select().from(dishes).all()).toHaveLength(1);
		expect(db().select().from(dishTags).all()).toHaveLength(0);
		expect(db().select().from(items).all()).toHaveLength(0);
	});

	it('lets another household use the same name', () => {
		makeDish(householdId, recipe('Pound cake'));
		const other = makeHousehold();
		expect(createDish(other.householdId, recipe('Pound cake'), NOW)).toMatchObject({
			kind: 'saved'
		});
	});
});

describe('failed saves', () => {
	it('rolls back a new recipe that fails partway', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		// A unit without an amount breaks a database rule only after the dish, its tags and the
		// items for the earlier rows are written.
		const broken = recipe('Soup', {
			tags: ['Easy'],
			ingredients: [ingredient('Salt'), ingredient('Leeks', 2), ingredient('Stock', null, 'cup')]
		});
		expect(() => createDish(householdId, broken, NOW)).toThrow(/CHECK constraint failed/);
		expect(db().select().from(dishes).all()).toHaveLength(0);
		expect(db().select().from(dishTags).all()).toHaveLength(0);
		expect(findItemByName(householdId, 'Leeks')).toBeUndefined();
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);
	});

	it('keeps the saved recipe when an update fails partway', () => {
		const id = makeDish(
			householdId,
			recipe('Soup', { tags: ['Easy'], ingredients: [ingredient('Leeks', 2)] }),
			NOW
		);
		const broken = recipe('Leek soup', {
			tags: ['Hard'],
			ingredients: [ingredient('Potatoes', 3), ingredient('Stock', 0, 'cup')]
		});
		expect(() => updateDish(householdId, id, broken, LATER)).toThrow(/CHECK constraint failed/);
		const dish = getDish(householdId, id);
		expect(dish).toMatchObject({ name: 'Soup', tags: ['Easy'] });
		expect(dish.ingredients.map((i) => i.itemName)).toEqual(['Leeks']);
		expect(findItemByName(householdId, 'Potatoes')).toBeUndefined();
		expect(timestamps(id)).toEqual([NOW, NOW]);
	});
});

describe('archiving and photos', () => {
	it('archives and restores a dish (design 6.10)', () => {
		const id = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, id, true, NOW);
		expect(getDish(householdId, id).archivedAt).toBe(NOW);
		expect(names()).toEqual([]);
		expect(names({ archived: true })).toEqual(['Pound cake']);
		setDishArchived(householdId, id, false, LATER);
		expect(getDish(householdId, id).archivedAt).toBeNull();
		expect(names()).toEqual(['Pound cake']);
	});

	it('keeps showing an ingredient whose item was archived later', () => {
		const id = makeDish(householdId, recipe('Toast', { ingredients: [ingredient('Bread', 2)] }));
		setItemArchived(householdId, findItemByName(householdId, 'Bread')!.id, true, NOW);
		expect(getDish(householdId, id).ingredients[0]?.itemName).toBe('Bread');
	});

	it('sets, replaces and clears the photo, returning the key whose files can go', () => {
		const id = makeDish(householdId, recipe('Pound cake'), NOW);
		expect(setDishPhoto(householdId, id, KEY_A, NOW)).toBeNull();
		expect(setDishPhoto(householdId, id, KEY_B, LATER)).toBe(KEY_A);
		expect(getDish(householdId, id).photoKey).toBe(KEY_B);
		// The same key again leaves nothing to delete.
		expect(setDishPhoto(householdId, id, KEY_B, LATER)).toBeNull();
		expect(setDishPhoto(householdId, id, null, LATER)).toBe(KEY_B);
		expect(getDish(householdId, id).photoKey).toBeNull();
		expect(timestamps(id)).toEqual([NOW, LATER]);
	});
});

describe('listing', () => {
	it('sorts by name and searches anywhere in it, ignoring case', () => {
		for (const name of ['pound cake', 'Apple pie', 'Carrot cake', 'Éclairs']) {
			makeDish(householdId, recipe(name));
		}
		expect(names({ search: 'CAKE' })).toEqual(['Carrot cake', 'pound cake']);
		expect(names({ search: 'ple p' })).toEqual(['Apple pie']);
		expect(names({ search: 'éclair' })).toEqual(['Éclairs']);
		expect(names({ search: 'pie', archived: true })).toEqual([]);
		makeDish(householdId, recipe('Banana bread'));
		expect(names({ search: 'a' })).toEqual([
			'Apple pie',
			'Banana bread',
			'Carrot cake',
			'Éclairs',
			'pound cake'
		]);
	});

	it('filters by tag, ignoring case', () => {
		makeDish(householdId, recipe('Chili', { tags: ['Quick', 'Spicy'] }));
		makeDish(householdId, recipe('Salad', { tags: ['quick'] }));
		const roast = makeDish(householdId, recipe('Roast', { tags: ['QUICK'] }));
		setDishArchived(householdId, roast, true, NOW);
		makeDish(householdId, recipe('Stew'));
		expect(names({ tag: 'QUICK' })).toEqual(['Chili', 'Salad']);
		expect(names({ tag: 'quick', archived: true })).toEqual(['Roast']);
		expect(names({ tag: 'Quick', search: 'sal' })).toEqual(['Salad']);
		expect(names({ tag: 'Sweet' })).toEqual([]);
	});

	it('gives each row its photo, times and tags', () => {
		const id = makeDish(
			householdId,
			recipe('Chili', { prepMinutes: 15, cookMinutes: 60, tags: ['Spicy', 'Quick'] })
		);
		setDishPhoto(householdId, id, KEY_A, NOW);
		expect(list()).toEqual([
			{
				id,
				name: 'Chili',
				photoKey: KEY_A,
				prepMinutes: 15,
				cookMinutes: 60,
				archivedAt: null,
				tags: ['Spicy', 'Quick'],
				hasRecipe: false
			} satisfies DishSummary
		]);
	});

	it('says which dishes have no recipe: no ingredients and no steps (change 2.1.1)', () => {
		makeDish(householdId, recipe('Rolls'));
		makeDish(householdId, recipe('Toast', { steps: ' \n\t\r\n ', notes: 'Notes are not a recipe.' }));
		makeDish(householdId, recipe('Salad', { ingredients: [ingredient('Lettuce')] }));
		makeDish(householdId, recipe('Tea', { steps: 'Steep 3 minutes.' }));
		expect(list().map((dish) => [dish.name, dish.hasRecipe])).toEqual([
			['Rolls', false],
			['Salad', true],
			['Tea', true],
			['Toast', false]
		]);
	});

	it('lists the tags on active dishes once each, sorted, in the oldest spelling', () => {
		const chili = makeDish(householdId, recipe('Chili', { tags: ['Spicy', 'quick'] }));
		makeDish(householdId, recipe('Salad', { tags: ['Quick', 'Vegetarian'] }));
		const roast = makeDish(householdId, recipe('Roast', { tags: ['Sunday'] }));
		setDishArchived(householdId, roast, true, NOW);
		expect(listDishTags(householdId)).toEqual(['quick', 'Spicy', 'Vegetarian']);
		// Saving the older dish again keeps its spelling first.
		updateDish(householdId, chili, recipe('Chili', { tags: ['Spicy', 'quick'] }), LATER);
		expect(listDishTags(householdId)).toEqual(['quick', 'Spicy', 'Vegetarian']);
	});
});

describe('households', () => {
	it("never shows or changes another household's dishes", () => {
		const id = makeDish(householdId, recipe('Pound cake', { tags: ['Dessert'] }));
		const other = makeHousehold();
		expect(listDishes(other.householdId, { search: '', tag: null, archived: false })).toEqual([]);
		expect(listDishTags(other.householdId)).toEqual([]);
		expectHttpError(() => getDish(other.householdId, id), 404);
		expectHttpError(() => updateDish(other.householdId, id, recipe('Mine now'), NOW), 404);
		expectHttpError(() => setDishArchived(other.householdId, id, true, NOW), 404);
		expectHttpError(() => setDishPhoto(other.householdId, id, KEY_A, NOW), 404);
		expect(getDish(householdId, id)).toMatchObject({
			name: 'Pound cake',
			archivedAt: null,
			photoKey: null
		});
		expectHttpError(() => getDish(householdId, id + 1000), 404);
	});

	it("uses the household's own items, never another household's", () => {
		const other = makeHousehold();
		const theirs = createItem(other.householdId, 'Butter', NOW).id;
		const shortbread = recipe('Shortbread', { ingredients: [ingredient('butter', 1, 'cup')] });
		const id = makeDish(householdId, shortbread);
		const butter = getDish(householdId, id).ingredients[0];
		expect(butter?.itemId).not.toBe(theirs);
		expect(butter?.itemId).toBe(findItemByName(householdId, 'butter')?.id);
	});

	it('rejects rows that point at another household in the database itself', () => {
		const id = makeDish(householdId, recipe('Pound cake'));
		const other = makeHousehold();
		const theirItem = createItem(other.householdId, 'Butter', NOW).id;
		// This household's recipe using their item.
		expect(() =>
			db()
				.insert(dishIngredients)
				.values({ householdId, dishId: id, position: 0, itemId: theirItem })
				.run()
		).toThrow(/FOREIGN KEY/);
		// Their ingredient or tag on this household's recipe.
		expect(() =>
			db()
				.insert(dishIngredients)
				.values({ householdId: other.householdId, dishId: id, position: 0, itemId: theirItem })
				.run()
		).toThrow(/FOREIGN KEY/);
		expect(() =>
			db().insert(dishTags).values({ householdId: other.householdId, dishId: id, tag: 'Mine' }).run()
		).toThrow(/FOREIGN KEY/);
	});
});
