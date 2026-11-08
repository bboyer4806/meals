import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exchangeCode, type GoogleClaims } from '#lib/server/auth/google.ts';
import { NOT_INVITED_COOKIE } from '#lib/server/auth/sign-in.ts';
import { freshDb } from '#lib/server/testing.ts';
import { GET } from './+server.ts';

vi.mock('#lib/server/auth/google.ts', () => ({ exchangeCode: vi.fn() }));
vi.mock('#lib/server/config.ts', () => ({ config: () => ({ ADMIN_EMAIL: 'admin@example.com' }) }));

const STRANGER: GoogleClaims = {
	iss: 'https://accounts.google.com',
	aud: 'client-id',
	exp: 0,
	sub: 'sub-stranger',
	email: 'stranger@example.com',
	email_verified: true,
	name: 'Stranger'
};

// The cookies Meals set over http before sending someone to Google.
const STORED = { google_oauth_state: 'state', google_code_verifier: 'v' };

beforeEach(() => {
	freshDb();
	vi.mocked(exchangeCode).mockReset().mockResolvedValue(STRANGER);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Google's redirect back to `url`, with these cookies stored, and what the callback threw. */
async function callback(url: string, stored: Record<string, string>) {
	const cookies = { get: (name: string) => stored[name], set: vi.fn(), delete: vi.fn() };
	const event = { cookies, url: new URL(url) } as unknown as Parameters<typeof GET>[0];
	const thrown = await GET(event).catch((e: unknown) => e);
	return { cookies, location: isRedirect(thrown) ? thrown.location : thrown };
}

it('sends an uninvited account to /not-invited with its address in a cookie', async () => {
	const { cookies, location } = await callback(
		'http://localhost/login/google/callback?code=code&state=state',
		STORED
	);
	expect(location).toBe('/not-invited');
	expect(cookies.set).toHaveBeenCalledWith(NOT_INVITED_COOKIE, 'stranger@example.com', {
		path: '/not-invited'
	});
});

it('over https, takes the state and code verifier only from __Host- cookies (MEA-83)', async () => {
	const url = 'https://meals.dev.boyersoftware.com/login/google/callback?code=code&state=state';

	// Another dev.boyersoftware.com app can set cookies with the plain names for Meals.
	const planted = await callback(url, STORED);
	expect(planted.location).toBe('/login?error=cancelled');

	const own = await callback(url, {
		'__Host-google_oauth_state': 'state',
		'__Host-google_code_verifier': 'v'
	});
	expect(own.location).toBe('/not-invited');
});

// A sign-in that fails goes back to the sign-in page, which says why (design 6.1, MEA-94).

it.each([
	['is cancelled at Google', '?error=access_denied&state=state', STORED],
	['takes more than 10 minutes at Google', '?code=code&state=state', {}],
	['comes back with another state', '?code=code&state=forged', STORED]
])('sends a sign-in that %s back to the sign-in page', async (_, search, stored) => {
	const { location } = await callback(`http://localhost/login/google/callback${search}`, stored);
	expect(location).toBe('/login?error=cancelled');
	expect(exchangeCode).not.toHaveBeenCalled();
});

it('sends a sign-in that Google fails back to the sign-in page, and logs why', async () => {
	const failure = new Error('Google token request failed: 400 invalid_grant');
	vi.mocked(exchangeCode).mockRejectedValue(failure);
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

	const { location } = await callback(
		'http://localhost/login/google/callback?code=code&state=state',
		STORED
	);
	expect(location).toBe('/login?error=failed');
	expect(logged).toHaveBeenCalledExactlyOnceWith('Google sign-in failed', failure);
});

it("sends a sign-in with an address Google hasn't verified back to the sign-in page", async () => {
	vi.mocked(exchangeCode).mockResolvedValue({ ...STRANGER, email_verified: false });

	const { cookies, location } = await callback(
		'http://localhost/login/google/callback?code=code&state=state',
		STORED
	);
	expect(location).toBe('/login?error=unverified');
	expect(cookies.set).not.toHaveBeenCalled();
});
