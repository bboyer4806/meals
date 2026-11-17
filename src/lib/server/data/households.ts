import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DEFAULT_DISH_REVISIONS } from '../../default-dishes.ts';
import { formatMemberName } from '../../member-names.ts';
import { db, transaction } from '../db/index.ts';
import { dishRatings, dishRequests, households, invites, users } from '../db/schema.ts';
import { STANDARD_ITEMS } from '../standard-items.ts';
import { findDishByName, insertDish, setDishPhotoIfNone } from './dishes.ts';
import { createItem, findItemByName } from './items.ts';

export type HouseholdSettings = { name: string; defaultServings: number; timeZone: string };

/**
 * Creates a household for a signed-in person who doesn't have one yet (the setup page): the admin,
 * or someone with an invite to start one (6.1). Its catalog starts with the standard items (design
 * 6.13), and its Recipes with the default dishes (6.18).
 */
export function createHousehold(
	userId: number,
	adminEmail: string,
	settings: HouseholdSettings,
	now: number
): number {
	return transaction(() => {
		const email = newcomerEmail(userId);
		if (!mayStartHousehold(email, adminEmail)) {
			error(400, 'Your invite to start a household was cancelled.');
		}
		const household = db()
			.insert(households)
			.values({ ...settings, createdAt: now })
			.returning({ id: households.id })
			.get();
		putInHousehold(userId, email, household.id);
		addStandardItems(household.id, now);
		addDefaultDishes(household.id, now);
		return household.id;
	});
}

/**
 * For the setup page: the households that invited someone signed in without a household, each to
 * join by its invite, and whether they may set up one of their own (6.1, MEA-112). Sorted by name
 * in code rather than in SQL, so "Évora" sorts with the E's (MEA-88).
 */
export function setupChoices(userId: number, adminEmail: string) {
	const email = newcomerEmail(userId);
	const joinable = db()
		.select({ id: invites.id, householdName: households.name })
		.from(invites)
		.innerJoin(households, eq(invites.householdId, households.id))
		.where(eq(invites.email, email))
		.all()
		.sort((a, b) => a.householdName.localeCompare(b.householdName));
	return { invites: joinable, mayStart: mayStartHousehold(email, adminEmail) };
}

/**
 * Joins the household whose invite this is, for someone signed in without a household (the setup
 * page, 6.1, MEA-112). An invite to someone else, or one cancelled meanwhile, can't be used.
 */
export function joinHousehold(userId: number, inviteId: number): number {
	return transaction(() => {
		const email = newcomerEmail(userId);
		const invite = db()
			.select({ householdId: invites.householdId })
			.from(invites)
			.where(and(eq(invites.id, inviteId), eq(invites.email, email)))
			.get();
		if (!invite || invite.householdId === null) error(400, 'That invite was cancelled.');
		putInHousehold(userId, email, invite.householdId);
		return invite.householdId;
	});
}

/** The email of someone signed in who hasn't joined or set up a household yet (6.1). */
function newcomerEmail(userId: number): string {
	const user = db()
		.select({ householdId: users.householdId, email: users.email })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	if (!user) error(404, 'Not found');
	if (user.householdId !== null) error(400, 'You already belong to a household');
	return user.email;
}

/** The admin may set up a household, and so may someone with an invite to start one (6.1). */
function mayStartHousehold(email: string, adminEmail: string): boolean {
	if (email === adminEmail) return true;
	const invite = db()
		.select({ id: invites.id })
		.from(invites)
		.where(and(eq(invites.email, email), isNull(invites.householdId)))
		.get();
	return invite !== undefined;
}

/**
 * Puts someone in a household they joined or set up, which uses up every invite for their email,
 * whichever household it's from (6.1, MEA-112).
 */
