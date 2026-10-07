import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
	DINNER_NOTE_MAX,
	DINNER_TYPES,
	DISH_ROLES,
	hasDishes,
	isDate,
	type DinnerType,
	type DishRole
} from '../../menu.ts';
import { MAX_SERVINGS } from '../../recipe-view.ts';
import { normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dinnerDishes, dinners, dishes } from '../db/schema.ts';
import { getHousehold } from './households.ts';

// The menu: one dinner per date, its dishes and their roles, Copy a dinner and Move to another
// date (design 6.9). A date with no dinner isn't planned.

// The recipe editor's limit for a dish name.
const MAX_DISH_NAME = 80;
const NO_DISHES = 'Switch to Cooking at home or Going somewhere to add dishes';

export type DinnerDish = { dishId: number; name: string; role: DishRole; archived: boolean };

export type Dinner = {
	id: number;
	date: string;
	type: DinnerType;
	note: string | null;
	servings: number;
	/** By role (DISH_ROLES order), then in the order they were added. */
	dishes: DinnerDish[];
};

export type AddDishResult = { kind: 'added' } | { kind: 'archived'; dishId: number; name: string };

export type CopyGroup = {
	/** The group's most recent dinner, which Copy uses for the type and roles. */
	dinnerId: number;
	dishes: { name: string; role: DishRole }[];
	timesMade: number;
	lastMade: string;
};

/** Main, Side, Dessert, Other (6.9). The sort is stable, so each role keeps the order added. */
function byRole(a: { role: DishRole }, b: { role: DishRole }): number {
	return DISH_ROLES.indexOf(a.role) - DISH_ROLES.indexOf(b.role);
}

function requireDate(date: string): void {
	if (!isDate(date)) error(400, 'Pick a date');
}

function dinnerOn(householdId: number, date: string) {
	return db()
		.select({ id: dinners.id, type: dinners.type })
		.from(dinners)
		.where(and(eq(dinners.householdId, householdId), eq(dinners.date, date)))
		.get();
}

function requireDinnerOn(householdId: number, date: string): { id: number; type: DinnerType } {
	const dinner = dinnerOn(householdId, date);
	if (!dinner) error(404, 'Not found');
	return dinner;
}

/** A new dinner starts at the household's usual servings (Q28). */
function insertDinner(householdId: number, date: string, type: DinnerType, now: number): number {
	const servings = getHousehold(householdId).defaultServings;
	return db()
		.insert(dinners)
		.values({ householdId, date, type, note: null, servings, createdAt: now, updatedAt: now })
		.returning({ id: dinners.id })
		.get().id;
}

function touch(dinnerId: number, now: number): void {
	db().update(dinners).set({ updatedAt: now }).where(eq(dinners.id, dinnerId)).run();
}

/** Dishes on the dinners that `where` picks, in the order they were added. */
function dinnerDishRows(where: SQL | undefined) {
	return db()
		.select({
			dinnerId: dinnerDishes.dinnerId,
			dishId: dishes.id,
			name: dishes.name,
			role: dinnerDishes.role,
			archivedAt: dishes.archivedAt
		})
		.from(dinnerDishes)
		.innerJoin(dinners, eq(dinners.id, dinnerDishes.dinnerId))
		.innerJoin(dishes, eq(dishes.id, dinnerDishes.dishId))
		.where(where)
		.orderBy(asc(dinnerDishes.id))
		.all();
}

/** The dinners from startDate to endDate inclusive, by date. Dates without one are left out. */
export function getDinners(householdId: number, startDate: string, endDate: string): Dinner[] {
	const inRange = and(
		eq(dinners.householdId, householdId),
		gte(dinners.date, startDate),
		lte(dinners.date, endDate)
	);
	const byDinner = new Map<number, DinnerDish[]>();
	for (const { dinnerId, archivedAt, ...row } of dinnerDishRows(inRange).sort(byRole)) {
		const dish = { ...row, archived: archivedAt !== null };
		const list = byDinner.get(dinnerId);
		if (list) list.push(dish);
		else byDinner.set(dinnerId, [dish]);
	}
	return db()
		.select({
			id: dinners.id,
			date: dinners.date,
			type: dinners.type,
			note: dinners.note,
			servings: dinners.servings
		})
		.from(dinners)
		.where(inRange)
		.orderBy(asc(dinners.date))
		.all()
		.map((dinner) => ({ ...dinner, dishes: byDinner.get(dinner.id) ?? [] }));
}

