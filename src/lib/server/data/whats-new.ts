import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { dateIn } from '../../dates.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

// What's new belongs to each person, not their household, so these take the signed-in
// person's id (design 7).

/**
 * Whether a release on `released` (YYYY-MM-DD) is new to the person: later than the newest
 * release they've seen, and than the day their account was created in `timeZone`, so people
 * who join later don't get a dot for older releases.
 */
export function isReleaseNew(userId: number, released: string, timeZone: string): boolean {
	const user = db()
		.select({ seen: users.whatsNewSeen, createdAt: users.createdAt })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	if (!user) error(404, 'Not found');
	return released > (user.seen ?? '') && released > dateIn(user.createdAt, timeZone);
}

/** Records that the person has seen the release on `released` (YYYY-MM-DD). */
export function recordReleaseSeen(userId: number, released: string): void {
	db().update(users).set({ whatsNewSeen: released }).where(eq(users.id, userId)).run();
}
