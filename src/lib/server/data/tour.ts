import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

// The first-time tour belongs to each person, not their household, so these take the
// signed-in person's id (design 7, "Tour").

/** Whether the person has yet to finish or skip the tour. */
export function needsTour(userId: number): boolean {
	const user = db().select({ seen: users.tourSeen }).from(users).where(eq(users.id, userId)).get();
	if (!user) error(404, 'Not found');
	return user.seen === null;
}

/** Records that the person finished or skipped the tour, so it never shows again. */
export function recordTourSeen(userId: number, now: number): void {
	db().update(users).set({ tourSeen: now }).where(eq(users.id, userId)).run();
}
