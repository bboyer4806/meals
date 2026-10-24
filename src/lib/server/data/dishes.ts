import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { splitSteps } from '../../steps.ts';
import { foldCase, normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dishes, dishIngredients, dishRatings, dishTags, items } from '../db/schema.ts';
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

/**
 * `taken` names the dish that already has the name, so the page can offer to restore it.
 * `archived` names all the archived items the recipe would start using, so the page can ask
 * before restoring them (6.10).
 */
export type DishSaveResult =
	| { kind: 'saved'; id: number }
	| { kind: 'taken'; archived: boolean; id: number }
	| { kind: 'archived'; items: { id: number; name: string }[] };

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

/** The household's stars for a dish: the plain average, unrounded, and how many rated it. */
export type DishRating = { average: number; count: number };

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
	tried: boolean;
	archivedAt: number | null;
	/** Null until someone rates it. */
	rating: DishRating | null;
	tags: string[];
	ingredients: DishIngredient[];
};

export type DishSummary = {
	id: number;
	name: string;
	photoKey: string | null;
	prepMinutes: number | null;
	cookMinutes: number | null;
	tried: boolean;
	archivedAt: number | null;
	/** Null until someone rates it. */
	rating: DishRating | null;
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
	tried: dishes.tried,
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
export function findDishByName(householdId: number, name: string) {
	return db()
		.select({ id: dishes.id, name: dishes.name, archivedAt: dishes.archivedAt })
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), sql`fold(${dishes.name}) = fold(${name})`))
		.get();
}

/** The catalog item an ingredient names (Q1): an existing one, or a new one for a new name. */
function ingredientItem(householdId: number, itemName: string, now: number): number {
	const name = normalizeName(itemName);
	return (findItemByName(householdId, name) ?? createItem(householdId, name, now)).id;
}

/**
 * The archived items the ingredients name that the dish didn't use before this save, by id, each
 * once in the order of the ingredients. One the recipe already used stays archived (6.10).
 */
function newlyUsedArchivedItems(
	householdId: number,
	dishId: number | null,
	ingredients: IngredientInput[]
): Map<number, string> {
	const usedBefore = new Set<number>();
	if (dishId !== null) {
		const rows = db()
			.select({ itemId: dishIngredients.itemId })
			.from(dishIngredients)
			.where(eq(dishIngredients.dishId, dishId))
			.all();
		for (const { itemId } of rows) usedBefore.add(itemId);
	}
	const archived = new Map<number, string>();
	for (const ingredient of ingredients) {
		const item = findItemByName(householdId, normalizeName(ingredient.itemName));
		if (item && item.archivedAt !== null && !usedBefore.has(item.id)) {
			archived.set(item.id, item.name);
		}
	}
	return archived;
}

/**
 * Writes the dish and replaces its tags and ingredients, unless it would start using an archived
 * item that isn't in `restoreItemIds`. Callers run it in a transaction.
 */
function save(
	householdId: number,
	dishId: number | null,
	input: DishInput,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	const taken = findDishByName(householdId, input.name);
	if (taken && taken.id !== dishId) {
		return { kind: 'taken', archived: taken.archivedAt !== null, id: taken.id };
	}

	// Using an archived item in a recipe brings it back, as adding it to the list does, so it
	// asks first, and restores only the items the person agreed to. With any left out it asks
	// about them all, so one more answer restores everything it named (6.10).
	const archived = newlyUsedArchivedItems(householdId, dishId, input.ingredients);
	if ([...archived.keys()].some((itemId) => !restoreItemIds.includes(itemId))) {
		return { kind: 'archived', items: [...archived].map(([id, name]) => ({ id, name })) };
	}
	for (const itemId of archived.keys()) setItemArchived(householdId, itemId, false, now);

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
		db().delete(dishIngredients).where(eq(dishIngredients.dishId, id)).run();
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
		itemId: ingredientItem(householdId, ingredient.itemName, now),
		prepNote: ingredient.prepNote
	}));
	if (ingredientRows.length > 0) db().insert(dishIngredients).values(ingredientRows).run();

	return { kind: 'saved', id };
}

/**
 * `restoreItemIds` are the archived items the person agreed to restore. Ids of items the recipe
 * doesn't start using are ignored (6.10).
 */
export function createDish(
	householdId: number,
	input: DishInput,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	return transaction(() => save(householdId, null, input, restoreItemIds, now));
}

/**
 * `restoreItemIds` are the archived items the person agreed to restore. Ids of items the recipe
 * doesn't start using are ignored (6.10).
 */
