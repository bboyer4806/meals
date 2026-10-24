import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
	DINNER_LABEL_MAX,
	DINNER_NOTE_MAX,
	DINNER_TYPES,
	DISH_ROLES,
	hasDishes,
	isDate,
	MAX_DINNERS,
	NO_DISHES,
	type DinnerType,
	type DishRole
} from '../../menu.ts';
import { MAX_SERVINGS } from '../../recipe-view.ts';
import { foldCase, normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dinnerDishes, dinners, dishes } from '../db/schema.ts';
import { findDishByName, insertDish } from './dishes.ts';
import { getHousehold } from './households.ts';

// The menu: a date's dinners (up to 5, labeled when there's more than one), their dishes and
// roles, Copy a dinner and Move to another date (design 6.9). A date with no dinner isn't planned.
//
// A change to one dinner names it by id, the one the page showed, so it never lands on another
// dinner someone put on the date meanwhile (6.11). A change that can plan the date takes null
// for a page that showed it not planned.

// The recipe editor's limit for a dish name.
const MAX_DISH_NAME = 80;

const CHANGED = 'Someone changed this dinner since you opened it.';

export type DinnerDish = { dishId: number; name: string; role: DishRole; archived: boolean };

export type Dinner = {
	id: number;
	date: string;
	/** Set only when the date has more than one dinner. */
	label: string | null;
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

/** The date's dinners in the order they were added. */
function dinnersOn(householdId: number, date: string) {
	return db()
		.select({ id: dinners.id, label: dinners.label, type: dinners.type })
		.from(dinners)
		.where(and(eq(dinners.householdId, householdId), eq(dinners.date, date)))
		.orderBy(asc(dinners.id))
		.all();
}

/** A dinner on the date, by id. Not found when someone cleared or moved it. */
function requireDinner(householdId: number, date: string, dinnerId: number) {
	const dinner = dinnersOn(householdId, date).find((candidate) => candidate.id === dinnerId);
	if (!dinner) error(404, 'Not found');
	return dinner;
}

/**
 * The dinner a change is for: the one the page showed while it's still on the date, or null
 * when the date has no dinner (the page showed none, or the one it showed was cleared or moved,
 * and the change plans the date again). Refuses a change meant for a dinner that isn't on the
 * date while others are.
 */
function shownDinner(householdId: number, date: string, shownId: number | null) {
	requireDate(date);
	const day = dinnersOn(householdId, date);
	const dinner = day.find((candidate) => candidate.id === shownId);
	if (dinner) return dinner;
	if (day.length > 0) error(400, CHANGED);
	return null;
}

/**
 * A dinner's label for a date with `count` dinners: none when it's the only one, and otherwise
 * required, up to 30 characters and unlike the date's other labels, ignoring case (6.9).
 */
function checkLabel(label: string | null, count: number, others: (string | null)[]): string | null {
	if (count === 1) return null;
	const named = normalizeName(label ?? '');
	if (named === '') error(400, 'Enter a label for each dinner');
	if (named.length > DINNER_LABEL_MAX) {
		error(400, `Keep a label under ${DINNER_LABEL_MAX} characters`);
	}
	if (others.some((other) => other !== null && foldCase(other) === foldCase(named))) {
		error(400, 'Give each dinner on this day a different label');
	}
	return named;
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

/**
 * The dinners from startDate to endDate inclusive, by date, and each date's in the order they
 * were added. Dates without one are left out.
 */
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
			label: dinners.label,
			type: dinners.type,
			note: dinners.note,
			servings: dinners.servings
		})
		.from(dinners)
		.where(inRange)
		.orderBy(asc(dinners.date), asc(dinners.id))
		.all()
		.map((dinner) => ({ ...dinner, dishes: byDinner.get(dinner.id) ?? [] }));
}

/** A date's dinners in the order they were added; none when it isn't planned. */
export function getDay(householdId: number, date: string): Dinner[] {
	return getDinners(householdId, date, date);
}

/**
 * Updates the dinner the page showed, or plans the date with it (dinnerId null, or the shown
 * one is gone). A type without dishes (Eating out, Leftovers) removes the dinner's dishes; the
 * page asks first (2.3). The label counts only on a date with more than one dinner. Returns the
 * dinner's id.
 */
