import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { addDays } from '../../menu.ts';
import { splitSteps } from '../../steps.ts';
import { foldCase, normalizeName } from '../../text.ts';
import { db, insertBatches, transaction } from '../db/index.ts';
import {
	dinnerDishes,
	dinners,
	dishes,
	dishIngredients,
	dishRatings,
	dishTags,
	items,
	users
} from '../db/schema.ts';
import { getHousehold } from './households.ts';
import { createItem, createItems, findItemByName, setItemArchived, type Item } from './items.ts';

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
 * What saving over a dish does to its photo: `keep` leaves it as it is, and otherwise the dish
 * takes `photoKey`, a new photo's key (photos.ts), or null for no photo.
 */
export type PhotoChange = 'keep' | { photoKey: string | null };

/**
 * `replacedPhotoKey` is the photo the save replaced or removed, whose files the caller deletes
 * once the save has committed, or null when there was none or it didn't change. `taken` names the
 * dish that already has the name, so the page can offer to restore it. `archived` names all the
 * archived items the recipe would start using, so the page can ask before restoring them (6.10).
 */
export type DishSaveResult =
	| { kind: 'saved'; id: number; replacedPhotoKey: string | null }
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

/** One person's stars for a dish, and who gave them: a member's name, or "Former member". */
export type PersonRating = { name: string; stars: number };

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

/** A dish as found by its name. */
export type DishName = { id: number; name: string; archivedAt: number | null };

const nameFields = { id: dishes.id, name: dishes.name, archivedAt: dishes.archivedAt };

/** Names are unique per household ignoring case, archived dishes included (design 2.3, 6.10). */
export function findDishByName(householdId: number, name: string): DishName | undefined {
	return db()
		.select(nameFields)
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), sql`fold(${dishes.name}) = fold(${name})`))
		.get();
}

/**
 * The household's dishes, archived ones included, by name with case folded, as findDishByName
 * matches names, for looking up many at once (MEA-89).
 */
export function dishesByName(householdId: number): Map<string, DishName> {
	const rows = db()
		.select(nameFields)
		.from(dishes)
		.where(eq(dishes.householdId, householdId))
		.all();
	return new Map(rows.map((dish) => [foldCase(dish.name), dish]));
}

/**
 * A dish made by name, from a dinner or a request, has the usual servings and no recipe yet, so
 * Recipes labels it "No recipe" (2.3, 6.12). Returns its id.
 */
