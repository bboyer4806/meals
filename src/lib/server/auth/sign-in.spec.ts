import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { invites, users } from '../db/schema.ts';
import { freshDb, makeHousehold } from '../testing.ts';
import { createInvite } from '../data/households.ts';
import { signIn } from './sign-in.ts';

const ADMIN = 'admin@example.com';
const profile = (email: string, sub = `sub-${email}`) => ({ sub, email, name: 'Pat' });

function userFor(userId: number) {
	return db().select().from(users).where(eq(users.id, userId)).get();
}

beforeEach(freshDb);

describe('signIn', () => {
	it('turns away an account without an invite', () => {
		expect(signIn(profile('stranger@example.com'), ADMIN, 0)).toEqual({
			kind: 'not-invited',
			email: 'stranger@example.com'
		});
		expect(db().select().from(users).all()).toHaveLength(0);
	});

	it('lets the admin in the first time, without a household', () => {
		const result = signIn(profile('Admin@Example.com'), ADMIN, 0);
		expect(result.kind).toBe('signed-in');
		if (result.kind !== 'signed-in') return;
		expect(userFor(result.userId)).toMatchObject({ email: ADMIN, householdId: null });
	});

	it('adds an invited person to the household and uses up the invite', () => {
		const { householdId } = makeHousehold();
		createInvite(householdId, 'Sam@Example.com', 0);
		const result = signIn(profile('sam@example.com'), ADMIN, 0);
		if (result.kind !== 'signed-in') throw new Error('expected sign-in');
		expect(userFor(result.userId)?.householdId).toBe(householdId);
		expect(db().select().from(invites).all()).toHaveLength(0);
	});

	it('starts a person invited to create a household without one', () => {
		createInvite(null, 'new@example.com', 0);
		const result = signIn(profile('new@example.com'), ADMIN, 0);
		if (result.kind !== 'signed-in') throw new Error('expected sign-in');
		expect(userFor(result.userId)?.householdId).toBeNull();
	});

	it('recognizes a returning account by its Google ID and refreshes its email', () => {
		createInvite(null, 'old@example.com', 0);
		const first = signIn(profile('old@example.com', 'google-1'), ADMIN, 0);
		const again = signIn({ sub: 'google-1', email: 'new@example.com', name: 'Pat B' }, ADMIN, 0);
		expect(again).toEqual(first);
		if (again.kind !== 'signed-in') return;
		expect(userFor(again.userId)).toMatchObject({ email: 'new@example.com', name: 'Pat B' });
	});
});
