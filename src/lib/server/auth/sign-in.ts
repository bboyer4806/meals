import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { invites, users } from '../db/schema.ts';

export type GoogleProfile = { sub: string; email: string; name: string };

/** Carries the address an uninvited account used from the sign-in callback to /not-invited. */
export const NOT_INVITED_COOKIE = 'not_invited_email';

export type SignInResult =
	| { kind: 'signed-in'; userId: number }
	| { kind: 'not-invited'; email: string };

/**
 * Applies the sign-in rules (design section 6.1): a known Google account signs in; an unknown one
 * needs an invite for its email, or must be the admin's first sign-in. A used invite is deleted.
 * An account invited to create a household, or the admin, starts without one and goes to setup.
 */
export function signIn(profile: GoogleProfile, adminEmail: string, now: number): SignInResult {
	const email = profile.email.toLowerCase();
	return db().transaction((tx) => {
		const existing = tx.select().from(users).where(eq(users.googleSub, profile.sub)).get();
		if (existing) {
			tx.update(users).set({ email, name: profile.name }).where(eq(users.id, existing.id)).run();
			return { kind: 'signed-in', userId: existing.id };
		}

		const invite = tx.select().from(invites).where(eq(invites.email, email)).get();
		if (!invite && email !== adminEmail) return { kind: 'not-invited', email };

		const user = tx
			.insert(users)
			.values({
				householdId: invite?.householdId ?? null,
				googleSub: profile.sub,
				email,
				name: profile.name,
				createdAt: now
			})
			.returning({ id: users.id })
			.get();
		if (invite) tx.delete(invites).where(eq(invites.id, invite.id)).run();
		return { kind: 'signed-in', userId: user.id };
	});
}
