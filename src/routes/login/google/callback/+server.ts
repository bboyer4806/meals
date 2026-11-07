import { error, redirect } from '@sveltejs/kit';
import { cookieName } from '#lib/server/auth/cookies.ts';
import { exchangeCode, type GoogleClaims } from '#lib/server/auth/google.ts';
import { createSession, setSessionCookie } from '#lib/server/auth/session.ts';
import { NOT_INVITED_COOKIE, signIn } from '#lib/server/auth/sign-in.ts';
import { config } from '#lib/server/config.ts';

export async function GET({ cookies, url }) {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const stateCookie = cookieName(url, 'google_oauth_state');
	const verifierCookie = cookieName(url, 'google_code_verifier');
	const storedState = cookies.get(stateCookie);
	const codeVerifier = cookies.get(verifierCookie);
	cookies.delete(stateCookie, { path: '/' });
	cookies.delete(verifierCookie, { path: '/' });
	if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
		error(400, 'Sign-in was cancelled or expired. Please try again.');
	}

	let claims: GoogleClaims;
	try {
		claims = await exchangeCode(url.origin, code, codeVerifier, Date.now());
	} catch (e) {
		console.error('Google sign-in failed', e);
		error(400, 'Google sign-in failed. Please try again.');
	}
	if (!claims.email_verified) error(403, 'Google has not verified this email address.');

	const now = Date.now();
	const result = signIn(
		{ sub: claims.sub, email: claims.email, name: claims.name ?? claims.email },
		config().ADMIN_EMAIL,
		now
	);
	if (result.kind === 'not-invited') {
		// In a cookie rather than the URL, so the page can only ever show the address that was
		// really used, and the address stays out of URLs and logs. It lasts until the browser
		// closes, so the address is still there after leaving to ask for an invite.
		cookies.set(NOT_INVITED_COOKIE, result.email, { path: '/not-invited' });
		redirect(303, '/not-invited');
	}
	const session = createSession(result.userId, now);
	setSessionCookie(cookies, url, session.token, session.expiresAt);
	redirect(303, '/');
}