export function getDinner(householdId: number, date: string): Dinner | null {
	return getDinners(householdId, date, date)[0] ?? null;
}

/**
 * Creates or updates the dinner on a date. A type without dishes (Eating out, Leftovers)
 * removes the dinner's dishes; the page asks first (2.3).
 */
export function saveDinner(
	householdId: number,
	date: string,
	fields: { type: DinnerType; note: string | null; servings: number },
	now: number
): void {
	transaction(() => {
		requireDate(date);
		if (!Number.isInteger(fields.servings)) error(400, 'Enter a whole number of servings');
		if (fields.servings < 1) error(400, 'Enter at least 1 serving');
		if (fields.servings > MAX_SERVINGS) error(400, `Enter ${MAX_SERVINGS} servings or fewer`);
		if (fields.note !== null && fields.note.length > DINNER_NOTE_MAX) {
			error(400, `Keep the note under ${DINNER_NOTE_MAX} characters`);
		}
		// Listed one by one, so nothing else in `fields` is ever written.
		const values = { type: fields.type, note: fields.note, servings: fields.servings };

		const dinner = dinnerOn(householdId, date);
		if (!dinner) {
			db()
				.insert(dinners)
				.values({ ...values, householdId, date, createdAt: now, updatedAt: now })
				.run();
			return;
		}
		db()
			.update(dinners)
			.set({ ...values, updatedAt: now })
			.where(eq(dinners.id, dinner.id))
			.run();
		if (!hasDishes(fields.type)) {
			db().delete(dinnerDishes).where(eq(dinnerDishes.dinnerId, dinner.id)).run();
		}
	});
}

function findDish(householdId: number, dishId: number) {
	const dish = db()
		.select({ id: dishes.id, name: dishes.name, archivedAt: dishes.archivedAt })
		.from(dishes)
		.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
		.get();
	if (!dish) error(404, 'Not found');
	return dish;
}

/** Names are unique per household ignoring case, archived dishes included (2.3, 6.10). */
function findDishByName(householdId: number, name: string) {
	return db()
		.select({ id: dishes.id, name: dishes.name, archivedAt: dishes.archivedAt })
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), sql`fold(${dishes.name}) = fold(${name})`))
		.get();
}

/** A dish made by name from the menu has the usual servings and no recipe yet (2.3). */
function insertDish(householdId: number, name: string, now: number): number {
	const servings = getHousehold(householdId).defaultServings;
	return db()
		.insert(dishes)
		.values({ householdId, name, servings, createdAt: now, updatedAt: now })
		.returning({ id: dishes.id })
		.get().id;
}

/**
 * The dinner a dish can be added to, if the date has one. Refuses a type without dishes and a
 * dish that's already on it.
 */
function dinnerForDish(
	householdId: number,
	date: string,
	dish: { id: number; name: string } | null
): { id: number } | undefined {
	requireDate(date);
	const dinner = dinnerOn(householdId, date);
	if (!dinner) return undefined;
	if (!hasDishes(dinner.type)) error(400, NO_DISHES);
	if (dish && isOnDinner(dinner.id, dish.id)) {
		error(400, `${dish.name} is already on this dinner`);
	}
	return dinner;
}

function isOnDinner(dinnerId: number, dishId: number): boolean {
	const row = db()
		.select({ id: dinnerDishes.id })
		.from(dinnerDishes)
		.where(and(eq(dinnerDishes.dinnerId, dinnerId), eq(dinnerDishes.dishId, dishId)))
		.get();
	return row !== undefined;
}

/** Adds the dish, first making the dinner when the date has none: Cooking at home. */
function insertDinnerDish(
	householdId: number,
	date: string,
	dinner: { id: number } | undefined,
	dishId: number,
	role: DishRole,
	now: number
): void {
	const dinnerId = dinner?.id ?? insertDinner(householdId, date, 'cook', now);
	db().insert(dinnerDishes).values({ householdId, dinnerId, dishId, role }).run();
	touch(dinnerId, now);
}

/**
 * Adds an existing dish (by id) or a dish by name (an existing one ignoring case, or a new one
 * with the household's usual servings and no ingredients). A date with no dinner gets one:
 * Cooking at home at the household's usual servings. Refuses (400) a dinner type without
 * dishes, a dish already on the dinner, an archived dish by id, and a blank or too-long name.
 * An archived dish by name changes nothing and returns 'archived' so the page can offer to
 * restore it.
 */
