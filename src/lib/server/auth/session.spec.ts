import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, makeHousehold } from '../testing.ts';
import { createSession, deleteSession, validateSession } from './session.ts';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(freshDb);

describe('sessions', () => {
	it('validates, renews near expiry, and expires', () => {
		const { userId } = makeHousehold();
		const { token, expiresAt } = createSession(userId, 0);
		expect(expiresAt).toBe(30 * DAY);

		const fresh = validateSession(token, 'admin@example.com', 1 * DAY);
		expect(fresh).toMatchObject({ renewed: false, expiresAt: 30 * DAY, user: { id: userId } });

		const renewed = validateSession(token, 'admin@example.com', 20 * DAY);
		expect(renewed).toMatchObject({ renewed: true, expiresAt: 50 * DAY });

		expect(validateSession(token, 'admin@example.com', 51 * DAY)).toBeNull();
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