function putInHousehold(userId: number, email: string, householdId: number): void {
	db().update(users).set({ householdId }).where(eq(users.id, userId)).run();
	db().delete(invites).where(eq(invites.email, email)).run();
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

/**
 * Gives each household the default dishes of every revision it hasn't had, oldest first: all of
 * them for one set up before they came, and a newer revision's to every household. The app does
 * this when it starts (design 6.18).
 */
export function addDefaultDishesToAllHouseholds(now: number): void {
	const waiting = db()
		.select({ id: households.id })
		.from(households)
		.where(lt(households.defaultDishesRevision, DEFAULT_DISH_REVISIONS.length))
		.orderBy(asc(households.id))
		.all();
	for (const { id } of waiting) addDefaultDishes(id, now);
}

/**
 * Adds the default dishes of each revision the household hasn't had, but for names it has,
 * matched as everywhere else, so a dish it has, archived or not, stays as it is. Each revision is
 * added once: a default dish renamed or archived afterward is never added again (design 6.18).
 */
function addDefaultDishes(householdId: number, now: number): void {
	transaction(() => {
		const { defaultDishesRevision } = getHousehold(householdId);
		// Another version of the app, starting during a deploy (4.4), may have added them already,
		// and a newer one more of them.
		if (defaultDishesRevision >= DEFAULT_DISH_REVISIONS.length) return;
		for (const name of DEFAULT_DISH_REVISIONS.slice(defaultDishesRevision).flat()) {
			if (!findDishByName(householdId, name)) insertDish(householdId, name, now);
		}
		db()
			.update(households)
			.set({ defaultDishesRevision: DEFAULT_DISH_REVISIONS.length })
			.where(eq(households.id, householdId))
			.run();
	});
}

/** Households whose dishes haven't had the default dishes' photos, oldest first (design 6.19). */
export function listHouseholdsWithoutDefaultDishPhotos(): number[] {
	return db()
		.select({ id: households.id })
		.from(households)
		.where(isNull(households.defaultDishPhotosAddedAt))
		.orderBy(asc(households.id))
		.all()
		.map((row) => row.id);
}

/**
 * Gives each dish in `photos`, photo keys by dish id, its photo if it still has none, and records
 * that the household has had the default dishes' photos, all at once. A household has them once,
 * so a photo removed or replaced afterward stays that way (design 6.19). Returns the keys no dish
 * took, every one when the household had them already, so the caller can delete their files.
 */
export function addDefaultDishPhotos(
	householdId: number,
	photos: ReadonlyMap<number, string>,
	now: number
): string[] {
	return transaction(() => {
		// Another version of the app, starting during a deploy (4.4), may have given them already.
		if (getHousehold(householdId).defaultDishPhotosAddedAt !== null) return [...photos.values()];
		const unused: string[] = [];
		for (const [dishId, photoKey] of photos) {
			if (!setDishPhotoIfNone(householdId, dishId, photoKey)) unused.push(photoKey);
		}
		db()
			.update(households)
			.set({ defaultDishPhotosAddedAt: now })
			.where(eq(households.id, householdId))
			.run();
		return unused;
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

/**
 * Sorted by name in code rather than in SQL, so "Émile" sorts with the E's (MEA-88). Each has
 * their name as it's kept, and displayName, their name as the household sees it (6.1).
 */
export function listMembers(householdId: number) {
	const members = db()
		.select({ id: users.id, name: users.name, email: users.email })
		.from(users)
		.where(eq(users.householdId, householdId))
		.all()
		.sort((a, b) => a.name.localeCompare(b.name));
	return members.map((member) => ({
		...member,
		displayName: formatMemberName(member.name, member.id, members)
	}));
}

/**
 * Deletes the member's account and sessions. Their active requests go too, their completed ones
 * stay in the history with their name, and their ratings stay with nobody named on them (section
 * 5). Nobody can remove themselves (design 2.3). A member someone else already removed counts as
 * removed, so the page shows its members as they are (6.1). A member removed meanwhile can't
 * remove anyone, so two members removing each other at once leave one of them, never an empty
 * household (2.3, 6.1, MEA-114).
 */
export function removeMember(householdId: number, actingUserId: number, memberId: number): void {
	if (memberId === actingUserId) error(400, "You can't remove yourself");
	transaction(() => {
		// Inside the transaction, whose lock makes a removal wait for any other under way, so of two
		// members removing each other at once, the second finds they were removed and stops.
		const acting = db()
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.id, actingUserId), eq(users.householdId, householdId)))
			.get();
		if (!acting) error(404, 'Not found');
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
	| { kind: 'member' }
	| { kind: 'invited-already' }
	| { kind: 'full' };

/** The most invites a household, or the admin to start households, can have waiting (6.1). */
export const INVITE_LIMIT = 20;

/**
 * `householdId` null invites the person to create a new household (admin only). Each household's
 * invites stand on their own, so another household's invite to the same person never stops one
 * (MEA-112). Someone signed in who hasn't joined or set up a household finds it on the setup page
 * (design 6.1).
 */
export function createInvite(householdId: number | null, email: string, now: number): InviteResult {
	const address = email.toLowerCase();
	const owner = inviteOwner(householdId);
	return transaction(() => {
		const account = db()
			.select({ householdId: users.householdId })
			.from(users)
			.where(eq(users.email, address))
			.get();
		if (account !== undefined && account.householdId !== null) return { kind: 'member' };
		const invited = db()
			.select({ id: invites.id })
			.from(invites)
			.where(and(owner, eq(invites.email, address)))
			.get();
		if (invited) return { kind: 'invited-already' };
		if (listInvites(householdId).length >= INVITE_LIMIT) return { kind: 'full' };
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
 * For the admin page: names, member emails and the emails of the invites waiting, never household
 * data (MEA-112). Sorted by name in code rather than in SQL, so "Évora" sorts with the E's
 * (MEA-88).
 */
export function listHouseholds() {
	return db()
		.select({
			id: households.id,
			name: households.name,
			createdAt: households.createdAt,
			members: sql<string | null>`group_concat(${users.email}, ', ')`,
			invites: sql<string | null>`(select group_concat(${invites.email}, ', ' order by ${invites.email})
				from ${invites} where ${invites.householdId} = ${households.id})`
		})
		.from(households)
		.leftJoin(users, eq(users.householdId, households.id))
		.groupBy(households.id)
		.all()
		.sort((a, b) => a.name.localeCompare(b.name));
}