export function addDinnerDish(
	householdId: number,
	date: string,
	dish: { id: number } | { name: string },
	role: DishRole,
	now: number
): AddDishResult {
	return transaction(() => {
		if ('id' in dish) {
			const found = findDish(householdId, dish.id);
			const dinner = dinnerForDish(householdId, date, found);
			// Archived dishes are hidden from the suggestions (6.10), so this one was archived
			// after the page loaded.
			if (found.archivedAt !== null) error(400, `Restore ${found.name} before adding it`);
			insertDinnerDish(householdId, date, dinner, found.id, role, now);
			return { kind: 'added' };
		}

		const name = normalizeName(dish.name);
		if (name === '') error(400, 'Enter a dish name');
		if (name.length > MAX_DISH_NAME) {
			error(400, `Keep a dish name under ${MAX_DISH_NAME} characters`);
		}
		const found = findDishByName(householdId, name);
		const dinner = dinnerForDish(householdId, date, found ?? null);
		// Its name stays taken, so adding it offers to restore it instead (6.10).
		if (found && found.archivedAt !== null) {
			return { kind: 'archived', dishId: found.id, name: found.name };
		}
		const dishId = found?.id ?? insertDish(householdId, name, now);
		insertDinnerDish(householdId, date, dinner, dishId, role, now);
		return { kind: 'added' };
	});
}

/** Restores an archived dish and adds it, in one transaction. */
export function restoreAndAddDinnerDish(
	householdId: number,
	date: string,
	dishId: number,
	role: DishRole,
	now: number
): void {
	transaction(() => {
		const found = findDish(householdId, dishId);
		const dinner = dinnerForDish(householdId, date, found);
		if (found.archivedAt !== null) {
			db().update(dishes).set({ archivedAt: null }).where(eq(dishes.id, found.id)).run();
		}
		insertDinnerDish(householdId, date, dinner, found.id, role, now);
	});
}

export function setDinnerDishRole(
	householdId: number,
	date: string,
	dishId: number,
	role: DishRole,
	now: number
): void {
	transaction(() => {
		const dinner = requireDinnerOn(householdId, date);
		const result = db()
			.update(dinnerDishes)
			.set({ role })
			.where(and(eq(dinnerDishes.dinnerId, dinner.id), eq(dinnerDishes.dishId, dishId)))
			.run();
		if (result.changes === 0) error(404, 'Not found');
		touch(dinner.id, now);
	});
}

export function removeDinnerDish(
	householdId: number,
	date: string,
	dishId: number,
	now: number
): void {
	transaction(() => {
		const dinner = requireDinnerOn(householdId, date);
		const result = db()
			.delete(dinnerDishes)
			.where(and(eq(dinnerDishes.dinnerId, dinner.id), eq(dinnerDishes.dishId, dishId)))
			.run();
		if (result.changes === 0) error(404, 'Not found');
		touch(dinner.id, now);
	});
}

/** Deletes the dinner (and its dishes). Nothing to do when the date has none. */
export function clearDinner(householdId: number, date: string): void {
	// Its dinner_dishes go with it (on delete cascade).
	db()
		.delete(dinners)
		.where(and(eq(dinners.householdId, householdId), eq(dinners.date, date)))
		.run();
}

/** Moves a dinner to another date; if that date has one, the two swap (2.2.2). */
export function moveDinner(householdId: number, from: string, to: string, now: number): void {
	transaction(() => {
		requireDate(from);
		requireDate(to);
		const moving = requireDinnerOn(householdId, from);
		if (from === to) return;
		const other = dinnerOn(householdId, to);
		if (other) {
			// SQLite checks the unique date after each row it changes, so swapping in one
			// statement would fail. The moving dinner steps aside first. Nothing else can
			// write meanwhile, since the transaction holds the write lock.
			db().update(dinners).set({ date: 'moving' }).where(eq(dinners.id, moving.id)).run();
			db()
				.update(dinners)
				.set({ date: from, updatedAt: now })
				.where(eq(dinners.id, other.id))
				.run();
		}
		db().update(dinners).set({ date: to, updatedAt: now }).where(eq(dinners.id, moving.id)).run();
	});
}

/**
 * Past dinners (dated today or earlier) with dishes, grouped by their exact set of
 * non-archived dishes, most made first, then most recently made (6.9).
 */
