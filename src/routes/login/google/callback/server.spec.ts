import { isRedirect } from '@sveltejs/kit';
import { beforeEach, expect, it, vi } from 'vitest';
import { exchangeCode, type GoogleClaims } from '#lib/server/auth/google.ts';
import { NOT_INVITED_COOKIE } from '#lib/server/auth/sign-in.ts';
import { freshDb } from '#lib/server/testing.ts';
import { GET } from './+server.ts';

vi.mock('#lib/server/auth/google.ts', () => ({ exchangeCode: vi.fn() }));
vi.mock('#lib/server/config.ts', () => ({ config: () => ({ ADMIN_EMAIL: 'admin@example.com' }) }));

const CALLBACK = 'http://localhost/login/google/callback';
// The state and code verifier cookies that starting a sign-in sets over http (../+server.ts).
const STARTED = { google_oauth_state: 'state', google_code_verifier: 'v' };

const STRANGER: GoogleClaims = {
	iss: 'https://accounts.google.com',
	aud: 'client-id',
	exp: 0,
	sub: 'sub-stranger',
	email: 'stranger@example.com',
	email_verified: true,
	name: 'Stranger'
};

beforeEach(() => {
	freshDb();
	vi.mocked(exchangeCode).mockReset().mockResolvedValue(STRANGER);
});

/**
 * Google sending someone back to the callback at `url` with the cookies `stored`. Gives where the
 * callback redirected, or whatever else it threw or returned, and the cookies it set.
 */
async function callback(url: string, stored: Record<string, string>) {
	const cookies = { get: (name: string) => stored[name], set: vi.fn(), delete: vi.fn() };
	const event = { cookies, url: new URL(url) } as unknown as Parameters<typeof GET>[0];
	const thrown = await GET(event).catch((e: unknown) => e);
	return { to: isRedirect(thrown) ? thrown.location : thrown, set: cookies.set };
}

it('sends an uninvited account to /not-invited with its address in a cookie', async () => {
	const { to, set } = await callback(`${CALLBACK}?code=code&state=state`, STARTED);
	expect(to).toBe('/not-invited');
	expect(set).toHaveBeenCalledWith(NOT_INVITED_COOKIE, 'stranger@example.com', {
		path: '/not-invited'
	});
});

it('over https, takes the state and code verifier only from __Host- cookies (MEA-83)', async () => {
	const url = 'https://meals.dev.boyersoftware.com/login/google/callback?code=code&state=state';

	// Another dev.boyersoftware.com app can set cookies with the plain names for Meals.
	const planted = await callback(url, STARTED);
	expect(planted.to).toBe('/login?error=cancelled');

	const own = await callback(url, {
		'__Host-google_oauth_state': 'state',
		'__Host-google_code_verifier': 'v'
	});
	expect(own.to).toBe('/not-invited');
});

it('sends a cancelled or expired sign-in back to the sign-in page to say so (MEA-94)', async () => {
	// Cancel on Google's consent screen, or an error there: Google sends no code.
	expect((await callback(`${CALLBACK}?error=access_denied&state=state`, STARTED)).to).toBe(
		'/login?error=cancelled'
	);
	// More than 10 minutes at Google, so the cookies expired, or Back to Google's account chooser
	// after signing in, which comes again without the cookies the first sign-in used up.
	expect((await callback(`${CALLBACK}?code=code&state=state`, {})).to).toBe(
		'/login?error=cancelled'
	);
	// Another sign-in's state.
	expect((await callback(`${CALLBACK}?code=code&state=other`, STARTED)).to).toBe(
		'/login?error=cancelled'
	);
	expect(exchangeCode).not.toHaveBeenCalled();
});

it("sends someone back to the sign-in page when Meals can't get their account from Google, and logs why (MEA-94)", async () => {
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	const refused = new Error('Google token request failed: 400');
	vi.mocked(exchangeCode).mockRejectedValueOnce(refused);
	try {
		const { to, set } = await callback(`${CALLBACK}?code=code&state=state`, STARTED);
		expect(to).toBe('/login?error=failed');
		expect(set).not.toHaveBeenCalled();
		expect(logged).toHaveBeenCalledWith('Google sign-in failed', refused);
	} finally {
		logged.mockRestore();
	}
});

it('goes back to the page the sign-in started from, on this site only (6.17)', async () => {
	vi.mocked(exchangeCode).mockResolvedValue({ ...STRANGER, sub: 'sub-admin', email: 'admin@example.com' });
	const page = '/oauth/authorize?client_id=abc&state=xyz';
	expect((await callback(`${CALLBACK}?code=code&state=state`, { ...STARTED, login_return: page })).to).toBe(
		page
	);
	const elsewhere = { ...STARTED, login_return: 'https://evil.example/' };
	expect((await callback(`${CALLBACK}?code=code&state=state`, elsewhere)).to).toBe('/');
	expect((await callback(`${CALLBACK}?code=code&state=state`, STARTED)).to).toBe('/');
});

it("sends an account whose email Google hasn't verified back to the sign-in page (MEA-94)", async () => {
	vi.mocked(exchangeCode).mockResolvedValueOnce({ ...STRANGER, email_verified: false });
	const { to, set } = await callback(`${CALLBACK}?code=code&state=state`, STARTED);
	expect(to).toBe('/login?error=unverified');
	// Neither signed in nor turned away as uninvited.
	expect(set).not.toHaveBeenCalled();
});
