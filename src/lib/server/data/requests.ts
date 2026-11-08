import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../../menu.ts';
import { normalizeName } from '../../text.ts';
import { db, transaction } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';
import {
	addEatingOut,
	addRequestedDish,
	type DishDestination,
	type NewDinnerLabels
} from './dinners.ts';
import { findDishByName, insertDish, setDishArchived } from './dishes.ts';

// Requests (design 6.12): anyone in the household asks for a dish or a restaurant, edits the name
// and note of any active request, and completes the request, by hand or by adding it to a date: a
// requested dish goes on a dinner, and a requested restaurant becomes an Eating out dinner. A
// completed request stays in the completed history as it was, and nothing changes it. Removing an
// active request deletes it instead. Each shows who asked. A dish request links to its recipe; a
// restaurant request is only the name typed, since restaurants aren't kept anywhere.

/** What every request shows: its name, the note if there is one, and who asked. */
type Shown = { id: number; name: string; note: string | null; askedBy: string };

/** Only a dish request links to a recipe, its dishId. */
export type DishRequest =
	| (Shown & { kind: 'dish'; dishId: number })
	| (Shown & { kind: 'restaurant' });

/** A request in the completed history, with when it was completed. */
export type CompletedRequest = DishRequest & { completedAt: number };

export type AddRequestResult = { kind: 'added' } | { kind: 'archived'; dishId: number; name: string };

export type EditRequestResult =
	| { kind: 'saved' }
	| { kind: 'archived'; dishId: number; name: string };

/** A request as it's shown, linked to its recipe when it's a dish request. */
function shown({
	kind,
	dishId,
	...rest
}: Shown & { kind: DishRequest['kind']; dishId: number | null }): DishRequest {
	if (kind === 'restaurant') return { kind, ...rest };
	// The database keeps a dish on every dish request (dish_requests_kind_dish).
	if (dishId === null) throw new Error(`Dish request ${rest.id} has no dish`);
	return { kind, dishId, ...rest };
}

/** The household's active requests, dish and restaurant requests together, oldest first. */
export function listRequests(householdId: number): DishRequest[] {
	return db()
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
		.where(and(eq(dishRequests.householdId, householdId), isNull(dishRequests.completedAt)))
		.orderBy(asc(dishRequests.createdAt), asc(dishRequests.id))
		.all()
		.map(shown);
}

/**
 * The household's completed requests, newest first, each as it was asked for, with who asked by
 * the name they had when it was completed (6.12).
 */
export function listCompletedRequests(householdId: number): CompletedRequest[] {
	const rows = db()
		.select({
			id: dishRequests.id,
			kind: dishRequests.kind,
			name: dishRequests.name,
			note: dishRequests.note,
			dishId: dishRequests.dishId,
			askedBy: dishRequests.askedBy,
			completedAt: dishRequests.completedAt
		})
		.from(dishRequests)
		.where(and(eq(dishRequests.householdId, householdId), isNotNull(dishRequests.completedAt)))
		.orderBy(desc(dishRequests.completedAt), desc(dishRequests.id))
		.all();
	return rows.map(({ askedBy, completedAt, ...row }) => {
		// The database names who asked on every completed request (dish_requests_asked_by).
		if (askedBy === null || completedAt === null) {
			throw new Error(`Completed request ${row.id} doesn't say who asked`);
		}
		return { ...shown({ ...row, askedBy }), completedAt };
	});
}