export function listCopyGroups(householdId: number, today: string): CopyGroup[] {
	const rows = db()
		.select({
			dinnerId: dinners.id,
			date: dinners.date,
			dishId: dishes.id,
			name: dishes.name,
			role: dinnerDishes.role
		})
		.from(dinnerDishes)
		.innerJoin(dinners, eq(dinners.id, dinnerDishes.dinnerId))
		.innerJoin(dishes, eq(dishes.id, dinnerDishes.dishId))
		.where(
			and(
				eq(dinners.householdId, householdId),
				lte(dinners.date, today),
				inArray(dinners.type, DINNER_TYPES.filter(hasDishes)),
				// An archived dish can't be copied, so it doesn't set dinners apart either.
				isNull(dishes.archivedAt)
			)
		)
		.orderBy(desc(dinners.date), asc(dinnerDishes.id))
		.all();

	// Newest dinner first, each with its dishes in the order they were added.
	const byDinner = new Map<number, { date: string; dishes: typeof rows }>();
	for (const row of rows) {
		const dinner = byDinner.get(row.dinnerId);
		if (dinner) dinner.dishes.push(row);
		else byDinner.set(row.dinnerId, { date: row.date, dishes: [row] });
	}

	const groups = new Map<string, CopyGroup>();
	for (const [dinnerId, dinner] of byDinner) {
		const key = dinner.dishes
			.map((dish) => dish.dishId)
			.sort((a, b) => a - b)
			.join(',');
		const group = groups.get(key);
		if (group) {
			group.timesMade += 1;
		} else {
			// The first dinner seen is the group's most recent one.
			groups.set(key, {
				dinnerId,
				dishes: dinner.dishes.sort(byRole).map(({ name, role }) => ({ name, role })),
				timesMade: 1,
				lastMade: dinner.date
			});
		}
	}
	// YYYY-MM-DD dates sort as text.
	return [...groups.values()].sort(
		(a, b) => b.timesMade - a.timesMade || b.lastMade.localeCompare(a.lastMade)
	);
}

/**
 * Sets the dinner's type and dishes (with roles) from another dinner, keeping this date's note
 * and servings; a new dinner gets the usual servings (2.3). Archived dishes aren't copied.
 */
export function copyDinner(
	householdId: number,
	date: string,
	sourceDinnerId: number,
	now: number
): void {
	transaction(() => {
		requireDate(date);
		const source = db()
			.select({ id: dinners.id, type: dinners.type })
			.from(dinners)
			.where(and(eq(dinners.id, sourceDinnerId), eq(dinners.householdId, householdId)))
			.get();
		if (!source) error(404, 'Not found');
		const target = dinnerOn(householdId, date);
		// Copying a dinner onto itself would only drop its archived dishes.
		if (target?.id === source.id) return;

		const copied = hasDishes(source.type)
			? dinnerDishRows(and(eq(dinnerDishes.dinnerId, source.id), isNull(dishes.archivedAt)))
			: [];
		let dinnerId: number;
		if (target) {
			dinnerId = target.id;
			db()
				.update(dinners)
				.set({ type: source.type, updatedAt: now })
				.where(eq(dinners.id, dinnerId))
				.run();
			db().delete(dinnerDishes).where(eq(dinnerDishes.dinnerId, dinnerId)).run();
		} else {
			dinnerId = insertDinner(householdId, date, source.type, now);
		}
		// Inserted in display order, so the copy lists them the same way.
		const rows = copied
			.sort(byRole)
			.map(({ dishId, role }) => ({ householdId, dinnerId, dishId, role }));
		if (rows.length > 0) db().insert(dinnerDishes).values(rows).run();
	});
}

/** Active dishes for the dish field's suggestions: how many dinners use each, most first. */
export function dishSuggestions(
	householdId: number
): { id: number; name: string; timesAdded: number }[] {
	// A join rather than a subquery in the select: Drizzle leaves column names unqualified in a
	// query on one table, so a subquery couldn't name the outer dish.
	const uses = db()
		.select({
			dishId: dinnerDishes.dishId,
			count: sql<number>`count(*)`.as('count')
		})
		.from(dinnerDishes)
		.where(eq(dinnerDishes.householdId, householdId))
		.groupBy(dinnerDishes.dishId)
		.as('uses');
	return db()
		.select({
			id: dishes.id,
			name: dishes.name,
			timesAdded: sql<number>`coalesce(${uses.count}, 0)`
		})
		.from(dishes)
		.leftJoin(uses, eq(uses.dishId, dishes.id))
		.where(and(eq(dishes.householdId, householdId), isNull(dishes.archivedAt)))
		.all()
		.sort((a, b) => b.timesAdded - a.timesAdded || a.name.localeCompare(b.name));
}
