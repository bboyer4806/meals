import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { freshDb, makeHousehold } from '../testing.ts';
import { isReleaseNew, recordReleaseSeen } from './whats-new.ts';

const ZONE = 'America/Chicago';

let userId: number;
let otherUserId: number;

beforeEach(() => {
	freshDb();
	({ userId } = makeHousehold(ZONE));
	({ userId: otherUserId } = makeHousehold(ZONE));
});

function createdAt(ms: number, user = userId) {
	db().update(users).set({ createdAt: ms }).where(eq(users.id, user)).run();
}

function seen(user = userId): string | null {
	return db()
		.select({ seen: users.whatsNewSeen })
		.from(users)
		.where(eq(users.id, user))
		.get()!.seen;
}

describe('recordReleaseSeen', () => {
	it("stores the release date for that person only", () => {
		recordReleaseSeen(userId, '2026-10-20');
		expect(seen()).toBe('2026-10-20');
		expect(seen(otherUserId)).toBeNull();
	});
});

describe('isReleaseNew', () => {
	it('is new to someone who has never opened What\'s new and joined before it', () => {
		expect(isReleaseNew(userId, '2026-10-20', ZONE)).toBe(true);
	});

	it('is not new once seen, and a later release is', () => {
		recordReleaseSeen(userId, '2026-10-20');
		expect(isReleaseNew(userId, '2026-10-20', ZONE)).toBe(false);
		expect(isReleaseNew(userId, '2026-10-14', ZONE)).toBe(false);
		expect(isReleaseNew(userId, '2026-11-03', ZONE)).toBe(true);
		expect(isReleaseNew(otherUserId, '2026-10-20', ZONE)).toBe(true);
	});

	it('is not new to someone whose account was created that day or later', () => {
		createdAt(Date.UTC(2026, 9, 20, 15, 0));
		expect(isReleaseNew(userId, '2026-10-20', ZONE)).toBe(false);
		expect(isReleaseNew(userId, '2026-10-14', ZONE)).toBe(false);
		expect(isReleaseNew(userId, '2026-10-21', ZONE)).toBe(true);
	});

	it("uses the day the account was created in the household's time zone", () => {
		// 2026-10-20 03:00 UTC is still Oct 19 in Chicago.
		createdAt(Date.UTC(2026, 9, 20, 3, 0));
		expect(isReleaseNew(userId, '2026-10-20', ZONE)).toBe(true);
		expect(isReleaseNew(userId, '2026-10-20', 'UTC')).toBe(false);
	});
});
