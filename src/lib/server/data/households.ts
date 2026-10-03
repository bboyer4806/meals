import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { households, invites, users } from '../db/schema.ts';

export type HouseholdSettings = { name: string; defaultServings: number; timeZone: string };

/** Creates a household for a signed-in person who doesn't have one yet (the setup page). */
export function createHousehold(userId: number, settings: HouseholdSettings, now: number): number {
	return db().transaction(() => {
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
		return household.id;
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

export function listMembers(householdId: number) {
	return db()
		.select({ id: users.id, name: users.name, email: users.email })
		.from(users)
		.where(eq(users.householdId, householdId))
		.orderBy(asc(sql`lower(${users.name})`))
		.all();
}

/** Deletes the member's account and sessions. Nobody can remove themselves (design 2.3). */
export function removeMember(householdId: number, actingUserId: number, memberId: number): void {
	if (memberId === actingUserId) error(400, "You can't remove yourself");
	const result = db()
		.delete(users)
		.where(and(eq(users.id, memberId), eq(users.householdId, householdId)))
		.run();
	if (result.changes === 0) error(404, 'Not found');
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
	return db().transaction(() => {
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

export function cancelInvite(householdId: number | null, inviteId: number): void {
	const result = db()
		.delete(invites)
		.where(and(eq(invites.id, inviteId), inviteOwner(householdId)))
		.run();
	if (result.changes === 0) error(404, 'Not found');
}

/** For the admin page: names and member emails only, never household data. */
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
		.orderBy(asc(sql`lower(${households.name})`))
		.all();
}
