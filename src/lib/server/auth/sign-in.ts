import { eq } from 'drizzle-orm';
import { db, transaction } from '../db/index.ts';
import { invites, users } from '../db/schema.ts';

export type GoogleProfile = { sub: string; email: string; name: string };

/** Carries the address an uninvited account used from the sign-in callback to /not-invited. */
export const NOT_INVITED_COOKIE = 'not_invited_email';

/**
 * Carries the page to come back to from starting a sign-in to its callback, such as an AI
 * assistant's connection page (design 6.1, 6.17). Named with cookieName.
 */
export const RETURN_COOKIE = 'login_return';

/**
 * A page on this site to go to after signing in, as its path and query, or null for anything
 * else, so a sign-in never ends on another site.
 */
export function returnPath(path: string | null | undefined, origin: string): string | null {
	if (!path?.startsWith('/')) return null;
	const url = new URL(path, origin);
	return url.origin === origin ? `${url.pathname}${url.search}` : null;
}

/**
 * Why a sign-in didn't finish (design 6.1). The callback sends someone back to the sign-in page
 * with one in the address, as `/login?error=cancelled`, and the page says what happened.
 */
export const SIGN_IN_ERRORS = ['cancelled', 'failed', 'unverified'] as const;

export type SignInError = (typeof SIGN_IN_ERRORS)[number];

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
	return transaction(() => {
		const existing = db().select().from(users).where(eq(users.googleSub, profile.sub)).get();
		if (existing) {
			db().update(users).set({ email, name: profile.name }).where(eq(users.id, existing.id)).run();
			return { kind: 'signed-in', userId: existing.id };
		}

		const invite = db().select().from(invites).where(eq(invites.email, email)).get();
		if (!invite && email !== adminEmail) return { kind: 'not-invited', email };

		const user = db()
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
		if (invite) db().delete(invites).where(eq(invites.id, invite.id)).run();
		return { kind: 'signed-in', userId: user.id };
	});
}
