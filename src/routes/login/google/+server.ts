import { redirect } from '@sveltejs/kit';
import { cookieName } from '#lib/server/auth/cookies.ts';
import { authorizationUrl, randomToken } from '#lib/server/auth/google.ts';
import { RETURN_COOKIE, returnPath } from '#lib/server/auth/sign-in.ts';

export function GET({ cookies, url }) {
	const state = randomToken();
	const codeVerifier = randomToken();
	const options = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 } as const;
	cookies.set(cookieName(url, 'google_oauth_state'), state, options);
	cookies.set(cookieName(url, 'google_code_verifier'), codeVerifier, options);
	// The page to come back to, such as an AI assistant's connection page (6.1, 6.17).
	const next = returnPath(url.searchParams.get('next'), url.origin);
	if (next === null) cookies.delete(cookieName(url, RETURN_COOKIE), { path: '/' });
	else cookies.set(cookieName(url, RETURN_COOKIE), next, options);
	redirect(302, authorizationUrl(url.origin, state, codeVerifier), {
		external: ['https://accounts.google.com']
	});
}