export function insertDish(householdId: number, name: string, now: number): number {
	const servings = getHousehold(householdId).defaultServings;
	return db()
		.insert(dishes)
		.values({ householdId, name, servings, createdAt: now, updatedAt: now })
		.returning({ id: dishes.id })
		.get().id;
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
 * The dish's own fields, listed one by one, so nothing else in the input (a photo key, say) is
 * ever written, and its photo as `photo` changes it (MEA-87).
 */
function dishFields(input: DishInput, photo: PhotoChange) {
	return {
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
		fatG: input.fatG,
		...(photo === 'keep' ? {} : { photoKey: photo.photoKey })
	};
}

/** Writes an existing dish's new fields and removes its tags and ingredients, for new ones. */
function rewriteDish(dishId: number, input: DishInput, photo: PhotoChange, now: number): void {
	db()
		.update(dishes)
		.set({ ...dishFields(input, photo), updatedAt: now })
		.where(eq(dishes.id, dishId))
		.run();
	db().delete(dishTags).where(eq(dishTags.dishId, dishId)).run();
	db().delete(dishIngredients).where(eq(dishIngredients.dishId, dishId)).run();
}

/**
 * The dish's tags as rows. The database allows each tag once per dish, ignoring case. The first
 * spelling wins.
 */
function tagRows(householdId: number, dishId: number, tags: string[]) {
	const rows = new Map<string, { householdId: number; dishId: number; tag: string }>();
	for (const tag of tags) {
		const key = foldCase(tag);
		if (!rows.has(key)) rows.set(key, { householdId, dishId, tag });
	}
	return [...rows.values()];
}

/** The dish's ingredients as rows, in order, each naming its item by the id `itemId` gives. */
function ingredientRows(
	householdId: number,
	dishId: number,
	ingredients: IngredientInput[],
	itemId: (itemName: string) => number
) {
	return ingredients.map((ingredient, position) => ({
		householdId,
		dishId,
		position,
		section: ingredient.section,
		amount: ingredient.amount,
		unit: ingredient.unit,
		itemId: itemId(ingredient.itemName),
		prepNote: ingredient.prepNote
	}));
}

/**
 * Writes the dish with its photo and replaces its tags and ingredients, unless it would start
 * using an archived item that isn't in `restoreItemIds`. `dish` is the dish saved over, as it was
 * before, or null for a new one. Callers run it in a transaction, so the details and the photo are
 * saved together or not at all (MEA-87).
 */
function save(
	householdId: number,
	dish: { id: number; photoKey: string | null } | null,
	input: DishInput,
	photo: PhotoChange,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	const dishId = dish === null ? null : dish.id;
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

	let id: number;
	if (dishId === null) {
		id = db()
			.insert(dishes)
			.values({ ...dishFields(input, photo), householdId, createdAt: now, updatedAt: now })
			.returning({ id: dishes.id })
			.get().id;
	} else {
		id = dishId;
		rewriteDish(id, input, photo, now);
	}

	const tags = tagRows(householdId, id, input.tags);
	if (tags.length > 0) db().insert(dishTags).values(tags).run();
	const ingredients = ingredientRows(householdId, id, input.ingredients, (itemName) =>
		ingredientItem(householdId, itemName, now)
	);
	if (ingredients.length > 0) db().insert(dishIngredients).values(ingredients).run();

	const before = dish === null ? null : dish.photoKey;
	const replacedPhotoKey = photo === 'keep' || photo.photoKey === before ? null : before;
	return { kind: 'saved', id, replacedPhotoKey };
}

/**
 * Saves a new dish with the photo `photoKey` (photos.ts), or none for null. `restoreItemIds` are
 * the archived items the person agreed to restore. Ids of items the recipe doesn't start using
 * are ignored (6.10).
 */
export function createDish(
	householdId: number,
	input: DishInput,
	photoKey: string | null,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	return transaction(() => save(householdId, null, input, { photoKey }, restoreItemIds, now));
}

/**
 * Saves over a dish, changing its photo as `photo` says. `restoreItemIds` are the archived items
 * the person agreed to restore. Ids of items the recipe doesn't start using are ignored (6.10).
 */
export function updateDish(
	householdId: number,
	dishId: number,
	input: DishInput,
	photo: PhotoChange,
	restoreItemIds: number[],
	now: number
): DishSaveResult {
	return transaction(() =>
		save(householdId, findDish(householdId, dishId), input, photo, restoreItemIds, now)
	);
}

/**
 * The id of each item the ingredients name, by name with case folded: the catalog's, from
 * `items`, or a new one for a new name (Q1), spelled as the first ingredient that names it. The
 * new ones are added all at once. Throws for an archived item, which importing never restores.
 */
function importedItemIds(
	householdId: number,
	ingredients: IngredientInput[],
	items: Map<string, Item>,
	now: number
): Map<string, number> {
	const ids = new Map<string, number>();
	const newNames = new Map<string, string>();
	for (const ingredient of ingredients) {
		const name = normalizeName(ingredient.itemName);
		const key = foldCase(name);
		const item = items.get(key);
		if (item === undefined) {
			if (!newNames.has(key)) newNames.set(key, name);
		} else if (item.archivedAt !== null) {
			throw new Error(`${item.name} is archived`);
		} else {
			ids.set(key, item.id);
		}
	}
	for (const item of createItems(householdId, [...newNames.values()], now)) {
		ids.set(foldCase(item.name), item.id);
	}
	return ids;
}

/**
 * Adds new dishes all at once, as save() adds one, and gives each one's id by its name, which no
 * other dish has.
 */
function addDishes(householdId: number, inputs: DishInput[], now: number): Map<string, number> {
	const ids = new Map<string, number>();
	for (const batch of insertBatches(inputs)) {
		const added = db()
			.insert(dishes)
			.values(
				batch.map((input) => ({
					...dishFields(input, { photoKey: null }),
					householdId,
					createdAt: now,
					updatedAt: now
				}))
			)
			.returning({ id: dishes.id, name: dishes.name })
			.all();
		for (const { id, name } of added) ids.set(name, id);
	}
	return ids;
}

/** A recipe Import recipes saves: a new one, or new details for an existing one (design 7). */
export type ImportedDish = { dishId: number | null; input: DishInput };

/**
 * Saves Import recipes' recipes all at once (design 7, MEA-89): each new one as createDish saves
 * it with no photo, and each existing one's new details as updateDish saves them, keeping its
 * photo, with their tags and ingredients. `items` is the household's items by name
 * (itemsByName). Callers read it in the transaction they run this in, after checking that the new
 * names are free and that no ingredient names an archived item.
 */
export function importDishes(
	householdId: number,
	recipes: ImportedDish[],
	items: Map<string, Item>,
	now: number
): void {
	transaction(() => {
		const ingredients = recipes.flatMap(({ input }) => input.ingredients);
		const itemIds = importedItemIds(householdId, ingredients, items, now);
		const itemId = (itemName: string) => {
			const id = itemIds.get(foldCase(normalizeName(itemName)));
			if (id === undefined) throw new Error(`${itemName} has no item`);
			return id;
		};

		for (const { dishId, input } of recipes) {
			if (dishId === null) continue;
			findDish(householdId, dishId);
			rewriteDish(dishId, input, 'keep', now);
		}
		const newInputs = recipes.filter(({ dishId }) => dishId === null).map(({ input }) => input);
		const added = addDishes(householdId, newInputs, now);
		const saved = recipes.map(({ dishId, input }) => {
			const id = dishId ?? added.get(input.name);
			if (id === undefined) throw new Error(`${input.name} wasn't added`);
			return { id, input };
		});

		const tags = saved.flatMap(({ id, input }) => tagRows(householdId, id, input.tags));
		for (const batch of insertBatches(tags)) db().insert(dishTags).values(batch).run();
		const rows = saved.flatMap(({ id, input }) =>
			ingredientRows(householdId, id, input.ingredients, itemId)
		);
		for (const batch of insertBatches(rows)) db().insert(dishIngredients).values(batch).run();
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
 * Sets the person's own stars for the dish, or clears them for null. Nobody else's rating changes
 * (section 7, "Recipe"). Sending the same stars again keeps them, so a second tap sent before the
 * page showed the first doesn't undo it (MEA-86).
 */
export function rateDish(
	householdId: number,
	dishId: number,
	userId: number,
	stars: number | null
): void {
	transaction(() => {
		findDish(householdId, dishId);
		if (stars === null) {
			db()
				.delete(dishRatings)
				.where(and(eq(dishRatings.dishId, dishId), eq(dishRatings.userId, userId)))
				.run();
		} else {
			db()
				.insert(dishRatings)
				.values({ householdId, dishId, userId, stars })
				.onConflictDoUpdate({ target: [dishRatings.dishId, dishRatings.userId], set: { stars } })
				.run();
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
 * Everyone's stars for the dish, the signed-in person's included: members by name ignoring case,
 * then each removed member's as "Former member", in the order they rated. Removing a member
 * empties who rated (section 5, "dish_ratings"), so nothing says who they were. Showing who rated
 * is an exception to section 12, for the recipe page only (section 7, "Recipe").
 */
export function listDishRatings(householdId: number, dishId: number): PersonRating[] {
	return db()
		.select({ name: users.name, stars: dishRatings.stars })
		.from(dishRatings)
		.leftJoin(users, eq(users.id, dishRatings.userId))
		.where(and(eq(dishRatings.householdId, householdId), eq(dishRatings.dishId, dishId)))
		.orderBy(isNull(dishRatings.userId), asc(sql`lower(${users.name})`), asc(dishRatings.id))
		.all()
		.map(({ name, stars }) => ({ name: name ?? 'Former member', stars }));
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
 * anywhere in the name, and a dish needs every one of `tags`, both ignoring case. No tags is no
 * tag filter (section 7, "Recipes").
 */
export function listDishes(
	householdId: number,
	filter: { search: string; tags: string[]; archived: boolean; sort: DishSort }
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
				...filter.tags.map(
					(tag) => sql`exists (select 1 from ${dishTags} where ${dishTags.dishId} = ${dishes.id}
						and fold(${dishTags.tag}) = fold(${tag}))`
				)
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

/** A dish on the Menu this many days before today or fewer was recently made (MEA-246). */
const RECENT_DAYS = 60;

/** A dish in the Recipes page's Grouped view, with the last date it was on the Menu. */
export type MadeDishSummary = DishSummary & { lastMade: string };

/** The Recipes page's Grouped view (section 7, "Recipes"; MEA-246). */
export type DishGroups = {
	/** Last on the Menu 60 days before today or later, newest first. */
	recent: MadeDishSummary[];
	/** Last on the Menu earlier than that, oldest first. */
	longAgo: MadeDishSummary[];
	/** Never on the Menu up to today, A to Z. */
	never: DishSummary[];
};

/**
 * Each dish's last date on the Menu up to today. A dinner planned for a later date isn't made
 * yet. Dishes that were never on it are left out.
 */
function lastMadeDates(householdId: number, today: string): Map<number, string> {
	const rows = db()
		.select({ dishId: dinnerDishes.dishId, date: sql<string>`max(${dinners.date})` })
		.from(dinnerDishes)
		.innerJoin(dinners, eq(dinners.id, dinnerDishes.dinnerId))
		.where(and(eq(dinners.householdId, householdId), lte(dinners.date, today)))
		.groupBy(dinnerDishes.dishId)
		.all();
	return new Map(rows.map(({ dishId, date }) => [dishId, date]));
}

/**
 * The Recipes page's Grouped view: the active dishes the list shows for `search` and `tags`,
 * each in one group by its last date on the Menu up to `today`, the household's date (section 7,
 * "Recipes"). Equal dates fall back to name.
 */
export function groupDishesByLastMade(
	householdId: number,
	filter: { search: string; tags: string[] },
	today: string
): DishGroups {
	const lastMade = lastMadeDates(householdId, today);
	const cutoff = addDays(today, -RECENT_DAYS);
	const groups: DishGroups = { recent: [], longAgo: [], never: [] };
	for (const dish of listDishes(householdId, { ...filter, archived: false, sort: 'name' })) {
		const date = lastMade.get(dish.id);
		if (date === undefined) groups.never.push(dish);
		// YYYY-MM-DD dates compare and sort as text.
		else if (date >= cutoff) groups.recent.push({ ...dish, lastMade: date });
		else groups.longAgo.push({ ...dish, lastMade: date });
	}
	groups.recent.sort((a, b) => b.lastMade.localeCompare(a.lastMade) || byName(a, b));
	groups.longAgo.sort((a, b) => a.lastMade.localeCompare(b.lastMade) || byName(a, b));
	return groups;
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
