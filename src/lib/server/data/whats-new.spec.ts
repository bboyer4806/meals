import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { RELEASES, type Release } from '../../whats-new.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { freshDb, makeHousehold } from '../testing.ts';
import { isReleaseNew, recordReleaseSeen } from './whats-new.ts';

const ZONE = 'America/Chicago';

let userId: number;
let memberId: number;

beforeEach(() => {
	freshDb();
	const household = makeHousehold(ZONE);
	userId = household.userId;
	// Someone else in the same household.
	memberId = db()
		.insert(users)
		.values({
			householdId: household.householdId,
			googleSub: 'sub-member',
			email: 'member@example.com',
			name: 'Member',
			createdAt: 0
		})
		.returning({ id: users.id })
		.get().id;
});

function release(version: string): Release {
	const found = RELEASES.find((listed) => listed.version === version);
	if (!found) throw new Error(`No release ${version}`);
	return found;
}

function createdAt(ms: number) {
	db().update(users).set({ createdAt: ms }).where(eq(users.id, userId)).run();
}

function seen(user = userId): string | null {
	return db()
		.select({ seen: users.whatsNewSeen })
		.from(users)
		.where(eq(users.id, user))
		.get()!.seen;
}

describe('recordReleaseSeen', () => {
	it("stores the release's version for that person only", () => {
		recordReleaseSeen(userId, release('1.4'));
		expect(seen()).toBe('1.4');
		expect(seen(memberId)).toBeNull();
	});
});

describe('isReleaseNew', () => {
	it("is new to someone who has never opened What's new and joined before it", () => {
		expect(isReleaseNew(userId, release('1.8'), ZONE)).toBe(true);
	});

	it('is not new once seen, and a newer release is, for that person only', () => {
		recordReleaseSeen(userId, release('1.6'));
		expect(isReleaseNew(userId, release('1.6'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.2'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.8'), ZONE)).toBe(true);
		expect(isReleaseNew(memberId, release('1.6'), ZONE)).toBe(true);
	});

	// 1.3, 1.4 and 1.5 all came out on 2026-10-21 (MEA-25).
	it('is new when it came out the same day as the one seen', () => {
		expect(['1.3', '1.4', '1.5'].map((version) => release(version).released)).toEqual([
			'2026-10-21',
			'2026-10-21',
			'2026-10-21'
		]);
		recordReleaseSeen(userId, release('1.3'));
		expect(isReleaseNew(userId, release('1.4'), ZONE)).toBe(true);
		expect(isReleaseNew(userId, release('1.5'), ZONE)).toBe(true);
		// Everyone who had seen 2026-10-21 has seen 1.5 since versions replaced dates.
		recordReleaseSeen(userId, release('1.5'));
		expect(isReleaseNew(userId, release('1.4'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.5'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.6'), ZONE)).toBe(true);
	});

	it('is not new to someone whose account was created that day or later', () => {
		createdAt(Date.UTC(2026, 9, 21, 15, 0));
		expect(isReleaseNew(userId, release('1.5'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.2'), ZONE)).toBe(false);
		expect(isReleaseNew(userId, release('1.6'), ZONE)).toBe(true);
	});

	it("uses the day the account was created in the household's time zone", () => {
		// 2026-10-21 03:00 UTC is still Oct 20 in Chicago.
		createdAt(Date.UTC(2026, 9, 21, 3, 0));
		expect(isReleaseNew(userId, release('1.5'), ZONE)).toBe(true);
		expect(isReleaseNew(userId, release('1.5'), 'UTC')).toBe(false);
	});

	it("fails when the person's release isn't listed", () => {
		db().update(users).set({ whatsNewSeen: '2026-10-21' }).where(eq(users.id, userId)).run();
		expect(() => isReleaseNew(userId, release('1.8'), ZONE)).toThrow(
			"What's new has no release 2026-10-21"
		);
	});
});