export function updateDish(
	householdId: number,
	dishId: number,
	input: DishInput,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	return transaction(() => {
		findDish(householdId, dishId);
		return save(householdId, dishId, input, restoreItemIds, now);
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

/** Shared by the household; the last change wins (section 7, "Recipe"; 6.11). */
export function setDishTried(householdId: number, dishId: number, tried: boolean): void {
	findDish(householdId, dishId);
	db().update(dishes).set({ tried }).where(eq(dishes.id, dishId)).run();
}

/**
 * Sets the person's own stars for the dish, or clears them when they're the stars it already
 * has, as tapping the current star does. Nobody else's rating changes (section 7, "Recipe").
 */
export function rateDish(householdId: number, dishId: number, userId: number, stars: number): void {
	transaction(() => {
		findDish(householdId, dishId);
		const own = and(eq(dishRatings.dishId, dishId), eq(dishRatings.userId, userId));
		const current = db().select({ stars: dishRatings.stars }).from(dishRatings).where(own).get();
		if (current === undefined) {
			db().insert(dishRatings).values({ householdId, dishId, userId, stars }).run();
		} else if (current.stars === stars) {
			db().delete(dishRatings).where(own).run();
		} else {
			db().update(dishRatings).set({ stars }).where(own).run();
		}
	});
}

/** The person's own stars for the dish, or null when they haven't rated it. */
export function getOwnRating(householdId: number, dishId: number, userId: number): number | null {
	const row = db()
		.select({ stars: dishRatings.stars })
		.from(dishRatings)
		.where(
			and(
				eq(dishRatings.householdId, householdId),
				eq(dishRatings.dishId, dishId),
				eq(dishRatings.userId, userId)
			)
		)
		.get();
	return row?.stars ?? null;
}

/**
 * Every rated dish's average and count, to join on the dish id. A removed member's ratings
 * still count (section 5, "dish_ratings").
 */
function ratingTotals(householdId: number) {
	return db()
		.select({
			dishId: dishRatings.dishId,
			average: sql<number>`avg(${dishRatings.stars})`.as('rating_average'),
			count: sql<number>`count(*)`.as('rating_count')
		})
		.from(dishRatings)
		.where(eq(dishRatings.householdId, householdId))
		.groupBy(dishRatings.dishId)
		.as('rating_totals');
}

/** The joined totals, which are empty for a dish nobody has rated. */
function ratingOf(average: number | null, count: number | null): DishRating | null {
	return average === null || count === null ? null : { average, count };
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
	const ratings = ratingTotals(householdId);
	const row = db()
		.select({ ...detailFields, ratingAverage: ratings.average, ratingCount: ratings.count })
		.from(dishes)
		.leftJoin(ratings, eq(ratings.dishId, dishes.id))
		.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
		.get();
	if (!row) error(404, 'Not found');
	const { ratingAverage, ratingCount, ...dish } = row;

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
	return { ...dish, rating: ratingOf(ratingAverage, ratingCount), tags, ingredients };
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

/** The Recipes page's orders (section 7, "Recipes"). */
export const DISH_SORTS = ['name', 'rating'] as const;
export type DishSort = (typeof DISH_SORTS)[number];

// Sorted in code rather than in SQL, so "Éclairs" sorts with the E's.
function byName(a: DishSummary, b: DishSummary): number {
	return a.name.localeCompare(b.name);
}

/** The exact average, not the rounded one shown, highest first; unrated last; ties by name. */
function byRating(a: DishSummary, b: DishSummary): number {
	// Unrated counts as 0, below the lowest rating of 1 star.
	const difference = (b.rating?.average ?? 0) - (a.rating?.average ?? 0);
	return difference === 0 ? byName(a, b) : difference;
}

/**
 * The Recipes page: active dishes, or archived ones, sorted by name or rating. `search` matches
 * anywhere in the name and `tag` matches a tag, both ignoring case.
 */
export function listDishes(
	householdId: number,
	filter: { search: string; tag: string | null; archived: boolean; sort: DishSort }
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
	const ratings = ratingTotals(householdId);

	return db()
		.select({
			id: dishes.id,
			name: dishes.name,
			photoKey: dishes.photoKey,
			prepMinutes: dishes.prepMinutes,
			cookMinutes: dishes.cookMinutes,
			tried: dishes.tried,
			archivedAt: dishes.archivedAt,
			steps: dishes.steps,
			ingredientCount: ingredientCounts.count,
			ratingAverage: ratings.average,
			ratingCount: ratings.count
		})
		.from(dishes)
		.leftJoin(ingredientCounts, eq(ingredientCounts.dishId, dishes.id))
		.leftJoin(ratings, eq(ratings.dishId, dishes.id))
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
		.map(({ steps, ingredientCount, ratingAverage, ratingCount, ...dish }) => ({
			...dish,
			rating: ratingOf(ratingAverage, ratingCount),
			tags: tags.get(dish.id) ?? [],
			// The same test as the recipe page.
			hasRecipe: ingredientCount !== null || splitSteps(steps).length > 0
		}))
		.sort(filter.sort === 'rating' ? byRating : byName);
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
