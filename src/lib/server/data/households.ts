import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, transaction } from '../db/index.ts';
import { dishRatings, dishRequests, households, invites, users } from '../db/schema.ts';
import { STANDARD_ITEMS } from '../standard-items.ts';
import { createItem, findItemByName } from './items.ts';

export type HouseholdSettings = { name: string; defaultServings: number; timeZone: string };

/**
 * Creates a household for a signed-in person who doesn't have one yet (the setup page). Its
 * catalog starts with the standard items (design 6.13).
 */
export function createHousehold(userId: number, settings: HouseholdSettings, now: number): number {
	return transaction(() => {
		const user = db()
			.select({ householdId: users.householdId })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		if (!user) error(404, 'Not found');
		if (user.householdId !== null) error(400, 'You already belong to a household');
		const household = db()
			.insert(households)
			.values({ ...settings, createdAt: now })
			.returning({ id: households.id })
			.get();
		db().update(users).set({ householdId: household.id }).where(eq(users.id, userId)).run();
		addStandardItems(household.id, now);
		return household.id;
	});
}

/**
 * Gives each household that hasn't had the standard items its own, oldest first, such as one set
 * up before they came. The app does this when it starts (design 6.13).
 */
export function addStandardItemsToAllHouseholds(now: number): void {
	const waiting = db()
		.select({ id: households.id })
		.from(households)
		.where(isNull(households.standardItemsAddedAt))
		.orderBy(asc(households.id))
		.all();
	for (const { id } of waiting) addStandardItems(id, now);
}

/**
 * Adds the standard items the household's catalog doesn't have, matching names as everywhere
 * else, so an item it has, archived or not, stays as it is. Once per household: changes to its
 * items or to the standard items afterward never add any again (design 6.13).
 */
function addStandardItems(householdId: number, now: number): void {
	transaction(() => {
		if (getHousehold(householdId).standardItemsAddedAt !== null) return;
		for (const name of STANDARD_ITEMS) {
			if (!findItemByName(householdId, name)) createItem(householdId, name, now);
		}
		db()
			.update(households)
			.set({ standardItemsAddedAt: now })
			.where(eq(households.id, householdId))
			.run();
	});
}

export function getHousehold(householdId: number) {
	const household = db().select().from(households).where(eq(households.id, householdId)).get();
	if (!household) error(404, 'Not found');
	return household;
}

export function updateHousehold(householdId: number, settings: HouseholdSettings): void {
	db().update(households).set(settings).where(eq(households.id, householdId)).run();
}

/** Sorted by name in code rather than in SQL, so "Émile" sorts with the E's (MEA-88). */
export function listMembers(householdId: number) {
	return db()
		.select({ id: users.id, name: users.name, email: users.email })
		.from(users)
		.where(eq(users.householdId, householdId))
		.all()
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Deletes the member's account and sessions. Their active requests go too, their completed ones
 * stay in the history with their name, and their ratings stay with nobody named on them (section
 * 5). Nobody can remove themselves (design 2.3). A member someone else already removed counts as
 * removed, so the page shows its members as they are (6.1).
 */
export function removeMember(householdId: number, actingUserId: number, memberId: number): void {
	if (memberId === actingUserId) error(400, "You can't remove yourself");
	transaction(() => {
		// Empties who rated before the delete, since the composite key's SET NULL would empty the
		// rating's household_id too (4.5).
		db()
			.update(dishRatings)
			.set({ userId: null })
			.where(and(eq(dishRatings.householdId, householdId), eq(dishRatings.userId, memberId)))
			.run();
		// Takes their completed requests off their account, which would delete them with it. Each
		// still names them by asked_by (6.12).
		db()
			.update(dishRequests)
			.set({ userId: null })
			.where(
				and(
					eq(dishRequests.householdId, householdId),
					eq(dishRequests.userId, memberId),
					isNotNull(dishRequests.completedAt)
				)
			)
			.run();
		db()
			.delete(users)
			.where(and(eq(users.id, memberId), eq(users.householdId, householdId)))
			.run();
	});
}

export type InviteResult =
	| { kind: 'invited' }
	| { kind: 'joined' }
	| { kind: 'member' }
	| { kind: 'invited-already' };

/**
 * `householdId` null invites the person to create a new household (admin only). Someone who has
 * an account but never set up a household (they stopped at the setup page, or were removed and
 * signed in again) joins right away, as an invited account does when it signs in (design 6.1).
 */
export function createInvite(householdId: number | null, email: string, now: number): InviteResult {
	const address = email.toLowerCase();
	return transaction(() => {
		const account = db()
			.select({ id: users.id, householdId: users.householdId })
			.from(users)
			.where(eq(users.email, address))
			.get();
		if (account) {
			if (account.householdId !== null || householdId === null) return { kind: 'member' };
			db().update(users).set({ householdId }).where(eq(users.id, account.id)).run();
			return { kind: 'joined' };
		}
		if (db().select({ id: invites.id }).from(invites).where(eq(invites.email, address)).get()) {
			return { kind: 'invited-already' };
		}
		db().insert(invites).values({ email: address, householdId, createdAt: now }).run();
		return { kind: 'invited' };
	});
}

function inviteOwner(householdId: number | null) {
	return householdId === null ? isNull(invites.householdId) : eq(invites.householdId, householdId);
}

export function listInvites(householdId: number | null) {
	return db()
		.select({ id: invites.id, email: invites.email })
		.from(invites)
		.where(inviteOwner(householdId))
		.orderBy(asc(invites.email))
		.all();
}

/**
 * An invite that was used, or that someone else cancelled, counts as cancelled, so the page shows
 * its invites as they are (6.1).
 */
export function cancelInvite(householdId: number | null, inviteId: number): void {
	db()
		.delete(invites)
		.where(and(eq(invites.id, inviteId), inviteOwner(householdId)))
		.run();
}

/**
 * For the admin page: names and member emails only, never household data. Sorted by name in code
 * rather than in SQL, so "Évora" sorts with the E's (MEA-88).
 */
export function listHouseholds() {
	return db()
		.select({
			id: households.id,
			name: households.name,
			createdAt: households.createdAt,
			members: sql<string | null>`group_concat(${users.email}, ', ')`
		})
		.from(households)
		.leftJoin(users, eq(users.householdId, households.id))
		.groupBy(households.id)
		.all()
		.sort((a, b) => a.name.localeCompare(b.name));
}
