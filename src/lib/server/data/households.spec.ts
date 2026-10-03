import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';
import { createSession } from '../auth/session.ts';
import { expectHttpError, freshDb, makeHousehold } from '../testing.ts';
import {
	cancelInvite,
	createHousehold,
	createInvite,
	listInvites,
	listMembers,
	removeMember
} from './households.ts';

beforeEach(freshDb);

const settings = { name: 'The Boyers', defaultServings: 4, timeZone: 'America/Chicago' };

describe('households', () => {
	it('sets up a household once for a person without one', () => {
		const user = db()
			.insert(users)
			.values({ googleSub: 'g', email: 'a@example.com', name: 'A', createdAt: 0 })
			.returning()
			.get();
		const householdId = createHousehold(user.id, settings, 0);
		expect(listMembers(householdId).map((m) => m.email)).toEqual(['a@example.com']);
		expectHttpError(() => createHousehold(user.id, settings, 0), 400);
	});

	it('lets members remove others but not themselves', () => {
		const { householdId, userId } = makeHousehold();
		const other = db()
			.insert(users)
			.values({ householdId, googleSub: 'g2', email: 'b@example.com', name: 'B', createdAt: 0 })
			.returning()
			.get();
		createSession(other.id, 0);
		expectHttpError(() => removeMember(householdId, userId, userId), 400);
		removeMember(householdId, userId, other.id);
		expect(listMembers(householdId)).toHaveLength(1);
		expect(db().select().from(sessions).all()).toHaveLength(0);
	});

	it("can't remove someone from another household", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		expectHttpError(() => removeMember(mine.householdId, mine.userId, theirs.userId), 404);
	});
});

describe('invites', () => {
	it('refuses members and people already invited', () => {
		const { householdId } = makeHousehold();
		const member = listMembers(householdId)[0]!;
		expect(createInvite(householdId, member.email.toUpperCase(), 0)).toEqual({ kind: 'member' });
		expect(createInvite(householdId, 'new@example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(null, 'NEW@example.com', 0)).toEqual({ kind: 'invited-already' });
	});

	it("keeps each household's invites to itself", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		createInvite(mine.householdId, 'a@example.com', 0);
		createInvite(null, 'b@example.com', 0);
		expect(listInvites(mine.householdId).map((i) => i.email)).toEqual(['a@example.com']);
		expect(listInvites(null).map((i) => i.email)).toEqual(['b@example.com']);
		const invite = listInvites(mine.householdId)[0]!;
		expectHttpError(() => cancelInvite(theirs.householdId, invite.id), 404);
		cancelInvite(mine.householdId, invite.id);
		expect(listInvites(mine.householdId)).toHaveLength(0);
	});
});
