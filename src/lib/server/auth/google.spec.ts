import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { authorizationUrl, exchangeCode } from './google.ts';

const ORIGIN = 'https://meals.example.com';
const NOW = Date.UTC(2026, 9, 3);

beforeAll(() => {
	loadConfig({
		GOOGLE_CLIENT_ID: 'client-id',
		GOOGLE_CLIENT_SECRET: 'client-secret',
		ADMIN_EMAIL: 'admin@example.com',
		DATA_DIR: '/tmp'
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function idToken(claims: Record<string, unknown>) {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

const goodClaims = {
	iss: 'https://accounts.google.com',
	aud: 'client-id',
	exp: NOW / 1000 + 3600,
	sub: '1234',
	email: 'pat@example.com',
	email_verified: true,
	name: 'Pat'
};

function stubToken(claims: Record<string, unknown>, status = 200) {
	const fetch = vi.fn(async () =>
		Response.json(status === 200 ? { id_token: idToken(claims) } : { error: 'invalid_grant' }, {
			status
		})
	);
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

describe('authorizationUrl', () => {
	it('asks Google for the code flow with PKCE and our redirect URI', () => {
		const url = authorizationUrl(ORIGIN, 'state-1', 'verifier-1');
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			response_type: 'code',
			client_id: 'client-id',
			redirect_uri: `${ORIGIN}/login/google/callback`,
			scope: 'openid email profile',
			state: 'state-1',
			code_challenge_method: 'S256'
		});
		expect(url.searchParams.get('code_challenge')).not.toBe('verifier-1');
	});
});

describe('exchangeCode', () => {
	it('returns the claims and sends the verifier and secret', async () => {
		const fetch = stubToken(goodClaims);
		await expect(exchangeCode(ORIGIN, 'code-1', 'verifier-1', NOW)).resolves.toMatchObject({
			sub: '1234',
			email: 'pat@example.com'
		});
		const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
		expect(body.get('code_verifier')).toBe('verifier-1');
		expect(body.get('client_secret')).toBe('client-secret');
	});

	it('rejects a token for another client, from another issuer, or expired', async () => {
		stubToken({ ...goodClaims, aud: 'someone-else' });
		await expect(exchangeCode(ORIGIN, 'c', 'v', NOW)).rejects.toThrow(/another client/);
		stubToken({ ...goodClaims, iss: 'https://evil.example.com' });
		await expect(exchangeCode(ORIGIN, 'c', 'v', NOW)).rejects.toThrow();
		stubToken({ ...goodClaims, exp: NOW / 1000 - 1 });
		await expect(exchangeCode(ORIGIN, 'c', 'v', NOW)).rejects.toThrow(/expired/);
	});

	it('fails when Google refuses the code', async () => {
		stubToken(goodClaims, 400);
		await expect(exchangeCode(ORIGIN, 'c', 'v', NOW)).rejects.toThrow(/400/);
	});
});
