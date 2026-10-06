import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { splitSteps } from '../../steps.ts';
import { foldCase, normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dishes, dishIngredients, dishTags, items } from '../db/schema.ts';
import { createItem, findItemByName, setItemArchived } from './items.ts';

// Dishes and recipes are one record, and the recipe details are optional (Q2).

export type IngredientInput = {
	section: string | null;
	amount: number | null;
	unit: string | null;
	itemName: string;
	prepNote: string | null;
};

/** What the recipe editor saves. It arrives validated, with names and units normalized. */
export type DishInput = {
	name: string;
	servings: number;
	prepMinutes: number | null;
	cookMinutes: number | null;
	steps: string | null;
	notes: string | null;
	source: string | null;
	calories: number | null;
	proteinG: number | null;
	carbsG: number | null;
	fatG: number | null;
	tags: string[];
	ingredients: IngredientInput[];
};

/** `taken` names the dish that already has the name, so the page can offer to restore it. */
export type DishSaveResult =
	| { kind: 'saved'; id: number }
	| { kind: 'taken'; archived: boolean; id: number };

export type DishIngredient = {
	id: number;
	position: number;
	section: string | null;
	amount: number | null;
	unit: string | null;
	itemId: number;
	itemName: string;
	prepNote: string | null;
};

export type DishDetail = {
	id: number;
	name: string;
	servings: number;
	prepMinutes: number | null;
	cookMinutes: number | null;
	steps: string | null;
	notes: string | null;
	source: string | null;
	photoKey: string | null;
	calories: number | null;
	proteinG: number | null;
	carbsG: number | null;
	fatG: number | null;
	archivedAt: number | null;
	tags: string[];
	ingredients: DishIngredient[];
};

export type DishSummary = {
	id: number;
	name: string;
	photoKey: string | null;
	prepMinutes: number | null;
	cookMinutes: number | null;
	archivedAt: number | null;
	tags: string[];
	/** False for a dish with no ingredients and no steps, labeled "No recipe" (change 2.1.1). */
	hasRecipe: boolean;
};

const detailFields = {
	id: dishes.id,
	name: dishes.name,
	servings: dishes.servings,
	prepMinutes: dishes.prepMinutes,
	cookMinutes: dishes.cookMinutes,
	steps: dishes.steps,
	notes: dishes.notes,
	source: dishes.source,
	photoKey: dishes.photoKey,
	calories: dishes.calories,
	proteinG: dishes.proteinG,
	carbsG: dishes.carbsG,
	fatG: dishes.fatG,
	archivedAt: dishes.archivedAt
};

function findDish(householdId: number, dishId: number): { id: number; photoKey: string | null } {
	const dish = db()
		.select({ id: dishes.id, photoKey: dishes.photoKey })
		.from(dishes)
		.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
		.get();
	if (!dish) error(404, 'Not found');
	return dish;
}

/** Names are unique per household ignoring case, archived dishes included (design 2.3, 6.10). */
function findDishByName(householdId: number, name: string) {
	return db()
		.select({ id: dishes.id, archivedAt: dishes.archivedAt })
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), sql`fold(${dishes.name}) = fold(${name})`))
		.get();
}

/**
 * The catalog item an ingredient names (Q1): an existing one, or a new one for a new name.
 * `usedBefore` is the items the dish used before this save.
 */
function ingredientItem(
	householdId: number,
	itemName: string,
	usedBefore: Set<number>,
	now: number
): number {
	const name = normalizeName(itemName);
	const item = findItemByName(householdId, name);
	if (!item) return createItem(householdId, name, now).id;
	// Adding an archived item to a recipe brings it back, as adding it to the list does. One
	// the recipe already used stays archived (6.10).
	if (item.archivedAt !== null && !usedBefore.has(item.id)) {
		setItemArchived(householdId, item.id, false, now);
	}
	return item.id;
}

