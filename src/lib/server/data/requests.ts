import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../../menu.ts';
import { normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';
import { findDishByName, insertDish } from './dishes.ts';

// Requests (design 6.12): anyone in the household asks for a dish or a restaurant, and anyone
// removes the request once it's been made. Each shows who asked. A dish request links to its
// recipe; a restaurant request is only the name typed, since restaurants aren't kept anywhere.

/** What every request shows: its name, the note if there is one, and who asked. */
type Shown = { id: number; name: string; note: string | null; askedBy: string };

/** Only a dish request links to a recipe, its dishId. */
export type DishRequest =
	| (Shown & { kind: 'dish'; dishId: number })
	| (Shown & { kind: 'restaurant' });

export type AddRequestResult = { kind: 'added' } | { kind: 'archived'; dishId: number; name: string };

/** The household's requests, dish and restaurant requests together, oldest first. */
export function listRequests(householdId: number): DishRequest[] {
	const rows = db()
		.select({
			id: dishRequests.id,
			kind: dishRequests.kind,
			name: dishRequests.name,
			note: dishRequests.note,
			dishId: dishRequests.dishId,
			askedBy: users.name
		})
		.from(dishRequests)
		.innerJoin(users, eq(users.id, dishRequests.userId))
		.where(eq(dishRequests.householdId, householdId))
		.orderBy(asc(dishRequests.createdAt), asc(dishRequests.id))
		.all();
	return rows.map(({ kind, dishId, ...shown }) => {
		if (kind === 'restaurant') return { kind, ...shown };
		// The database keeps a dish on every dish request (dish_requests_kind_dish).
		if (dishId === null) throw new Error(`Dish request ${shown.id} has no dish`);
		return { kind, dishId, ...shown };
	});
}

/** Whether any request links to the dish, made from its recipe's page or the Menu (6.12). */
export function hasRequest(householdId: number, dishId: number): boolean {
	const request = db()
		.select({ id: dishRequests.id })
		.from(dishRequests)
		.where(and(eq(dishRequests.householdId, householdId), eq(dishRequests.dishId, dishId)))
		.get();
	return request !== undefined;
}

/**
 * The name as it's kept, and the note. Refuses a blank name and anything too long, saying what
 * the name is for, such as "a dish name".
 */
function checkFields(fields: { name: string; note: string | null }, what: string) {
	const name = normalizeName(fields.name);
	if (name === '') error(400, `Enter ${what}`);
	if (name.length > REQUEST_NAME_MAX) {
		error(400, `Keep ${what} under ${REQUEST_NAME_MAX} characters`);
	}
	if (fields.note !== null && fields.note.length > REQUEST_NOTE_MAX) {
		error(400, `Keep the note under ${REQUEST_NOTE_MAX} characters`);
	}
	return { name, note: fields.note };
}

function insertDishRequest(
	householdId: number,
	userId: number,
	fields: { name: string; note: string | null },
	dishId: number,
	now: number
): void {
	db()
		.insert(dishRequests)
		.values({
			householdId,
			userId,
			kind: 'dish',
			name: fields.name,
			note: fields.note,
			dishId,
			createdAt: now
		})
		.run();
}

/**
 * Adds a request from the signed-in member, linked to its recipe: an active dish with the name,
 * ignoring case, or a new one with the household's usual servings, as a dish typed on a dinner
 * is (6.9, 6.12). An archived dish with the name changes nothing and returns 'archived', so the
 * page can offer to restore it (6.10).
 */
export function addRequest(
	householdId: number,
	userId: number,
	fields: { name: string; note: string | null },
	now: number
): AddRequestResult {
	return transaction(() => {
		const checked = checkFields(fields, 'a dish name');
		const found = findDishByName(householdId, checked.name);
		if (found && found.archivedAt !== null) {
			return { kind: 'archived', dishId: found.id, name: found.name };
		}
		const dishId = found?.id ?? insertDish(householdId, checked.name, now);
		insertDishRequest(householdId, userId, checked, dishId, now);
		return { kind: 'added' };
	});
}

/**
 * Adds a request from the signed-in member to eat out at a restaurant, named as typed. It looks
 * up and makes nothing, and links to nothing (6.12).
 */
export function addRestaurantRequest(
	householdId: number,
	userId: number,
	fields: { name: string; note: string | null },
	now: number
): void {
	const checked = checkFields(fields, 'a restaurant name');
	db()
		.insert(dishRequests)
		.values({
			householdId,
			userId,
			kind: 'restaurant',
			name: checked.name,
			note: checked.note,
			createdAt: now
		})
		.run();
}

/**
 * Restores an archived dish and adds a request linked to it, in one transaction. The request
 * keeps its name as typed (6.12).
 */
export function restoreAndAddRequest(
	householdId: number,
	userId: number,
	dishId: number,
	fields: { name: string; note: string | null },
	now: number
): void {
	transaction(() => {
		const checked = checkFields(fields, 'a dish name');
		const result = db()
			.update(dishes)
			.set({ archivedAt: null })
			.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
			.run();
		if (result.changes === 0) error(404, 'Not found');
		insertDishRequest(householdId, userId, checked, dishId, now);
	});
}

/**
 * Requests the dish from its recipe's page, asked by the signed-in member, named as the dish is
 * named now and with no note. Adds nothing when a request already links to it, from either place,
 * so someone else's request since the page loaded doesn't make a second one (6.12).
 */
export function requestDish(
	householdId: number,
	userId: number,
	dishId: number,
	now: number
): void {
	transaction(() => {
		const dish = db()
			.select({ name: dishes.name, archivedAt: dishes.archivedAt })
			.from(dishes)
			.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
			.get();
		if (!dish) error(404, 'Not found');
		// An archived recipe's page has no Request, so this one was archived after it loaded.
		if (dish.archivedAt !== null) error(400, `Restore ${dish.name} before requesting it`);
		if (hasRequest(householdId, dishId)) return;
		insertDishRequest(householdId, userId, { name: dish.name, note: null }, dishId, now);
	});
}

/** Removes the request, a dish's or a restaurant's. A dish request's recipe stays in Recipes. */
export function removeRequest(householdId: number, requestId: number): void {
	const result = db()
		.delete(dishRequests)
		.where(and(eq(dishRequests.id, requestId), eq(dishRequests.householdId, householdId)))
		.run();
	if (result.changes === 0) error(404, 'Not found');
}
