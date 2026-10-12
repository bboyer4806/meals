import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import { freshDb, makeHousehold } from '../testing.ts';
import { createSession, deleteSession, validateSession } from './session.ts';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(freshDb);

describe('sessions', () => {
	it('renews to a full 30 days at most once a day, and expires', () => {
		const { userId } = makeHousehold();
		const { token, expiresAt } = createSession(userId, 0);
		expect(expiresAt).toBe(30 * DAY);

		// Used less than a day after it was set: left as it is.
		const sameDay = validateSession(token, 'admin@example.com', DAY - 1);
		expect(sameDay).toMatchObject({ renewed: false, expiresAt: 30 * DAY, user: { id: userId } });

		// Used a day or more after: 30 days from now again.
		const nextDay = validateSession(token, 'admin@example.com', DAY);
		expect(nextDay).toMatchObject({ renewed: true, expiresAt: 31 * DAY });
		const laterThatDay = validateSession(token, 'admin@example.com', 2 * DAY - 1);
		expect(laterThatDay).toMatchObject({ renewed: false, expiresAt: 31 * DAY });

		expect(validateSession(token, 'admin@example.com', 31 * DAY)).toBeNull();
		expect(db().select().from(sessions).all()).toEqual([]);
	});

	it('marks the admin and forgets deleted sessions', () => {
		const { userId } = makeHousehold();
		const { token } = createSession(userId, 0);
		const email = validateSession(token, 'nobody@example.com', 0)?.user.email ?? '';
		expect(validateSession(token, email, 0)?.user.isAdmin).toBe(true);
		deleteSession(token);
		expect(validateSession(token, email, 0)).toBeNull();
	});
});