/** Writes the dish and replaces its tags and ingredients. Callers run it in a transaction. */
function save(
	householdId: number,
	dishId: number | null,
	input: DishInput,
	now: number
): DishSaveResult {
	const taken = findDishByName(householdId, input.name);
	if (taken && taken.id !== dishId) {
		return { kind: 'taken', archived: taken.archivedAt !== null, id: taken.id };
	}

	// Listed one by one, so nothing else in the input (a photo key, say) is ever written.
	const fields = {
		name: input.name,
		servings: input.servings,
		prepMinutes: input.prepMinutes,
		cookMinutes: input.cookMinutes,
		steps: input.steps,
		notes: input.notes,
		source: input.source,
		calories: input.calories,
		proteinG: input.proteinG,
		carbsG: input.carbsG,
		fatG: input.fatG
	};

	let id: number;
	const usedBefore = new Set<number>();
	if (dishId === null) {
		id = db()
			.insert(dishes)
			.values({ ...fields, householdId, createdAt: now, updatedAt: now })
			.returning({ id: dishes.id })
			.get().id;
	} else {
		id = dishId;
		db()
			.update(dishes)
			.set({ ...fields, updatedAt: now })
			.where(eq(dishes.id, id))
			.run();
		db().delete(dishTags).where(eq(dishTags.dishId, id)).run();
		const previous = db()
			.delete(dishIngredients)
			.where(eq(dishIngredients.dishId, id))
			.returning({ itemId: dishIngredients.itemId })
			.all();
		for (const { itemId } of previous) usedBefore.add(itemId);
	}

	// The database allows each tag once per dish, ignoring case. The first spelling wins.
	const tagRows = new Map<string, { householdId: number; dishId: number; tag: string }>();
	for (const tag of input.tags) {
		const key = foldCase(tag);
		if (!tagRows.has(key)) tagRows.set(key, { householdId, dishId: id, tag });
	}
	if (tagRows.size > 0) db().insert(dishTags).values([...tagRows.values()]).run();

	const ingredientRows = input.ingredients.map((ingredient, position) => ({
		householdId,
		dishId: id,
		position,
		section: ingredient.section,
		amount: ingredient.amount,
		unit: ingredient.unit,
		itemId: ingredientItem(householdId, ingredient.itemName, usedBefore, now),
		prepNote: ingredient.prepNote
	}));
	if (ingredientRows.length > 0) db().insert(dishIngredients).values(ingredientRows).run();

	return { kind: 'saved', id };
}

export function createDish(householdId: number, input: DishInput, now: number): DishSaveResult {
	return transaction(() => save(householdId, null, input, now));
}

export function updateDish(
	householdId: number,
	dishId: number,
	input: DishInput,
	now: number
): DishSaveResult {
	return transaction(() => {
		findDish(householdId, dishId);
		return save(householdId, dishId, input, now);
	});
}

/** Archiving only hides a dish from lists and pickers; everything using it keeps working (6.10). */
export function setDishArchived(
	householdId: number,
	dishId: number,
	archived: boolean,
	now: number
): void {
	findDish(householdId, dishId);
	db()
		.update(dishes)
		.set({ archivedAt: archived ? now : null })
		.where(eq(dishes.id, dishId))
		.run();
}

/**
 * Sets or clears the photo. Returns the previous key, so the caller can delete its files, or
 * null when there was none or it didn't change.
 */
export function setDishPhoto(
	householdId: number,
	dishId: number,
	photoKey: string | null,
	now: number
): string | null {
	return transaction(() => {
		const previous = findDish(householdId, dishId).photoKey;
		db().update(dishes).set({ photoKey, updatedAt: now }).where(eq(dishes.id, dishId)).run();
		return previous === photoKey ? null : previous;
	});
}

