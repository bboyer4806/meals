import { createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';

export const SESSION_COOKIE = 'session';

const DAY = 24 * 60 * 60 * 1000;
const LIFETIME = 30 * DAY;
// A session used within this long of expiring is extended to a full lifetime again.
const RENEW_WITHIN = 15 * DAY;

export type SessionUser = {
	id: number;
	householdId: number | null;
	email: string;
	name: string;
	isAdmin: boolean;
};

/** Only this hash is stored, so a leaked database doesn't leak working session tokens. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number, now: number): { token: string; expiresAt: number } {
	const token = randomBytes(20).toString('base64url');
	const expiresAt = now + LIFETIME;
	db().insert(sessions).values({ id: hashToken(token), userId, expiresAt }).run();
	return { token, expiresAt };
}

/** Returns the session's user, or null if the token is unknown or expired. */
export function validateSession(
	token: string,
	adminEmail: string,
	now: number
): { user: SessionUser; expiresAt: number; renewed: boolean } | null {
	const id = hashToken(token);
	const row = db()
		.select({
			expiresAt: sessions.expiresAt,
			userId: users.id,
			householdId: users.householdId,
			email: users.email,
			name: users.name
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return null;
	if (row.expiresAt <= now) {
		db().delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	const renewed = row.expiresAt - now < RENEW_WITHIN;
	const expiresAt = renewed ? now + LIFETIME : row.expiresAt;
	if (renewed) db().update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();

	const user: SessionUser = {
		id: row.userId,
		householdId: row.householdId,
		email: row.email,
		name: row.name,
		isAdmin: row.email === adminEmail
	};
	return { user, expiresAt, renewed };
}

export function deleteSession(token: string): void {
	db().delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: number): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		expires: new Date(expiresAt)
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
