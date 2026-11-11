import { isRedirect } from '@sveltejs/kit';
import { expect, it, vi } from 'vitest';
import { GET } from './+server.ts';

vi.mock('#lib/server/config.ts', () => ({ config: () => ({ GOOGLE_CLIENT_ID: 'client-id' }) }));

/** Starts a sign-in at `url`, and gives the cookies it set and deleted. */
async function start(url: string) {
	const cookies = { set: vi.fn(), delete: vi.fn() };
	const thrown = await Promise.resolve()
		.then(() => GET({ cookies, url: new URL(url) } as unknown as Parameters<typeof GET>[0]))
		.catch((e: unknown) => e);
	expect(isRedirect(thrown)).toBe(true);
	return cookies;
}

it('over https, sets the state and code verifier as __Host- cookies (MEA-83)', async () => {
	const cookies = await start('https://meals.dev.boyersoftware.com/login/google');
	expect(cookies.set.mock.calls.map(([name]) => name)).toEqual([
		'__Host-google_oauth_state',
		'__Host-google_code_verifier'
	]);
	// No page to come back to, so none left from a sign-in that didn't finish either.
	expect(cookies.delete).toHaveBeenCalledWith('__Host-login_return', { path: '/' });
});

it('keeps the page on this site to come back to after signing in (6.17)', async () => {
	const next = encodeURIComponent('/oauth/authorize?client_id=abc&state=xyz');
	const cookies = await start(`https://meals.dev.boyersoftware.com/login/google?next=${next}`);
	expect(cookies.set).toHaveBeenCalledWith(
		'__Host-login_return',
		'/oauth/authorize?client_id=abc&state=xyz',
		expect.objectContaining({ httpOnly: true, maxAge: 600 })
	);

	for (const elsewhere of ['https://evil.example/', '//evil.example/', '/\\evil.example/']) {
		const away = await start(
			`https://meals.dev.boyersoftware.com/login/google?next=${encodeURIComponent(elsewhere)}`
		);
		expect(away.set.mock.calls.map(([name]) => name)).not.toContain('__Host-login_return');
	}
});