export function getDish(householdId: number, dishId: number): DishDetail {
	const dish = db()
		.select(detailFields)
		.from(dishes)
		.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
		.get();
	if (!dish) error(404, 'Not found');

	const tags = db()
		.select({ tag: dishTags.tag })
		.from(dishTags)
		.where(eq(dishTags.dishId, dishId))
		.orderBy(asc(dishTags.id))
		.all()
		.map((row) => row.tag);
	const ingredients = db()
		.select({
			id: dishIngredients.id,
			position: dishIngredients.position,
			section: dishIngredients.section,
			amount: dishIngredients.amount,
			unit: dishIngredients.unit,
			itemId: dishIngredients.itemId,
			itemName: items.name,
			prepNote: dishIngredients.prepNote
		})
		.from(dishIngredients)
		.innerJoin(items, eq(items.id, dishIngredients.itemId))
		.where(eq(dishIngredients.dishId, dishId))
		.orderBy(asc(dishIngredients.position))
		.all();
	return { ...dish, tags, ingredients };
}

/** Every dish's tags, in the order they were entered. */
function tagsByDish(householdId: number): Map<number, string[]> {
	const byDish = new Map<number, string[]>();
	const rows = db()
		.select({ dishId: dishTags.dishId, tag: dishTags.tag })
		.from(dishTags)
		.where(eq(dishTags.householdId, householdId))
		.orderBy(asc(dishTags.id))
		.all();
	for (const { dishId, tag } of rows) {
		const tags = byDish.get(dishId);
		if (tags) tags.push(tag);
		else byDish.set(dishId, [tag]);
	}
	return byDish;
}

/**
 * The Recipes page: active dishes, or archived ones, sorted by name. `search` matches anywhere
 * in the name and `tag` matches a tag, both ignoring case.
 */
export function listDishes(
	householdId: number,
	filter: { search: string; tag: string | null; archived: boolean }
): DishSummary[] {
	const tags = tagsByDish(householdId);
	const ingredientCounts = db()
		.select({
			dishId: dishIngredients.dishId,
			count: sql<number>`count(*)`.as('count')
		})
		.from(dishIngredients)
		.where(eq(dishIngredients.householdId, householdId))
		.groupBy(dishIngredients.dishId)
		.as('ingredient_counts');

	return db()
		.select({
			id: dishes.id,
			name: dishes.name,
			photoKey: dishes.photoKey,
			prepMinutes: dishes.prepMinutes,
			cookMinutes: dishes.cookMinutes,
			archivedAt: dishes.archivedAt,
			steps: dishes.steps,
			ingredientCount: ingredientCounts.count
		})
		.from(dishes)
		.leftJoin(ingredientCounts, eq(ingredientCounts.dishId, dishes.id))
		.where(
			and(
				eq(dishes.householdId, householdId),
				filter.archived ? isNotNull(dishes.archivedAt) : isNull(dishes.archivedAt),
				filter.search === ''
					? undefined
					: sql`instr(fold(${dishes.name}), fold(${filter.search})) > 0`,
				filter.tag === null
					? undefined
					: sql`exists (select 1 from ${dishTags} where ${dishTags.dishId} = ${dishes.id}
						and fold(${dishTags.tag}) = fold(${filter.tag}))`
			)
		)
		.all()
		.map(({ steps, ingredientCount, ...dish }) => ({
			...dish,
			tags: tags.get(dish.id) ?? [],
			// The same test as the recipe page.
			hasRecipe: ingredientCount !== null || splitSteps(steps).length > 0
		}))
		// Sorted here rather than in SQL, so "Éclairs" sorts with the E's.
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The tags on active dishes for filtering and suggestions, each once ignoring case and sorted.
 * A tag spelled two ways shows the spelling of the oldest dish that has it.
 */
export function listDishTags(householdId: number): string[] {
	const rows = db()
		.select({ tag: dishTags.tag })
		.from(dishTags)
		.innerJoin(dishes, eq(dishes.id, dishTags.dishId))
		.where(and(eq(dishTags.householdId, householdId), isNull(dishes.archivedAt)))
		.orderBy(asc(dishes.id), asc(dishTags.id))
		.all();
	const byKey = new Map<string, string>();
	for (const { tag } of rows) {
		const key = foldCase(tag);
		if (!byKey.has(key)) byKey.set(key, tag);
	}
	return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
