import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { dishes, dishIngredients, dishRatings, dishTags, items, users } from '../db/schema.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDinner,
	makeDish,
	makeHousehold,
	recipe
} from '../testing.ts';
import {
	addDinnerDish,
	clearDinner,
	getDay,
	moveDinners,
	removeDinnerDish,
	saveDinner
} from './dinners.ts';
import {
	createDish,
	dishesByName,
	findDishByName,
	getDish,
	getOwnRating,
	groupDishesByLastMade,
	importDishes,
	listDishes,
	listDishRatings,
	listDishTags,
	rateDish,
	setDishArchived,
	setDishTried,
	updateDish,
	type DishSummary,
	type PhotoChange
} from './dishes.ts';
import { removeMember } from './households.ts';
import {
	createItem,
	findItemByName,
	itemsByName,
	listCatalog,
	setItemArchived
} from './items.ts';

// Sat 2026-10-03 12:00 in Chicago.
const NOW = Date.UTC(2026, 9, 3, 17, 0);
const LATER = NOW + 60 * 60 * 1000;
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
});

function list(filter: Partial<Parameters<typeof listDishes>[1]> = {}) {
	return listDishes(householdId, {
		search: '',
		tags: [],
		archived: false,
		sort: 'name',
		...filter
	});
}

function names(filter: Parameters<typeof list>[0] = {}) {
	return list(filter).map((dish) => dish.name);
}

function catalog() {
	return listCatalog(householdId, false, '').map((item) => item.name);
}

