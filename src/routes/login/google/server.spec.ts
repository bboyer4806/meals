import { isRedirect } from '@sveltejs/kit';
import { expect, it, vi } from 'vitest';
import { GET } from './+server.ts';

vi.mock('#lib/server/config.ts', () => ({ config: () => ({ GOOGLE_CLIENT_ID: 'client-id' }) }));

it('over https, sets the state and code verifier as __Host- cookies (MEA-83)', async () => {
	const cookies = { set: vi.fn() };
	const url = new URL('https://meals.dev.boyersoftware.com/login/google');

	const thrown = await Promise.resolve()
		.then(() => GET({ cookies, url } as unknown as Parameters<typeof GET>[0]))
		.catch((e: unknown) => e);
	expect(isRedirect(thrown)).toBe(true);
	expect(cookies.set.mock.calls.map(([name]) => name)).toEqual([
		'__Host-google_oauth_state',
		'__Host-google_code_verifier'
	]);
});
