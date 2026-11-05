import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { RELEASES, type Release } from '../../whats-new.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { expectHttpError, freshDb, makeHousehold } from '../testing.ts';
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

/** Saves `value` straight into the person's whats_new_seen. */
function saveSeen(value: string | null) {
	db().update(users).set({ whatsNewSeen: value }).where(eq(users.id, userId)).run();
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

	// Opening What's new records the build's newest release. While a deploy overlaps, or after a
	// rollback, an older build then reads a version it doesn't list (MEA-63).
	it("is not new to someone who has seen a newer build's release, for that person only", () => {
		const newer = RELEASES[0].version.replace(/\d+$/, (minor) => String(Number(minor) + 1));
		saveSeen(newer);
		for (const listed of RELEASES) {
			expect(isReleaseNew(userId, listed, ZONE), listed.version).toBe(false);
		}
		expect(seen()).toBe(newer);
		expect(isReleaseNew(memberId, RELEASES[0], ZONE)).toBe(true);
		// Opening What's new on this build records its newest release instead.
		recordReleaseSeen(userId, RELEASES[0]);
		expect(seen()).toBe(RELEASES[0].version);
		expect(isReleaseNew(userId, RELEASES[0], ZONE)).toBe(false);
	});

	it('is not new to someone whose saved value is unexpected, such as a date', () => {
		// A date is what builds from before MEA-25 save, such as after a rollback to one.
		for (const value of ['2026-10-21', '', 'unknown']) {
			saveSeen(value);
			expect(isReleaseNew(userId, RELEASES[0], ZONE), value).toBe(false);
			expect(seen()).toBe(value);
		}
	});

	it("fails for someone who doesn't exist or a release that isn't listed", () => {
		expectHttpError(() => isReleaseNew(9999, RELEASES[0], ZONE), 404);
		const unlisted: Release = { ...RELEASES[0], version: '0.1' };
		for (const value of [null, '1.6', '2026-10-21']) {
			saveSeen(value);
			expect(() => isReleaseNew(userId, unlisted, ZONE), String(value)).toThrow(
				"What's new has no release 0.1"
			);
		}
	});
});