/** A person's name, as a recipe's list of ratings shows it. */
function nameOf(id: number): string | undefined {
	return db().select({ name: users.name }).from(users).where(eq(users.id, id)).get()?.name;
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
			tried: false,
			archivedAt: null,
			rating: null,
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

	it('asks before restoring archived items a recipe would start using, changing nothing (6.10)', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		const pepper = createItem(householdId, 'Pepper', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		setItemArchived(householdId, pepper, true, NOW);
		const soup = recipe('Soup', {
			tags: ['Easy'],
			ingredients: [
				ingredient('pepper'),
				ingredient('Leeks', 2),
				ingredient('SALT'),
				ingredient('Pepper', 1, 'tsp')
			]
		});
		// With their stored names, in the order of the ingredients, each once.
		expect(createDish(householdId, soup, null, [], NOW)).toEqual({
			kind: 'archived',
			items: [
				{ id: pepper, name: 'Pepper' },
				{ id: salt, name: 'Salt' }
			]
		});
		expect(db().select().from(dishes).all()).toHaveLength(0);
		expect(db().select().from(dishTags).all()).toHaveLength(0);
		expect(findItemByName(householdId, 'Leeks')).toBeUndefined();
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);
		expect(findItemByName(householdId, 'Pepper')?.archivedAt).toBe(NOW);

		const beef = ingredient('Beef', 1, 'lb');
		const id = makeDish(householdId, recipe('Stew', { ingredients: [beef] }), NOW);
		const stew = recipe('Beef stew', { ingredients: [beef, ingredient('Salt')] });
		expect(updateDish(householdId, id, stew, 'keep', [], LATER)).toEqual({
			kind: 'archived',
			items: [{ id: salt, name: 'Salt' }]
		});
		expect(getDish(householdId, id)).toMatchObject({
			name: 'Stew',
			ingredients: [{ itemName: 'Beef' }]
		});
		expect(timestamps(id)).toEqual([NOW, NOW]);
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);

		// A name that's taken is still the first thing it says.
		const copy = recipe('stew', { ingredients: [ingredient('Salt')] });
		expect(createDish(householdId, copy, null, [], NOW)).toMatchObject({ kind: 'taken', id });
	});

	it('restores archived items a recipe would start using when allowed to (6.10)', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		const soup = recipe('Soup', { ingredients: [ingredient('salt')] });
		const created = createDish(householdId, soup, null, [salt], NOW);
		if (created.kind !== 'saved') throw new Error('Expected it to save');
		expect(getDish(householdId, created.id).ingredients[0]?.itemId).toBe(salt);
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBeNull();

		const beef = ingredient('Beef', 1, 'lb');
		const id = makeDish(householdId, recipe('Stew', { ingredients: [beef] }), NOW);
		setItemArchived(householdId, salt, true, NOW);
		const stew = recipe('Stew', { ingredients: [beef, ingredient('Salt')] });
		expect(updateDish(householdId, id, stew, 'keep', [salt], LATER)).toEqual({
			kind: 'saved',
			id,
			replacedPhotoKey: null
		});
		expect(getDish(householdId, id).ingredients.map((i) => i.itemName)).toEqual(['Beef', 'Salt']);
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBeNull();
	});

	it('asks again, naming them all, when allowed to restore only some archived items (6.10)', () => {
		const cardamom = createItem(householdId, 'Cardamom', NOW).id;
		const nutmeg = createItem(householdId, 'Nutmeg', NOW).id;
		const cumin = createItem(householdId, 'Cumin', NOW).id;
		for (const item of [cardamom, nutmeg, cumin]) setItemArchived(householdId, item, true, NOW);
		const chai = recipe('Chai', { ingredients: [ingredient('Cardamom', 4), ingredient('Nutmeg')] });
		expect(createDish(householdId, chai, null, [cardamom], NOW)).toEqual({
			kind: 'archived',
			items: [
				{ id: cardamom, name: 'Cardamom' },
				{ id: nutmeg, name: 'Nutmeg' }
			]
		});
		expect(db().select().from(dishes).all()).toHaveLength(0);
		expect(findItemByName(householdId, 'Cardamom')?.archivedAt).toBe(NOW);
		expect(findItemByName(householdId, 'Nutmeg')?.archivedAt).toBe(NOW);

		// Cumin isn't in the recipe, so allowing it changes nothing.
		const created = createDish(householdId, chai, null, [nutmeg, cumin, cardamom], LATER);
		if (created.kind !== 'saved') throw new Error('Expected it to save');
		expect(getDish(householdId, created.id).ingredients.map((i) => i.itemId)).toEqual([
			cardamom,
			nutmeg
		]);
		expect(findItemByName(householdId, 'Cardamom')?.archivedAt).toBeNull();
		expect(findItemByName(householdId, 'Nutmeg')?.archivedAt).toBeNull();
		expect(findItemByName(householdId, 'Cumin')?.archivedAt).toBe(NOW);
	});

	it('leaves an item archived when a recipe that already used it is saved again (6.10)', () => {
		const soup = recipe('Soup', { ingredients: [ingredient('Salt'), ingredient('Pepper')] });
		const id = makeDish(householdId, soup);
		const salt = findItemByName(householdId, 'Salt')!.id;
		setItemArchived(householdId, salt, true, NOW);
		// Saved without asking, and left archived even when restoring is allowed.
		expect(updateDish(householdId, id, { ...soup, servings: 6 }, 'keep', [], LATER)).toEqual({
			kind: 'saved',
			id,
			replacedPhotoKey: null
		});
		expect(updateDish(householdId, id, { ...soup, servings: 8 }, 'keep', [salt], LATER)).toEqual({
			kind: 'saved',
			id,
			replacedPhotoKey: null
		});
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);
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
		expect(updateDish(householdId, id, changed, 'keep', [], LATER)).toEqual({
			kind: 'saved',
			id,
			replacedPhotoKey: null
		});

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
		const toast = recipe('Toast', { ingredients: [ingredient('Bread', 2)] });
		const id = makeDish(householdId, toast, NOW, KEY_A);
		// A recipe as loaded, sent back whole with other values.
		const sent = { ...getDish(householdId, id), photoKey: KEY_B, archivedAt: NOW, servings: 2 };
		expect(updateDish(householdId, id, sent, 'keep', [], LATER)).toEqual({
			kind: 'saved',
			id,
			replacedPhotoKey: null
		});
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
		expect(createDish(householdId, recipe('POUND CAKE'), null, [], NOW)).toEqual({
			kind: 'taken',
			archived: false,
			id: cake
		});
		const pie = makeDish(householdId, recipe('Apple pie'));
		expect(updateDish(householdId, pie, recipe('pound cake'), 'keep', [], NOW)).toEqual({
			kind: 'taken',
			archived: false,
			id: cake
		});
		expect(getDish(householdId, pie).name).toBe('Apple pie');
	});

	it('matches names ignoring case beyond A to Z', () => {
		const brulee = makeDish(householdId, recipe('Crème brûlée'));
		expect(createDish(householdId, recipe('CRÈME BRÛLÉE'), null, [], NOW)).toMatchObject({
			kind: 'taken',
			id: brulee
		});
	});

	it('counts archived dishes, so the page can offer to restore one (design 6.10)', () => {
		const cake = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, cake, true, NOW);
		expect(createDish(householdId, recipe('pound cake'), null, [], NOW)).toEqual({
			kind: 'taken',
			archived: true,
			id: cake
		});
	});

	it('lets a dish keep its name or change its case', () => {
		const cake = makeDish(householdId, recipe('Pound cake'));
		expect(
			updateDish(householdId, cake, recipe('Pound cake', { servings: 6 }), 'keep', [], NOW)
		).toEqual({ kind: 'saved', id: cake, replacedPhotoKey: null });
		expect(updateDish(householdId, cake, recipe('Pound Cake'), 'keep', [], NOW)).toEqual({
			kind: 'saved',
			id: cake,
			replacedPhotoKey: null
		});
		expect(getDish(householdId, cake).name).toBe('Pound Cake');
	});

	it('writes nothing when the name is taken', () => {
		makeDish(householdId, recipe('Pound cake'));
		const copy = recipe('pound cake', {
			tags: ['Dessert'],
			ingredients: [ingredient('Butter', 1, 'cup')]
		});
		expect(createDish(householdId, copy, null, [], NOW)).toMatchObject({ kind: 'taken' });
		expect(db().select().from(dishes).all()).toHaveLength(1);
		expect(db().select().from(dishTags).all()).toHaveLength(0);
		expect(db().select().from(items).all()).toHaveLength(0);
	});

	it('lets another household use the same name', () => {
		makeDish(householdId, recipe('Pound cake'));
		const other = makeHousehold();
		expect(createDish(other.householdId, recipe('Pound cake'), null, [], NOW)).toMatchObject({
			kind: 'saved'
		});
	});

	it('looks up many names at once as findDishByName does, archived ones included (MEA-89)', () => {
		const brulee = makeDish(householdId, recipe('Crème brûlée'));
		const cake = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, cake, true, NOW);
		makeDish(makeHousehold().householdId, recipe('Toast'));
		const byName = dishesByName(householdId);
		expect(byName.size).toBe(2);
		expect(byName.get('crème brûlée')).toEqual({
			id: brulee,
			name: 'Crème brûlée',
			archivedAt: null
		});
		expect(byName.get('pound cake')).toEqual(findDishByName(householdId, 'POUND CAKE'));
	});
});

