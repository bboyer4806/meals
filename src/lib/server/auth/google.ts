import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.ts';

// Google sign-in with the OAuth authorization code flow and PKCE.

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** The redirect URI must be registered in Google Cloud Console for this origin. */
function redirectUri(origin: string): string {
	return `${origin}/login/google/callback`;
}

/** A random value for the `state` check or the PKCE code verifier. */
export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

export function authorizationUrl(origin: string, state: string, codeVerifier: string): URL {
	const url = new URL(AUTHORIZE_URL);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: config().GOOGLE_CLIENT_ID,
		redirect_uri: redirectUri(origin),
		scope: 'openid email profile',
		state,
		code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
		code_challenge_method: 'S256',
		// Lets people with several Google accounts pick the one they were invited with.
		prompt: 'select_account'
	}).toString();
	return url;
}

const tokenResponse = z.object({ id_token: z.string() });

const idTokenClaims = z.object({
	iss: z.enum(['https://accounts.google.com', 'accounts.google.com']),
	aud: z.string(),
	exp: z.number(),
	sub: z.string(),
	email: z.string(),
	email_verified: z.boolean(),
	name: z.string().optional()
});

export type GoogleClaims = z.output<typeof idTokenClaims>;

/**
 * Exchanges the code from Google's redirect for the person's ID token claims. The token comes
 * straight from Google's token endpoint over TLS, so OpenID Connect (Core 3.1.3.7) doesn't require
 * checking its signature; its issuer, audience and expiry are still checked.
 */
export async function exchangeCode(
	origin: string,
	code: string,
	codeVerifier: string,
	now: number
): Promise<GoogleClaims> {
	const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = config();
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { accept: 'application/json' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			code_verifier: codeVerifier,
			redirect_uri: redirectUri(origin),
			client_id: GOOGLE_CLIENT_ID,
			client_secret: GOOGLE_CLIENT_SECRET
		})
	});
	if (!response.ok) {
		throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
	}
	const { id_token: idToken } = tokenResponse.parse(await response.json());

	const payload = idToken.split('.')[1];
	if (!payload) throw new Error('Google returned a malformed ID token');
	const claims = idTokenClaims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
	if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('The ID token is for another client');
	if (claims.exp * 1000 <= now) throw new Error('The ID token has expired');
	return claims;
}