/** Whether any active request links to the dish, made from its recipe's page or the Menu (6.12). */
export function hasRequest(householdId: number, dishId: number): boolean {
	const request = db()
		.select({ id: dishRequests.id })
		.from(dishRequests)
		.where(
			and(
				eq(dishRequests.householdId, householdId),
				eq(dishRequests.dishId, dishId),
				isNull(dishRequests.completedAt)
			)
		)
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
 * named now and with no note. Adds nothing when an active request already links to it, from either
 * place, so someone else's request since the page loaded doesn't make a second one (6.12).
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

/** The household's request with this id while it's active. */
function isActive(householdId: number, requestId: number) {
	return and(
		eq(dishRequests.id, requestId),
		eq(dishRequests.householdId, householdId),
		isNull(dishRequests.completedAt)
	);
}

/**
 * The household's active request, as it is now. Not found when someone completed or removed it
 * meanwhile.
 */
function findActiveRequest(householdId: number, requestId: number) {
	const request = db()
		.select({
			kind: dishRequests.kind,
			name: dishRequests.name,
			note: dishRequests.note,
			dishId: dishRequests.dishId
		})
		.from(dishRequests)
		.where(isActive(householdId, requestId))
		.get();
	if (!request) error(404, 'Not found');
	return request;
}

/** The household's active request of this kind, as it is now. Not found for the other kind too. */
function findRequest(householdId: number, requestId: number, kind: DishRequest['kind']) {
	const request = findActiveRequest(householdId, requestId);
	if (request.kind !== kind) error(404, 'Not found');
	return request;
}

/**
 * Saves an active request's name and note, and a dish request's recipe. Who asked, when, and its
 * place in the list stay as they are (6.12).
 */
function saveEdit(
	householdId: number,
	requestId: number,
	changes: { name: string; note: string | null; dishId?: number }
): void {
	db().update(dishRequests).set(changes).where(isActive(householdId, requestId)).run();
}

/**
 * Saves the name and note of an active request, a dish's or a restaurant's, from anyone in the
 * household (6.12). A dish request saved with another name links to its recipe as a new request
 * with that name would: an active dish with the name, ignoring case, or a new one with the
 * household's usual servings. The dish it linked to before stays as it is. An archived dish with
 * the name changes nothing and returns 'archived', so the page can offer to restore it (6.10). The
 * name it has keeps the link, so a change to the note alone never changes it. A restaurant request
 * is only its name as typed and its note, linked to nothing. Refuses a blank name and anything too
 * long, changing nothing. Not found when someone completed or removed it meanwhile.
 */
export function editRequest(
	householdId: number,
	requestId: number,
	fields: { name: string; note: string | null },
	now: number
): EditRequestResult {
	return transaction(() => {
		const request = findActiveRequest(householdId, requestId);
		if (request.kind === 'restaurant') {
			saveEdit(householdId, requestId, checkFields(fields, 'a restaurant name'));
			return { kind: 'saved' };
		}
		const checked = checkFields(fields, 'a dish name');
		if (checked.name === request.name) {
			saveEdit(householdId, requestId, checked);
			return { kind: 'saved' };
		}
		const found = findDishByName(householdId, checked.name);
		if (found && found.archivedAt !== null) {
			return { kind: 'archived', dishId: found.id, name: found.name };
		}
		const dishId = found?.id ?? insertDish(householdId, checked.name, now);
		saveEdit(householdId, requestId, { ...checked, dishId });
		return { kind: 'saved' };
	});
}

/**
 * Restores an archived dish and saves an active dish request's new name and note, linked to it, in
 * one transaction (6.10, 6.12). Not found when someone completed or removed the request meanwhile,
 * for a restaurant request, and for another household's dish.
 */
export function restoreAndEditRequest(
	householdId: number,
	requestId: number,
	dishId: number,
	fields: { name: string; note: string | null },
	now: number
): void {
	transaction(() => {
		findRequest(householdId, requestId, 'dish');
		const checked = checkFields(fields, 'a dish name');
		setDishArchived(householdId, dishId, false, now);
		saveEdit(householdId, requestId, { ...checked, dishId });
	});
}

/**
 * Puts a dish request's recipe on one of the date's dinners, with the request's note, and completes
 * the request, in one transaction (6.12; addRequestedDish says where it goes). When that can't be
 * done, nothing changes: the request stays active, and the date's dinners stay as they are. Not
 * found when someone completed or removed the request meanwhile. Returns the dinner's id.
 */
export function promoteDishRequest(
	householdId: number,
	date: string,
	requestId: number,
	to: DishDestination,
	now: number
): number {
	return transaction(() => {
		// Only a dish request has a recipe to put on a dinner.
		const request = findRequest(householdId, requestId, 'dish');
		// The database keeps a dish on every dish request (dish_requests_kind_dish).
		if (request.dishId === null) throw new Error(`Dish request ${requestId} has no dish`);
		const requested = { dishId: request.dishId, note: request.note };
		const dinnerId = addRequestedDish(householdId, date, to, requested, now);
		completeRequest(householdId, requestId, now);
		return dinnerId;
	});
}

/**
 * Adds a restaurant request to the date as a new Eating out dinner at its restaurant, with its
 * note, and completes the request, in one transaction (6.12; addEatingOut says how). The date's
 * dinners stay as they are. When that can't be done, nothing changes: the request stays active,
 * and the date's dinners stay as they are. Not found when someone completed or removed the request
 * meanwhile. Returns the new dinner's id.
 */
export function promoteRestaurantRequest(
	householdId: number,
	date: string,
	requestId: number,
	labels: NewDinnerLabels,
	now: number
): number {
	return transaction(() => {
		const request = findRequest(householdId, requestId, 'restaurant');
		const eatingOut = { restaurantName: request.name, note: request.note };
		const dinnerId = addEatingOut(householdId, date, labels, eatingOut, now);
		completeRequest(householdId, requestId, now);
		return dinnerId;
	});
}

/**
 * Completes an active request, a dish's or a restaurant's, by hand or as it's added to a date. It
 * leaves the active requests for the completed history, kept as it is now, with who asked named as
 * they're named now (6.12). Not found when someone completed or removed it meanwhile, so it's never
 * completed twice.
 */
export function completeRequest(householdId: number, requestId: number, now: number): void {
	transaction(() => {
		const request = db()
			.select({ askedBy: users.name })
			.from(dishRequests)
			.innerJoin(users, eq(users.id, dishRequests.userId))
			.where(isActive(householdId, requestId))
			.get();
		if (!request) error(404, 'Not found');
		db()
			.update(dishRequests)
			.set({ completedAt: now, askedBy: request.askedBy })
			.where(isActive(householdId, requestId))
			.run();
	});
}

/**
 * Removes an active request, a dish's or a restaurant's, for good: it doesn't go in the completed
 * history. A dish request's recipe stays in Recipes. Not found when someone completed or removed it
 * meanwhile, so the completed history never loses one.
 */
export function removeRequest(householdId: number, requestId: number): void {
	const result = db().delete(dishRequests).where(isActive(householdId, requestId)).run();
	if (result.changes === 0) error(404, 'Not found');
}
