import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../../menu.ts';
import { normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';
import { findDishByName, insertDish } from './dishes.ts';

// Dish requests (design 6.12): anyone in the household asks for a dish, and anyone removes the
// request once it's been made. Each shows who asked and links to its recipe.

export type DishRequest = {
	id: number;
	name: string;
	note: string | null;
	/** The recipe it links to. */
	dishId: number;
	askedBy: string;
};

export type AddRequestResult = { kind: 'added' } | { kind: 'archived'; dishId: number; name: string };

/** The household's requests, oldest first. */
export function listRequests(householdId: number): DishRequest[] {
	return db()
		.select({
			id: dishRequests.id,
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

/** The name as it's kept, and the note. Refuses a blank name and anything too long. */
function checkFields(fields: { name: string; note: string | null }) {
	const name = normalizeName(fields.name);
	if (name === '') error(400, 'Enter a dish name');
	if (name.length > REQUEST_NAME_MAX) {
		error(400, `Keep a dish name under ${REQUEST_NAME_MAX} characters`);
	}
	if (fields.note !== null && fields.note.length > REQUEST_NOTE_MAX) {
		error(400, `Keep the note under ${REQUEST_NOTE_MAX} characters`);
	}
	return { name, note: fields.note };
}

function insertRequest(
	householdId: number,
	userId: number,
	fields: { name: string; note: string | null },
	dishId: number,
	now: number
): void {
	db()
		.insert(dishRequests)
		.values({ householdId, userId, name: fields.name, note: fields.note, dishId, createdAt: now })
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
		const checked = checkFields(fields);
		const found = findDishByName(householdId, checked.name);
		if (found && found.archivedAt !== null) {
			return { kind: 'archived', dishId: found.id, name: found.name };
		}
		const dishId = found?.id ?? insertDish(householdId, checked.name, now);
		insertRequest(householdId, userId, checked, dishId, now);
		return { kind: 'added' };
	});
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
		const checked = checkFields(fields);
		const result = db()
			.update(dishes)
			.set({ archivedAt: null })
			.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
			.run();
		if (result.changes === 0) error(404, 'Not found');
		insertRequest(householdId, userId, checked, dishId, now);
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
		insertRequest(householdId, userId, { name: dish.name, note: null }, dishId, now);
	});
}

/** Removes the request. Its recipe stays in Recipes. */
export function removeRequest(householdId: number, requestId: number): void {
	const result = db()
		.delete(dishRequests)
		.where(and(eq(dishRequests.id, requestId), eq(dishRequests.householdId, householdId)))
		.run();
	if (result.changes === 0) error(404, 'Not found');
}