export function saveDinner(
	householdId: number,
	date: string,
	dinnerId: number | null,
	fields: { label: string | null; type: DinnerType; note: string | null; servings: number },
	now: number
): number {
	return transaction(() => {
		const dinner = shownDinner(householdId, date, dinnerId);
		if (!Number.isInteger(fields.servings)) error(400, 'Enter a whole number of servings');
		if (fields.servings < 1) error(400, 'Enter at least 1 serving');
		if (fields.servings > MAX_SERVINGS) error(400, `Enter ${MAX_SERVINGS} servings or fewer`);
		if (fields.note !== null && fields.note.length > DINNER_NOTE_MAX) {
			error(400, `Keep the note under ${DINNER_NOTE_MAX} characters`);
		}

		if (!dinner) {
			// Listed one by one, so nothing else in `fields` is ever written.
			const values = { type: fields.type, note: fields.note, servings: fields.servings };
			return db()
				.insert(dinners)
				.values({ ...values, householdId, date, createdAt: now, updatedAt: now })
				.returning({ id: dinners.id })
				.get().id;
		}
		const day = dinnersOn(householdId, date);
		const others = day.filter((other) => other.id !== dinner.id).map((other) => other.label);
		const label = checkLabel(fields.label, day.length, others);
		db()
			.update(dinners)
			.set({
				label,
				type: fields.type,
				note: fields.note,
				servings: fields.servings,
				updatedAt: now
			})
			.where(eq(dinners.id, dinner.id))
			.run();
		if (!hasDishes(fields.type)) {
			db().delete(dinnerDishes).where(eq(dinnerDishes.dinnerId, dinner.id)).run();
		}
		return dinner.id;
	});
}

/**
 * Adds another dinner to a planned date: Cooking at home at the usual servings, with an empty
 * note and no dishes (6.9). The second dinner also labels the first, since every dinner on a
 * date with more than one has a label: `labels.first` is the first one's label then, and null
 * otherwise. Returns the new dinner's id.
 */
