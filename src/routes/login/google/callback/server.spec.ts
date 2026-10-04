import { isRedirect } from '@sveltejs/kit';
import { beforeEach, expect, it, vi } from 'vitest';
import { NOT_INVITED_COOKIE } from '#lib/server/auth/sign-in.ts';
import { freshDb } from '#lib/server/testing.ts';
import { GET } from './+server.ts';

vi.mock('#lib/server/auth/google.ts', () => ({
	exchangeCode: async () => ({
		sub: 'sub-stranger',
		email: 'stranger@example.com',
		email_verified: true,
		name: 'Stranger'
	})
}));
vi.mock('#lib/server/config.ts', () => ({ config: () => ({ ADMIN_EMAIL: 'admin@example.com' }) }));

beforeEach(freshDb);

it('sends an uninvited account to /not-invited with its address in a cookie', async () => {
	const stored: Record<string, string> = { google_oauth_state: 'state', google_code_verifier: 'v' };
	const cookies = { get: (name: string) => stored[name], set: vi.fn(), delete: vi.fn() };
	const url = new URL('http://localhost/login/google/callback?code=code&state=state');

	const thrown = await GET({ cookies, url } as unknown as Parameters<typeof GET>[0]).catch(
		(e: unknown) => e
	);
	expect(isRedirect(thrown) && thrown.location).toBe('/not-invited');
	expect(cookies.set).toHaveBeenCalledWith(NOT_INVITED_COOKIE, 'stranger@example.com', {
		path: '/not-invited'
	});
});
