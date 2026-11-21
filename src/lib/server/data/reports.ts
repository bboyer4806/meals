import { and, desc, eq, gte, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { addDays, type DinnerType } from '../../menu.ts';
import { FAVORITE_TIMES, FORGOTTEN_DAYS } from '../../reports.ts';
import { foldCase } from '../../text.ts';
import { db } from '../db/index.ts';
import { dinnerDishes, dinners, dishes, groceryNeeds, items } from '../db/schema.ts';

// The Reports page (design 7, Reports; MEA-14): what the household planned, bought and ate out,
// worked out from its menu and grocery history as they are. Nothing here changes anything.
//
// A period's dinners are those dated from `start`, or from the first when it's null, through
// `today`, the household's dates: a dinner planned for a later date hasn't happened yet.

/** A dish or an item, and how many times it counts. */
export type Ranked = { id: number; name: string; count: number };

/** A restaurant, as most recently written, and how many dinners went to it. */
export type RankedRestaurant = { name: string; count: number };

/** A dish planned often but not lately, with how many times and the last date. */
export type ForgottenFavorite = Ranked & { lastPlanned: string };

/** Most first, then by name. Sorted in code rather than SQL, so "Éclairs" sorts with the E's. */
function byCount(a: { name: string; count: number }, b: { name: string; count: number }): number {
	return b.count - a.count || a.name.localeCompare(b.name);
}

/** The household's dinners in the period. */
function dinnersIn(householdId: number, start: string | null, today: string): SQL | undefined {
	return and(
		eq(dinners.householdId, householdId),
		start === null ? undefined : gte(dinners.date, start),
		lte(dinners.date, today)
	);
}

/**
 * Dishes by how many of the period's dinners they were on, whatever the dinner's type, most first.
 * Archived dishes count, since their dinners still happened (6.10).
 */
export function rankPlannedDishes(
	householdId: number,
	start: string | null,
	today: string
): Ranked[] {
	return db()
		.select({ id: dishes.id, name: dishes.name, count: sql<number>`count(*)` })
		.from(dinnerDishes)
		.innerJoin(dinners, eq(dinners.id, dinnerDishes.dinnerId))
		.innerJoin(dishes, eq(dishes.id, dinnerDishes.dishId))
		.where(dinnersIn(householdId, start, today))
		.groupBy(dishes.id)
		.all()
		.sort(byCount);
}

/**
 * Items by how many grocery lines were received for them, most first: each line once, whatever
 * its quantity, and the part a Got fewer received as a line of its own (6.2). A line counts by
 * when it was received, from `since` on (or ever, when it's null), and only while it's still
 * received. Archived items count, as their history stays (6.10).
 */
export function rankPurchasedItems(householdId: number, since: number | null): Ranked[] {
	return db()
		.select({ id: items.id, name: items.name, count: sql<number>`count(*)` })
		.from(groceryNeeds)
		.innerJoin(items, eq(items.id, groceryNeeds.itemId))
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				eq(groceryNeeds.status, 'received'),
				since === null ? undefined : gte(groceryNeeds.receivedAt, since)
			)
		)
		.groupBy(items.id)
		.all()
		.sort(byCount);
}

/**
 * Restaurants by how many of the period's Eating out dinners went to them, most first. Names
 * that differ only in case are one restaurant, written as its latest dinner has it. A dinner with
 * no restaurant doesn't count.
 */
export function rankRestaurants(
	householdId: number,
	start: string | null,
	today: string
): RankedRestaurant[] {
	const named = db()
		// Never null, since dinners without a restaurant are left out.
		.select({ name: sql<string>`${dinners.restaurantName}` })
		.from(dinners)
		.where(
			and(
				dinnersIn(householdId, start, today),
				eq(dinners.type, 'eat_out'),
				isNotNull(dinners.restaurantName)
			)
		)
		.orderBy(desc(dinners.date), desc(dinners.id))
		.all();
	const byName = new Map<string, RankedRestaurant>();
	for (const { name } of named) {
		const key = foldCase(name);
		const restaurant = byName.get(key);
		if (restaurant) restaurant.count += 1;
		else byName.set(key, { name, count: 1 });
	}
	return [...byName.values()].sort(byCount);
}

/** How many of the period's dinners are of each type, each dinner on its own. */
export function countDinnerTypes(
	householdId: number,
	start: string | null,
	today: string
): Record<DinnerType, number> {
	const counts: Record<DinnerType, number> = { cook: 0, eat_out: 0, going: 0, leftovers: 0 };
	const rows = db()
		.select({ type: dinners.type, count: sql<number>`count(*)` })
		.from(dinners)
		.where(dinnersIn(householdId, start, today))
		.groupBy(dinners.type)
		.all();
	for (const { type, count } of rows) counts[type] = count;
	return counts;
}

/**
 * Active dishes planned at least 3 times up to today, but not from 90 days before today on, most
 * planned first, each with its last date up to today. It doesn't depend on the page's period.
 */
export function listForgottenFavorites(householdId: number, today: string): ForgottenFavorite[] {
	const cutoff = addDays(today, -FORGOTTEN_DAYS);
	return db()
		.select({
			id: dishes.id,
			name: dishes.name,
			count: sql<number>`count(*)`,
			lastPlanned: sql<string>`max(${dinners.date})`
		})
		.from(dinnerDishes)
		.innerJoin(dinners, eq(dinners.id, dinnerDishes.dinnerId))
		.innerJoin(dishes, eq(dishes.id, dinnerDishes.dishId))
		.where(and(dinnersIn(householdId, null, today), isNull(dishes.archivedAt)))
		.groupBy(dishes.id)
		.all()
		// YYYY-MM-DD dates compare as text.
		.filter((dish) => dish.count >= FAVORITE_TIMES && dish.lastPlanned < cutoff)
		.sort(byCount);
}