describe('failed saves', () => {
	it('rolls back a new recipe that fails partway', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		// A unit without an amount breaks a database rule only after the dish with its photo, its
		// tags and the items for the earlier rows are written, and Salt is restored, as allowed.
		const broken = recipe('Soup', {
			tags: ['Easy'],
			ingredients: [ingredient('Salt'), ingredient('Leeks', 2), ingredient('Stock', null, 'cup')]
		});
		expect(() => createDish(householdId, broken, KEY_A, [salt], NOW)).toThrow(
			/CHECK constraint failed/
		);
		expect(db().select().from(dishes).all()).toHaveLength(0);
		expect(db().select().from(dishTags).all()).toHaveLength(0);
		expect(findItemByName(householdId, 'Leeks')).toBeUndefined();
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);
	});

	it('keeps the saved recipe and its photo when an update fails partway (MEA-87)', () => {
		const id = makeDish(
			householdId,
			recipe('Soup', { tags: ['Easy'], ingredients: [ingredient('Leeks', 2)] }),
			NOW,
			KEY_A
		);
		// An amount of 0 breaks a database rule only after the details, the new photo and the
		// tags are written.
		const broken = recipe('Leek soup', {
			tags: ['Hard'],
			ingredients: [ingredient('Potatoes', 3), ingredient('Stock', 0, 'cup')]
		});
		expect(() => updateDish(householdId, id, broken, { photoKey: KEY_B }, [], LATER)).toThrow(
			/CHECK constraint failed/
		);
		const dish = getDish(householdId, id);
		expect(dish).toMatchObject({ name: 'Soup', photoKey: KEY_A, tags: ['Easy'] });
		expect(dish.ingredients.map((i) => i.itemName)).toEqual(['Leeks']);
		expect(findItemByName(householdId, 'Potatoes')).toBeUndefined();
		expect(timestamps(id)).toEqual([NOW, NOW]);
	});
});

// Import recipes saves its recipes all at once (design 7, MEA-89).
describe('importing', () => {
	/** The id of the household's recipe with this name. */
	function idOf(name: string): number {
		const dish = list().find((summary) => summary.name === name);
		if (!dish) throw new Error(`No ${name}`);
		return dish.id;
	}

	it('saves new recipes, and new details for existing ones, as createDish and updateDish do', () => {
		const chili = makeDish(
			householdId,
			recipe('Chili', { tags: ['Quick'], ingredients: [ingredient('Beef', 1, 'lb')] }),
			NOW,
			KEY_A
		);
		setDishTried(householdId, chili, true);
		const cake = recipe('Pound cake', {
			servings: 8,
			notes: 'Better the next day.',
			tags: ['Dessert', 'Baking', 'DESSERT'],
			ingredients: [
				ingredient('Butter', 1, 'cup', { section: 'Cake', prepNote: 'softened' }),
				ingredient('Flour', 2.25, 'cup', { section: 'Cake' })
			]
		});
		const turkey = recipe('Chili', {
			servings: 6,
			tags: ['Healthy'],
			ingredients: [ingredient('Turkey', 1.5, 'lb'), ingredient('Beans', 2, 'can')]
		});
		const recipes = [
			{ dishId: null, input: cake },
			{ dishId: chili, input: turkey }
		];
		importDishes(householdId, recipes, itemsByName(householdId), LATER);

		const cakeId = idOf('Pound cake');
		const added = getDish(householdId, cakeId);
		expect(added).toMatchObject({
			servings: 8,
			notes: 'Better the next day.',
			tags: ['Dessert', 'Baking']
		});
		expect(added.ingredients).toMatchObject([
			{ section: 'Cake', amount: 1, unit: 'cup', itemName: 'Butter', prepNote: 'softened' },
			{ section: 'Cake', amount: 2.25, unit: 'cup', itemName: 'Flour', prepNote: null }
		]);
		expect(timestamps(cakeId)).toEqual([LATER, LATER]);

		// The photo and Tried stay, as with updateDish.
		const replaced = getDish(householdId, chili);
		expect(replaced).toMatchObject({
			name: 'Chili',
			servings: 6,
			tags: ['Healthy'],
			photoKey: KEY_A,
			tried: true
		});
		expect(replaced.ingredients.map((i) => i.itemName)).toEqual(['Turkey', 'Beans']);
		expect(timestamps(chili)).toEqual([NOW, LATER]);
		expect(db().select().from(dishTags).all()).toHaveLength(3);
		expect(db().select().from(dishIngredients).all()).toHaveLength(4);
		// Items the recipe no longer uses stay in the catalog.
		expect(catalog()).toEqual(['Beans', 'Beef', 'Butter', 'Flour', 'Turkey']);
	});

	it("adds each new item once, spelled as the first ingredient naming it, and uses the catalog's (Q1)", () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		const salsa = recipe('Salsa', {
			ingredients: [ingredient('Jalapeños', 2), ingredient('salt')]
		});
		const mole = recipe('Mole', {
			ingredients: [ingredient('JALAPEÑOS'), ingredient('  SALT ')]
		});
		const recipes = [
			{ dishId: null, input: salsa },
			{ dishId: null, input: mole }
		];
		importDishes(householdId, recipes, itemsByName(householdId), NOW);
		const itemIds = (name: string) =>
			getDish(householdId, idOf(name)).ingredients.map((i) => i.itemId);
		const jalapenos = findItemByName(householdId, 'Jalapeños')?.id;
		expect(itemIds('Salsa')).toEqual([jalapenos, salt]);
		expect(itemIds('Mole')).toEqual([jalapenos, salt]);
		expect(catalog()).toEqual(['Jalapeños', 'Salt']);
	});

	it('refuses an archived item, which importing never restores', () => {
		const salt = createItem(householdId, 'Salt', NOW).id;
		setItemArchived(householdId, salt, true, NOW);
		const soup = recipe('Soup', { ingredients: [ingredient('Leeks', 2), ingredient('salt')] });
		expect(() =>
			importDishes(householdId, [{ dishId: null, input: soup }], itemsByName(householdId), NOW)
		).toThrow('Salt is archived');
		expect(names()).toEqual([]);
		expect(findItemByName(householdId, 'Leeks')).toBeUndefined();
		expect(findItemByName(householdId, 'Salt')?.archivedAt).toBe(NOW);
	});

	it('rolls back every recipe when one fails partway', () => {
		const chili = makeDish(
			householdId,
			recipe('Chili', { ingredients: [ingredient('Beef', 1, 'lb')] }),
			NOW
		);
		// A unit without an amount breaks a database rule after everything else is written.
		const broken = recipe('Soup', {
			tags: ['Easy'],
			ingredients: [ingredient('Leeks', 2), ingredient('Stock', null, 'cup')]
		});
		const recipes = [
			{ dishId: chili, input: recipe('Chili', { servings: 6 }) },
			{ dishId: null, input: broken }
		];
		expect(() => importDishes(householdId, recipes, itemsByName(householdId), LATER)).toThrow(
			/CHECK constraint failed/
		);
		expect(names()).toEqual(['Chili']);
		expect(getDish(householdId, chili)).toMatchObject({
			servings: 4,
			ingredients: [{ itemName: 'Beef' }]
		});
		expect(timestamps(chili)).toEqual([NOW, NOW]);
		expect(findItemByName(householdId, 'Leeks')).toBeUndefined();
		expect(db().select().from(dishTags).all()).toHaveLength(0);
	});
});