export function addDinner(
	householdId: number,
	date: string,
	labels: { first: string | null; added: string },
	now: number
): number {
	return transaction(() => {
		requireDate(date);
		const day = dinnersOn(householdId, date);
		if (day.length === 0) error(400, 'Plan this date before adding another dinner');
		if (day.length >= MAX_DINNERS) error(400, `A day can have up to ${MAX_DINNERS} dinners`);
		// The page asks for the first dinner's label only when it's the date's only one.
		if ((day.length === 1) !== (labels.first !== null)) error(400, CHANGED);

		const count = day.length + 1;
		const first = day[0];
		if (day.length === 1 && first) {
			const label = checkLabel(labels.first, count, []);
			db().update(dinners).set({ label, updatedAt: now }).where(eq(dinners.id, first.id)).run();
		}
		const others = dinnersOn(householdId, date).map((other) => other.label);
		const label = checkLabel(labels.added, count, others);
		const dinnerId = insertDinner(householdId, date, 'cook', now);
		db().update(dinners).set({ label }).where(eq(dinners.id, dinnerId)).run();
		return dinnerId;
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

/**
 * The dinner a dish can be added to, or null for a date with no dinner. Refuses a type without
 * dishes and a dish that's already on it.
 */
function dinnerForDish(
	householdId: number,
	date: string,
	dinnerId: number | null,
	dish: { id: number; name: string } | null
): { id: number } | null {
	const dinner = shownDinner(householdId, date, dinnerId);
	if (!dinner) return null;
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
	dinner: { id: number } | null,
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
 * with the household's usual servings and no ingredients) to the dinner. A date with no dinner
 * gets one: Cooking at home at the household's usual servings. Refuses (400) a dinner type
 * without dishes, a dish already on the dinner, an archived dish by id, and a blank or too-long
 * name. An archived dish by name changes nothing and returns 'archived' so the page can offer
 * to restore it.
 */
export function addDinnerDish(
	householdId: number,
	date: string,
	dinnerId: number | null,
	dish: { id: number } | { name: string },
	role: DishRole,
	now: number
): AddDishResult {
	return transaction(() => {
		if ('id' in dish) {
			const found = findDish(householdId, dish.id);
			const dinner = dinnerForDish(householdId, date, dinnerId, found);
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
		const dinner = dinnerForDish(householdId, date, dinnerId, found ?? null);
		// Its name stays taken, so adding it offers to restore it instead (6.10).
		if (found && found.archivedAt !== null) {
			return { kind: 'archived', dishId: found.id, name: found.name };
		}
		const dishId = found?.id ?? insertDish(householdId, name, now);
		insertDinnerDish(householdId, date, dinner, dishId, role, now);
		return { kind: 'added' };
	});
}

/** Restores an archived dish and adds it to the dinner, in one transaction. */
export function restoreAndAddDinnerDish(
	householdId: number,
	date: string,
	dinnerId: number | null,
	dishId: number,
	role: DishRole,
	now: number
): void {
	transaction(() => {
		const found = findDish(householdId, dishId);
		const dinner = dinnerForDish(householdId, date, dinnerId, found);
		if (found.archivedAt !== null) {
			db().update(dishes).set({ archivedAt: null }).where(eq(dishes.id, found.id)).run();
		}
		insertDinnerDish(householdId, date, dinner, found.id, role, now);
	});
}

export function setDinnerDishRole(
	householdId: number,
	date: string,
	dinnerId: number,
	dishId: number,
	role: DishRole,
	now: number
): void {
	transaction(() => {
		const dinner = requireDinner(householdId, date, dinnerId);
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
	dinnerId: number,
	dishId: number,
	now: number
): void {
	transaction(() => {
		const dinner = requireDinner(householdId, date, dinnerId);
		const result = db()
			.delete(dinnerDishes)
			.where(and(eq(dinnerDishes.dinnerId, dinner.id), eq(dinnerDishes.dishId, dishId)))
			.run();
		if (result.changes === 0) error(404, 'Not found');
		touch(dinner.id, now);
	});
}

/**
 * Deletes the dinner (and its dishes). Nothing to do when the date has no dinner. The last
 * dinner left on the date loses its label (6.9).
 */
export function clearDinner(
	householdId: number,
	date: string,
	dinnerId: number | null,
	now: number
): void {
	transaction(() => {
		const dinner = shownDinner(householdId, date, dinnerId);
		if (!dinner) return;
		// Its dinner_dishes go with it (on delete cascade).
		db().delete(dinners).where(eq(dinners.id, dinner.id)).run();
		const day = dinnersOn(householdId, date);
		const last = day[0];
		if (day.length === 1 && last) {
			db()
				.update(dinners)
				.set({ label: null, updatedAt: now })
				.where(eq(dinners.id, last.id))
				.run();
		}
	});
}

/**
 * Moves all of a date's dinners to another date, and that date's dinners to this one (2.2.2).
 * They move together, so each date keeps its labels. `shownId` is one the page showed; not
 * found when the date has no dinner.
 */
export function moveDinners(
	householdId: number,
	from: string,
	to: string,
	shownId: number | null,
	now: number
): void {
	transaction(() => {
		requireDate(to);
		if (!shownDinner(householdId, from, shownId)) error(404, 'Not found');
		if (from === to) return;
		const moving = dinnersOn(householdId, from).map((dinner) => dinner.id);
		const other = dinnersOn(householdId, to).map((dinner) => dinner.id);
		const moveTo = (ids: number[], date: string) =>
			db().update(dinners).set({ date, updatedAt: now }).where(inArray(dinners.id, ids)).run();
		moveTo(moving, to);
		moveTo(other, from);
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
 * Sets the dinner's type and dishes (with roles) from another dinner, keeping its label, note
 * and servings; a new dinner gets the usual servings (2.3). Archived dishes aren't copied.
 */
export function copyDinner(
	householdId: number,
	date: string,
	dinnerId: number | null,
	sourceDinnerId: number,
	now: number
): void {
	transaction(() => {
		const source = db()
			.select({ id: dinners.id, type: dinners.type })
			.from(dinners)
			.where(and(eq(dinners.id, sourceDinnerId), eq(dinners.householdId, householdId)))
			.get();
		if (!source) error(404, 'Not found');
		const target = shownDinner(householdId, date, dinnerId);
		// Copying a dinner onto itself would only drop its archived dishes.
		if (target?.id === source.id) return;

		const copied = hasDishes(source.type)
			? dinnerDishRows(and(eq(dinnerDishes.dinnerId, source.id), isNull(dishes.archivedAt)))
			: [];
		let targetId: number;
		if (target) {
			targetId = target.id;
			db()
				.update(dinners)
				.set({ type: source.type, updatedAt: now })
				.where(eq(dinners.id, targetId))
				.run();
			db().delete(dinnerDishes).where(eq(dinnerDishes.dinnerId, targetId)).run();
		} else {
			targetId = insertDinner(householdId, date, source.type, now);
		}
		// Inserted in display order, so the copy lists them the same way.
		const rows = copied
			.sort(byRole)
			.map(({ dishId, role }) => ({ householdId, dinnerId: targetId, dishId, role }));
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
