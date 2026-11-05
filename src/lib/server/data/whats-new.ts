import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { dateIn } from '../../dates.ts';
import { RELEASES, type Release } from '../../whats-new.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

// What's new belongs to each person, not their household, so these take the signed-in
// person's id (design 7).

/** Where the release with `version` is in RELEASES, where 0 is the newest. */
function position(version: string): number {
	const index = RELEASES.findIndex((release) => release.version === version);
	if (index === -1) throw new Error(`What's new has no release ${version}`);
	return index;
}

/**
 * Whether `release` is new to the person: newer than the newest release they've seen, and
 * released later than the day their account was created in `timeZone`, so people who join later
 * don't get a dot for older releases. Newer goes by place in RELEASES rather than date, so a
 * newer release on the same day as the one they saw is still new (MEA-25). A seen version that
 * RELEASES doesn't list, such as one a newer build recorded while a deploy overlapped or before a
 * rollback, counts as having seen every listed release, so checking for the dot never fails a
 * page (MEA-63).
 */
export function isReleaseNew(userId: number, release: Release, timeZone: string): boolean {
	const user = db()
		.select({ seen: users.whatsNewSeen, createdAt: users.createdAt })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	if (!user) error(404, 'Not found');
	const place = position(release.version);
	if (user.seen !== null && !RELEASES.some((listed) => listed.version === user.seen)) return false;
	const newer = user.seen === null || place < position(user.seen);
	return newer && release.released > dateIn(user.createdAt, timeZone);
}

/** Records that the person has seen `release`, and so every older one. */
export function recordReleaseSeen(userId: number, release: Release): void {
	db().update(users).set({ whatsNewSeen: release.version }).where(eq(users.id, userId)).run();
}
