import { redirect } from '@sveltejs/kit';
import { cookieName } from '#lib/server/auth/cookies.ts';
import { authorizationUrl, randomToken } from '#lib/server/auth/google.ts';

export function GET({ cookies, url }) {
	const state = randomToken();
	const codeVerifier = randomToken();
	const options = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 } as const;
	cookies.set(cookieName(url, 'google_oauth_state'), state, options);
	cookies.set(cookieName(url, 'google_code_verifier'), codeVerifier, options);
	redirect(302, authorizationUrl(url.origin, state, codeVerifier), {
		external: ['https://accounts.google.com']
	});
}