describe('tried', () => {
	it('starts not tried, and marks and unmarks a dish (section 7, "Recipe")', () => {
		const id = makeDish(householdId, recipe('Pound cake'));
		expect(getDish(householdId, id).tried).toBe(false);
		setDishTried(householdId, id, true);
		expect(getDish(householdId, id).tried).toBe(true);
		expect(list()[0]?.tried).toBe(true);
		setDishTried(householdId, id, false);
		expect(getDish(householdId, id).tried).toBe(false);
		expect(list()[0]?.tried).toBe(false);
	});

	it('keeps the tried mark when the recipe is saved from Edit recipe', () => {
		const id = makeDish(householdId, recipe('Pound cake'));
		setDishTried(householdId, id, true);
		updateDish(householdId, id, recipe('Lemon pound cake'), 'keep', [], LATER);
		expect(getDish(householdId, id).tried).toBe(true);
	});

	it('works on archived dishes', () => {
		const id = makeDish(householdId, recipe('Pound cake'));
		setDishArchived(householdId, id, true, NOW);
		setDishTried(householdId, id, true);
		expect(list({ archived: true })[0]?.tried).toBe(true);
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

	it('sets, replaces, keeps and clears the photo, returning the key whose files can go', () => {
		const cake = recipe('Pound cake');
		const created = createDish(householdId, cake, KEY_A, [], NOW);
		if (created.kind !== 'saved') throw new Error('Expected it to save');
		const { id } = created;
		expect(created.replacedPhotoKey).toBeNull();
		expect(getDish(householdId, id).photoKey).toBe(KEY_A);

		const saveWith = (photo: PhotoChange) => updateDish(householdId, id, cake, photo, [], LATER);
		expect(saveWith({ photoKey: KEY_B })).toEqual({ kind: 'saved', id, replacedPhotoKey: KEY_A });
		expect(getDish(householdId, id).photoKey).toBe(KEY_B);
		// Keeping it, or the same key again, leaves nothing to delete.
		expect(saveWith('keep')).toEqual({ kind: 'saved', id, replacedPhotoKey: null });
		expect(saveWith({ photoKey: KEY_B })).toEqual({ kind: 'saved', id, replacedPhotoKey: null });
		expect(getDish(householdId, id).photoKey).toBe(KEY_B);
		expect(saveWith({ photoKey: null })).toEqual({ kind: 'saved', id, replacedPhotoKey: KEY_B });
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
		expect(names({ tags: ['QUICK'] })).toEqual(['Chili', 'Salad']);
		expect(names({ tags: ['quick'], archived: true })).toEqual(['Roast']);
		expect(names({ tags: ['Quick'], search: 'sal' })).toEqual(['Salad']);
		expect(names({ tags: ['Sweet'] })).toEqual([]);
	});

	it('filters by several tags, needing every one, ignoring case', () => {
		makeDish(householdId, recipe('Chili', { tags: ['Quick', 'Spicy', 'Dinner'] }));
		makeDish(householdId, recipe('Curry', { tags: ['spicy', 'Vegetarian', 'DINNER'] }));
		makeDish(householdId, recipe('Salad', { tags: ['Quick', 'Vegetarian'] }));
		makeDish(householdId, recipe('Éclairs', { tags: ['Crème', 'Quick'] }));
		const roast = makeDish(householdId, recipe('Roast', { tags: ['Quick', 'Spicy', 'Dinner'] }));
		setDishArchived(householdId, roast, true, NOW);
		makeDish(householdId, recipe('Stew'));

		// No tags is no tag filter.
		expect(names({ tags: [] })).toEqual(['Chili', 'Curry', 'Éclairs', 'Salad', 'Stew']);
		expect(names({ tags: ['quick', 'SPICY'] })).toEqual(['Chili']);
		expect(names({ tags: ['Spicy', 'Dinner'] })).toEqual(['Chili', 'Curry']);
		expect(names({ tags: ['Vegetarian', 'dinner', 'Spicy'] })).toEqual(['Curry']);
		expect(names({ tags: ['CRÈME', 'quick'] })).toEqual(['Éclairs']);
		// Tags that are each on some dishes, but never all on one.
		expect(names({ tags: ['Quick', 'Vegetarian', 'Dinner'] })).toEqual([]);
		expect(names({ tags: ['Quick', 'Sweet'] })).toEqual([]);
		// The same tag twice is the same as once.
		expect(names({ tags: ['Quick', 'QUICK'] })).toEqual(['Chili', 'Éclairs', 'Salad']);
		// With the search, the archived switch and the sort.
		expect(names({ tags: ['Quick', 'Spicy'], search: 'chi' })).toEqual(['Chili']);
		expect(names({ tags: ['Quick', 'Spicy'], search: 'cur' })).toEqual([]);
		expect(names({ tags: ['quick', 'dinner'], archived: true })).toEqual(['Roast']);
		const tacos = makeDish(householdId, recipe('Tacos', { tags: ['Dinner', 'Spicy'] }));
		rateDish(householdId, tacos, userId, 5);
		expect(names({ tags: ['Spicy', 'Dinner'], sort: 'rating' })).toEqual([
			'Tacos',
			'Chili',
			'Curry'
		]);
	});

	it('gives each row its photo, times and tags', () => {
		const id = makeDish(
			householdId,
			recipe('Chili', { prepMinutes: 15, cookMinutes: 60, tags: ['Spicy', 'Quick'] }),
			NOW,
			KEY_A
		);
		expect(list()).toEqual([
			{
				id,
				name: 'Chili',
				photoKey: KEY_A,
				prepMinutes: 15,
				cookMinutes: 60,
				tried: false,
				archivedAt: null,
				rating: null,
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
		// Only typed step numbers and bullets, which the recipe page doesn't show as steps.
		makeDish(householdId, recipe('Buns', { steps: '1.\n-' }));
		expect(list().map((dish) => [dish.name, dish.hasRecipe])).toEqual([
			['Buns', false],
			['Rolls', false],
			['Salad', true],
			['Tea', true],
			['Toast', false]
		]);
	});

	it('lists the tags on active dishes once each, sorted, in the oldest spelling', () => {
		const chiliRecipe = recipe('Chili', { tags: ['Spicy', 'quick'] });
		const chili = makeDish(householdId, chiliRecipe);
		makeDish(householdId, recipe('Salad', { tags: ['Quick', 'Vegetarian'] }));
		const roast = makeDish(householdId, recipe('Roast', { tags: ['Sunday'] }));
		setDishArchived(householdId, roast, true, NOW);
		expect(listDishTags(householdId)).toEqual(['quick', 'Spicy', 'Vegetarian']);
		// Saving the older dish again keeps its spelling first.
		updateDish(householdId, chili, chiliRecipe, 'keep', [], LATER);
		expect(listDishTags(householdId)).toEqual(['quick', 'Spicy', 'Vegetarian']);
	});
});

// The Recipes page's Grouped view (section 7, "Recipes"; MEA-246).
describe('grouping by last made', () => {
	// The household's date: Sat 2026-10-03, so 60 days before is Tue 2026-08-04.
	const TODAY = '2026-10-03';

	/** Each group by name, with the last date on the Menu where there is one. */
	function grouped(filter: { search?: string; tags?: string[] } = {}, today = TODAY) {
		const groups = groupDishesByLastMade(householdId, { search: '', tags: [], ...filter }, today);
		return {
			recent: groups.recent.map((dish) => [dish.name, dish.lastMade]),
			longAgo: groups.longAgo.map((dish) => [dish.name, dish.lastMade]),
			never: groups.never.map((dish) => dish.name)
		};
	}

	/** A Cooking at home dinner on the date: the first dish as the main, the rest as sides. */
	function cooked(date: string, ...dishIds: number[]): number {
		return makeDinner(householdId, date, {
			dishes: dishIds.map((dishId, index) => [dishId, index === 0 ? 'main' : 'side'])
		});
	}

	it('puts each dish in one group by its last date on the Menu, each group in its order', () => {
		const chili = makeDish(householdId, recipe('Chili'));
		const tacos = makeDish(householdId, recipe('Tacos'));
		const rice = makeDish(householdId, recipe('Rice'));
		const soup = makeDish(householdId, recipe('Soup'));
		const stew = makeDish(householdId, recipe('Stew'));
		const salad = makeDish(householdId, recipe('Salad'));
		const bread = makeDish(householdId, recipe('Bread'));
		makeDish(householdId, recipe('Pancakes'));
		makeDish(householdId, recipe('Apple pie'));
		cooked(TODAY, chili);
		// Only the latest of a dish's dinners counts, and the same date falls back to name.
		cooked('2026-09-30', tacos, rice);
		cooked('2026-06-01', tacos);
		cooked('2026-06-01', soup);
		cooked('2026-06-01', bread);
		cooked('2025-12-25', stew);
		// Bringing a dish counts too.
		makeDinner(householdId, '2026-07-04', { type: 'going', dishes: [[salad, 'main']] });
		expect(grouped()).toEqual({
			recent: [
				['Chili', TODAY],
				['Rice', '2026-09-30'],
				['Tacos', '2026-09-30']
			],
			longAgo: [
				['Stew', '2025-12-25'],
				['Bread', '2026-06-01'],
				['Soup', '2026-06-01'],
				['Salad', '2026-07-04']
			],
			never: ['Apple pie', 'Pancakes']
		});
	});

	it("gives each dish the list's summary, with its last date on the Menu", () => {
		const chili = makeDish(
			householdId,
			recipe('Chili', { cookMinutes: 45, tags: ['Spicy'] }),
			NOW,
			KEY_A
		);
		makeDish(householdId, recipe('Toast', { steps: 'Toast the bread.' }));
		rateDish(householdId, chili, userId, 4);
		setDishTried(householdId, chili, true);
		cooked('2026-09-30', chili);
		const [chiliSummary, toastSummary] = list();
		expect(groupDishesByLastMade(householdId, { search: '', tags: [] }, TODAY)).toEqual({
			recent: [{ ...chiliSummary, lastMade: '2026-09-30' }],
			longAgo: [],
			never: [toastSummary]
		});
	});

	it('counts 60 days before today as recent and earlier as long ago, moving as days pass', () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const soup = makeDish(householdId, recipe('Soup'));
		// 60 and 61 days before Sat Oct 3.
		cooked('2026-08-04', tacos);
		cooked('2026-08-03', soup);
		expect(grouped()).toEqual({
			recent: [['Tacos', '2026-08-04']],
			longAgo: [['Soup', '2026-08-03']],
			never: []
		});
		// The next day, with nothing changed on the Menu, Tacos was 61 days ago.
		expect(grouped({}, '2026-10-04')).toEqual({
			recent: [],
			longAgo: [
				['Soup', '2026-08-03'],
				['Tacos', '2026-08-04']
			],
			never: []
		});
	});

	it("leaves out dinners planned after today, which aren't made yet", () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const soup = makeDish(householdId, recipe('Soup'));
		cooked('2026-10-04', tacos);
		cooked('2026-05-01', soup);
		cooked('2026-10-10', soup);
		expect(grouped()).toEqual({
			recent: [],
			longAgo: [['Soup', '2026-05-01']],
			never: ['Tacos']
		});
		// Once its day comes, it counts.
		expect(grouped({}, '2026-10-04')).toEqual({
			recent: [['Tacos', '2026-10-04']],
			longAgo: [['Soup', '2026-05-01']],
			never: []
		});
	});

	it('follows the Menu as dinners are planned, changed, moved and cleared', () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const rice = makeDish(householdId, recipe('Rice'));
		/** The id of the date's only dinner. */
		const dinnerOn = (date: string) => {
			const dinner = getDay(householdId, date)[0];
			if (!dinner) throw new Error(`No dinner on ${date}`);
			return dinner.id;
		};

		addDinnerDish(householdId, '2026-10-02', null, { id: tacos }, 'main', NOW);
		const dinnerId = dinnerOn('2026-10-02');
		addDinnerDish(householdId, '2026-10-02', dinnerId, { id: rice }, 'side', NOW);
		expect(grouped()).toEqual({
			recent: [
				['Rice', '2026-10-02'],
				['Tacos', '2026-10-02']
			],
			longAgo: [],
			never: []
		});

		removeDinnerDish(householdId, '2026-10-02', dinnerId, rice, NOW);
		expect(grouped()).toEqual({ recent: [['Tacos', '2026-10-02']], longAgo: [], never: ['Rice'] });

		moveDinners(householdId, '2026-10-02', '2026-07-01', dinnerId, NOW);
		expect(grouped()).toEqual({ recent: [], longAgo: [['Tacos', '2026-07-01']], never: ['Rice'] });

		moveDinners(householdId, '2026-07-01', '2026-10-09', dinnerId, NOW);
		expect(grouped()).toEqual({ recent: [], longAgo: [], never: ['Rice', 'Tacos'] });

		// Switching to Leftovers takes its dishes off.
		moveDinners(householdId, '2026-10-09', '2026-10-01', dinnerId, NOW);
		expect(grouped()).toEqual({ recent: [['Tacos', '2026-10-01']], longAgo: [], never: ['Rice'] });
		const leftovers = { label: null, type: 'leftovers' as const, restaurantName: null, note: null };
		saveDinner(householdId, '2026-10-01', dinnerId, { ...leftovers, servings: 4 }, NOW);
		expect(grouped()).toEqual({ recent: [], longAgo: [], never: ['Rice', 'Tacos'] });

		addDinnerDish(householdId, '2026-09-01', null, { id: rice }, 'main', NOW);
		expect(grouped()).toEqual({ recent: [['Rice', '2026-09-01']], longAgo: [], never: ['Tacos'] });
		clearDinner(householdId, '2026-09-01', dinnerOn('2026-09-01'), NOW);
		expect(grouped()).toEqual({ recent: [], longAgo: [], never: ['Rice', 'Tacos'] });
	});

	it('applies the search and tags to every group', () => {
		const apple = makeDish(householdId, recipe('Apple pie', { tags: ['Dessert'] }));
		const pecan = makeDish(householdId, recipe('Pecan pie', { tags: ['Dessert', 'Holiday'] }));
		const pumpkin = makeDish(householdId, recipe('Pumpkin pie', { tags: ['dessert'] }));
		const chili = makeDish(householdId, recipe('Chili'));
		makeDish(householdId, recipe('Key lime pie', { tags: ['Dessert'] }));
		makeDish(householdId, recipe('Cherry cobbler', { tags: ['Dessert'] }));
		cooked('2026-09-20', apple, chili);
		cooked('2025-11-26', pecan);
		cooked('2026-05-01', pumpkin);
		expect(grouped({ search: 'PIE' })).toEqual({
			recent: [['Apple pie', '2026-09-20']],
			longAgo: [
				['Pecan pie', '2025-11-26'],
				['Pumpkin pie', '2026-05-01']
			],
			never: ['Key lime pie']
		});
		expect(grouped({ tags: ['DESSERT'] })).toEqual({
			recent: [['Apple pie', '2026-09-20']],
			longAgo: [
				['Pecan pie', '2025-11-26'],
				['Pumpkin pie', '2026-05-01']
			],
			never: ['Cherry cobbler', 'Key lime pie']
		});
		expect(grouped({ search: 'p', tags: ['Dessert', 'holiday'] })).toEqual({
			recent: [],
			longAgo: [['Pecan pie', '2025-11-26']],
			never: []
		});
		expect(grouped({ search: 'zzz' })).toEqual({ recent: [], longAgo: [], never: [] });
	});

	it('leaves out archived dishes, which are only listed', () => {
		const tacos = makeDish(householdId, recipe('Tacos'));
		const soup = makeDish(householdId, recipe('Soup'));
		const stew = makeDish(householdId, recipe('Stew'));
		cooked('2026-09-30', tacos, soup);
		setDishArchived(householdId, soup, true, NOW);
		setDishArchived(householdId, stew, true, NOW);
		expect(grouped()).toEqual({ recent: [['Tacos', '2026-09-30']], longAgo: [], never: [] });
		// Restored, it's grouped by the dinners it was on all along.
		setDishArchived(householdId, soup, false, NOW);
		expect(grouped()).toEqual({
			recent: [
				['Soup', '2026-09-30'],
				['Tacos', '2026-09-30']
			],
			longAgo: [],
			never: []
		});
	});
});

describe('ratings', () => {
	function addMember(name: string): number {
		return db()
			.insert(users)
			.values({
				householdId,
				googleSub: `sub-${name}`,
				email: `${name}@example.com`,
				name,
				createdAt: 0
			})
			.returning({ id: users.id })
			.get().id;
	}

	it("starts unrated, then averages and counts everyone's stars (section 7, \"Recipe\")", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const sam = addMember('sam');
		expect(getDish(householdId, id).rating).toBeNull();
		expect(list()[0]?.rating).toBeNull();
		expect(getOwnRating(householdId, id, userId)).toBeNull();

		rateDish(householdId, id, userId, 4);
		rateDish(householdId, id, sam, 5);
		expect(getDish(householdId, id).rating).toEqual({ average: 4.5, count: 2 });
		expect(list()[0]?.rating).toEqual({ average: 4.5, count: 2 });
	});

	it("keeps each person's rating their own", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const sam = addMember('sam');
		rateDish(householdId, id, userId, 4);
		rateDish(householdId, id, sam, 2);
		rateDish(householdId, id, sam, 3);
		expect(getOwnRating(householdId, id, userId)).toBe(4);
		expect(getOwnRating(householdId, id, sam)).toBe(3);
		expect(getDish(householdId, id).rating).toEqual({ average: 3.5, count: 2 });
		expect(listDishRatings(householdId, id)).toEqual([
			{ name: nameOf(userId), stars: 4 },
			{ name: 'sam', stars: 3 }
		]);
	});

	it('keeps your stars when the same ones come again, as from a tap sent twice (MEA-86)', () => {
		const id = makeDish(householdId, recipe('Omelet'));
		rateDish(householdId, id, userId, 4);
		rateDish(householdId, id, userId, 4);
		expect(getOwnRating(householdId, id, userId)).toBe(4);
		expect(getDish(householdId, id).rating).toEqual({ average: 4, count: 1 });
		expect(listDishRatings(householdId, id)).toEqual([{ name: nameOf(userId), stars: 4 }]);
	});

	it("clears your rating, and nobody else's, when no stars come", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const sam = addMember('sam');
		rateDish(householdId, id, userId, 4);
		rateDish(householdId, id, sam, 4);
		rateDish(householdId, id, userId, null);
		expect(getOwnRating(householdId, id, userId)).toBeNull();
		expect(getOwnRating(householdId, id, sam)).toBe(4);
		expect(getDish(householdId, id).rating).toEqual({ average: 4, count: 1 });
		expect(listDishRatings(householdId, id)).toEqual([{ name: 'sam', stars: 4 }]);
		// Cleared again, as from a tap sent twice, it stays cleared (MEA-86).
		rateDish(householdId, id, userId, null);
		expect(getOwnRating(householdId, id, userId)).toBeNull();
		rateDish(householdId, id, sam, null);
		expect(getDish(householdId, id).rating).toBeNull();
		expect(listDishRatings(householdId, id)).toEqual([]);
	});

	it('lists who rated, yours included, by name ignoring case (section 7, "Recipe")', () => {
		const id = makeDish(householdId, recipe('Omelet'));
		expect(listDishRatings(householdId, id)).toEqual([]);

		rateDish(householdId, id, addMember('sam'), 5);
		rateDish(householdId, id, userId, 4);
		// Before your name, "Person …", only when case is ignored.
		rateDish(householdId, id, addMember('kim'), 2);
		expect(listDishRatings(householdId, id)).toEqual([
			{ name: 'kim', stars: 2 },
			{ name: nameOf(userId), stars: 4 },
			{ name: 'sam', stars: 5 }
		]);
	});

	it("lists a removed member's ratings as Former member, after everyone else's", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const sam = addMember('sam');
		const kim = addMember('kim');
		const zoe = addMember('zoe');
		rateDish(householdId, id, sam, 5);
		rateDish(householdId, id, zoe, 4);
		rateDish(householdId, id, kim, 1);
		rateDish(householdId, id, userId, 3);
		removeMember(householdId, userId, sam);
		removeMember(householdId, userId, kim);

		const ratings = listDishRatings(householdId, id);
		expect(ratings).toEqual([
			{ name: nameOf(userId), stars: 3 },
			{ name: 'zoe', stars: 4 },
			// Each on its own, in the order they rated.
			{ name: 'Former member', stars: 5 },
			{ name: 'Former member', stars: 1 }
		]);
		expect(JSON.stringify(ratings)).not.toMatch(/sam|kim/);
		// Still in the average and count.
		expect(getDish(householdId, id).rating).toEqual({ average: 13 / 4, count: 4 });
	});

	it("keeps a removed member's rating in the average and count", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const sam = addMember('sam');
		rateDish(householdId, id, userId, 3);
		rateDish(householdId, id, sam, 5);
		removeMember(householdId, userId, sam);
		expect(getDish(householdId, id).rating).toEqual({ average: 4, count: 2 });
		expect(list()[0]?.rating).toEqual({ average: 4, count: 2 });
	});

	it("doesn't change Tried it, and works on archived recipes", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		setDishArchived(householdId, id, true, NOW);
		rateDish(householdId, id, userId, 2);
		expect(getDish(householdId, id)).toMatchObject({
			tried: false,
			rating: { average: 2, count: 1 }
		});
		expect(list({ archived: true })[0]?.rating).toEqual({ average: 2, count: 1 });
		expect(listDishRatings(householdId, id)).toEqual([{ name: nameOf(userId), stars: 2 }]);
	});

	it('sorts by exact average, then unrated, ties by name (section 7, "Recipes")', () => {
		const people = [userId, addMember('sam'), addMember('kim')];
		function rated(name: string, stars: number[]) {
			const id = makeDish(householdId, recipe(name));
			stars.forEach((star, i) => rateDish(householdId, id, people[i] ?? userId, star));
		}
		rated('Zucchini', []);
		rated('Chili', [4]);
		// 4.33, shown rounded as 4.5, still sorts below an exact 4.5.
		rated('Soup', [4, 4, 5]);
		rated('Tacos', [4, 5]);
		rated('Apple pie', []);
		rated('Beans', [3, 5]);
		expect(names({ sort: 'rating' })).toEqual([
			'Tacos',
			'Soup',
			'Beans',
			'Chili',
			'Apple pie',
			'Zucchini'
		]);
		expect(names({ sort: 'rating', search: 'i' })).toEqual(['Chili', 'Apple pie', 'Zucchini']);
		expect(names()).toEqual(['Apple pie', 'Beans', 'Chili', 'Soup', 'Tacos', 'Zucchini']);
	});

	it('the database allows only 1 to 5 stars', () => {
		const dishId = makeDish(householdId, recipe('Omelet'));
		for (const stars of [0, 6]) {
			expect(() =>
				db().insert(dishRatings).values({ householdId, dishId, userId, stars }).run()
			).toThrow(/CHECK constraint/);
		}
	});
});

