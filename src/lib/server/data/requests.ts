import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../../menu.ts';
import { normalizeName } from '../../text.ts';
import { db } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';

// Dish requests (design 6.12): anyone in the household asks for a dish, and anyone removes the
// request once it's been made. Each shows who asked.

export type DishRequest = {
	id: number;
	name: string;
	note: string | null;
	/** The recipe it links to, or null for plain text. */
	dishId: number | null;
	askedBy: string;
};

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

/**
 * Adds a request from the signed-in member. A name that matches an active dish, ignoring case,
 * links to it; any other name stays plain text and adds no dish.
 */
export function addRequest(
	householdId: number,
	userId: number,
	fields: { name: string; note: string | null },
	now: number
): void {
	const name = normalizeName(fields.name);
	if (name === '') error(400, 'Enter a dish name');
	if (name.length > REQUEST_NAME_MAX) {
		error(400, `Keep a dish name under ${REQUEST_NAME_MAX} characters`);
	}
	if (fields.note !== null && fields.note.length > REQUEST_NOTE_MAX) {
		error(400, `Keep the note under ${REQUEST_NOTE_MAX} characters`);
	}
	const dish = db()
		.select({ id: dishes.id })
		.from(dishes)
		.where(
			and(
				eq(dishes.householdId, householdId),
				isNull(dishes.archivedAt),
				sql`fold(${dishes.name}) = fold(${name})`
			)
		)
		.get();
	db()
		.insert(dishRequests)
		.values({
			householdId,
			userId,
			name,
			note: fields.note,
			dishId: dish?.id ?? null,
			createdAt: now
		})
		.run();
}

export function removeRequest(householdId: number, requestId: number): void {
	const result = db()
		.delete(dishRequests)
		.where(and(eq(dishRequests.id, requestId), eq(dishRequests.householdId, householdId)))
		.run();
	if (result.changes === 0) error(404, 'Not found');
}