describe('households', () => {
	it("never shows or changes another household's dishes", () => {
		const id = makeDish(householdId, recipe('Pound cake', { tags: ['Dessert'] }));
		const other = makeHousehold();
		const all = { search: '', tags: [], archived: false, sort: 'name' as const };
		expect(listDishes(other.householdId, all)).toEqual([]);
		expect(listDishes(other.householdId, { ...all, tags: ['Dessert'] })).toEqual([]);
		expect(listDishTags(other.householdId)).toEqual([]);
		expect(groupDishesByLastMade(other.householdId, all, '2026-10-03')).toEqual({
			recent: [],
			longAgo: [],
			never: []
		});
		expectHttpError(() => getDish(other.householdId, id), 404);
		expectHttpError(
			() => updateDish(other.householdId, id, recipe('Mine now'), { photoKey: KEY_A }, [], NOW),
			404
		);
		expect(dishesByName(other.householdId).size).toBe(0);
		const mine = [{ dishId: id, input: recipe('Mine now') }];
		expectHttpError(
			() => importDishes(other.householdId, mine, itemsByName(other.householdId), NOW),
			404
		);
		expectHttpError(() => setDishArchived(other.householdId, id, true, NOW), 404);
		expectHttpError(() => setDishTried(other.householdId, id, true), 404);
		expectHttpError(() => rateDish(other.householdId, id, other.userId, 5), 404);
		expectHttpError(() => rateDish(other.householdId, id, other.userId, null), 404);
		expect(getDish(householdId, id)).toMatchObject({
			name: 'Pound cake',
			tried: false,
			archivedAt: null,
			photoKey: null
		});
		expectHttpError(() => getDish(householdId, id + 1000), 404);
	});

	it("groups by the household's own Menu, never another household's (MEA-246)", () => {
		makeDish(householdId, recipe('Tacos'));
		const other = makeHousehold();
		const theirs = makeDish(other.householdId, recipe('Tacos'));
		makeDinner(other.householdId, '2026-10-01', { dishes: [[theirs, 'main']] });
		const all = { search: '', tags: [] };
		expect(groupDishesByLastMade(householdId, all, '2026-10-03')).toMatchObject({
			recent: [],
			longAgo: [],
			never: [{ name: 'Tacos' }]
		});
		expect(groupDishesByLastMade(other.householdId, all, '2026-10-03')).toMatchObject({
			recent: [{ id: theirs, lastMade: '2026-10-01' }],
			longAgo: [],
			never: []
		});
	});

	it("keeps ratings in their household; the database rejects another household's dish", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const other = makeHousehold();
		const theirs = makeDish(other.householdId, recipe('Omelet'));
		rateDish(householdId, id, userId, 2);
		rateDish(other.householdId, theirs, other.userId, 5);
		expect(getDish(householdId, id).rating).toEqual({ average: 2, count: 1 });
		expect(getDish(other.householdId, theirs).rating).toEqual({ average: 5, count: 1 });
		expect(getOwnRating(other.householdId, id, userId)).toBeNull();
		expect(listDishRatings(householdId, id)).toEqual([{ name: nameOf(userId), stars: 2 }]);
		expect(listDishRatings(other.householdId, theirs)).toEqual([
			{ name: nameOf(other.userId), stars: 5 }
		]);
		// Each household's dish id gets nothing from the other household.
		expect(listDishRatings(other.householdId, id)).toEqual([]);
		expect(listDishRatings(householdId, theirs)).toEqual([]);
		expect(() =>
			db().insert(dishRatings).values({ householdId, dishId: theirs, userId, stars: 3 }).run()
		).toThrow(/FOREIGN KEY/);
	});

	it("the database rejects a rating by another household's member (4.5)", () => {
		const id = makeDish(householdId, recipe('Omelet'));
		const other = makeHousehold();
		expect(() =>
			db()
				.insert(dishRatings)
				.values({ householdId, dishId: id, userId: other.userId, stars: 5 })
				.run()
		).toThrow(/FOREIGN KEY/);
		expect(listDishRatings(householdId, id)).toEqual([]);
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
