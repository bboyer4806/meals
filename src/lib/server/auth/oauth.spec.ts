import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { aiConnections, aiTokens, users } from '../db/schema.ts';
import { freshDb, makeHousehold } from '../testing.ts';
import {
	allowConnection,
	denyConnection,
	exchangeToken,
	listConnections,
	platformOf,
	readAuthorizationRequest,
	registerClient,
	revokeConnection,
	validateAccessToken,
	type AuthorizationRequest
} from './oauth.ts';

const SITE = 'https://meals.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const ADMIN = 'admin@example.com';
const VERIFIER = 'a-code-verifier-of-at-least-43-characters-long-ok';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const MINUTE = 60_000;

let adminId: number;

beforeEach(() => {
	freshDb();
	const { userId } = makeHousehold();
	db().update(users).set({ email: ADMIN }).where(eq(users.id, userId)).run();
	adminId = userId;
});

/** Registers a client the way Claude does, with no secret, and gives its client_id. */
function register(redirectUri = CLAUDE, method = 'none', now = 0): string {
	const answer = registerClient(
		{ redirect_uris: [redirectUri], token_endpoint_auth_method: method, client_name: 'Claude' },
		now
	);
	expect(answer.status).toBe(201);
	return answer.body.client_id as string;
}

function authorization(clientId: string, fields: Record<string, string> = {}) {
	return new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CLAUDE,
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 'the-state',
		resource: `${SITE}/mcp`,
		...fields
	});
}

function validRequest(clientId: string): AuthorizationRequest {
	const read = readAuthorizationRequest(authorization(clientId), SITE);
	if (read.kind !== 'valid') throw new Error(`Not valid: ${JSON.stringify(read)}`);
	return read.request;
}

/** Allows the client as the admin and gives the code sent back to it. */
function allow(clientId: string, now = 0): string {
	const back = new URL(allowConnection(validRequest(clientId), adminId, SITE, now));
	expect(`${back.origin}${back.pathname}`).toBe(CLAUDE);
	expect(back.searchParams.get('state')).toBe('the-state');
	// RFC 9207: who answered, so ChatGPT can use its fixed redirect URI.
	expect(back.searchParams.get('iss')).toBe(SITE);
	return back.searchParams.get('code') ?? '';
}

function token(fields: Record<string, string>, now = 0, authorization: string | null = null) {
	return exchangeToken(new URLSearchParams(fields), authorization, SITE, now);
}

function exchange(clientId: string, code: string, now = 0, fields: Record<string, string> = {}) {
	return token(
		{
			grant_type: 'authorization_code',
			client_id: clientId,
			code,
			code_verifier: VERIFIER,
			redirect_uri: CLAUDE,
			...fields
		},
		now
	);
}

/** Connects a client all the way and gives its access and refresh tokens. */
function connect(now = 0): { clientId: string; access: string; refresh: string } {
	const clientId = register();
	const answer = exchange(clientId, allow(clientId, now), now);
	expect(answer.status).toBe(200);
	expect(answer.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
	return {
		clientId,
		access: answer.body.access_token as string,
		refresh: answer.body.refresh_token as string
	};
}

describe('registering (RFC 7591)', () => {
	it("knows ChatGPT's and Claude's redirect URIs, and nothing else", () => {
		expect(platformOf(CLAUDE)).toBe('claude');
		expect(platformOf('https://claude.com/api/mcp/auth_callback')).toBe('claude');
		expect(platformOf(CHATGPT)).toBe('chatgpt');
		expect(platformOf('https://chatgpt.com/connector/oauth/abc_DEF-123')).toBe('chatgpt');
		expect(platformOf('https://platform.openai.com/apps-manage/oauth')).toBe('chatgpt');
		for (const other of [
			'http://claude.ai/api/mcp/auth_callback',
			'https://claude.ai/api/mcp/auth_callback/more',
			'https://claude.ai.evil.example/api/mcp/auth_callback',
			'https://chatgpt.com.evil.example/connector_platform_oauth_redirect',
			'https://chatgpt.com/connector/oauth/a/b',
			'https://evil.example/callback'
		]) {
			expect(platformOf(other), other).toBeNull();
		}
	});

	it('registers ChatGPT or Claude, with a secret unless it asks for none', () => {
		const claude = registerClient({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' }, 0);
		expect(claude.status).toBe(201);
		expect(claude.body).toMatchObject({
			redirect_uris: [CLAUDE],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token']
		});
		expect(claude.body.client_secret).toBeUndefined();

		// RFC 7591's default method is client_secret_basic.
		const chatgpt = registerClient({ redirect_uris: [CHATGPT] }, 0);
		expect(chatgpt.body).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic' });
		expect(chatgpt.body.client_secret).toEqual(expect.any(String));

		const rows = db().select().from(aiConnections).all();
		expect(rows.map((row) => row.platform)).toEqual(['claude', 'chatgpt']);
		// Only a hash of the secret is kept.
		expect(JSON.stringify(rows)).not.toContain(chatgpt.body.client_secret as string);
	});

	it('refuses any other client, and metadata it can’t use', () => {
		const refused = (metadata: unknown) => registerClient(metadata, 0).body.error;
		expect(refused({ redirect_uris: ['https://evil.example/callback'] })).toBe('invalid_redirect_uri');
		expect(refused({ redirect_uris: [CLAUDE, CHATGPT] })).toBe('invalid_redirect_uri');
		expect(refused({ redirect_uris: [] })).toBe('invalid_client_metadata');
		expect(refused(null)).toBe('invalid_client_metadata');
		expect(refused({ redirect_uris: [CLAUDE], grant_types: ['client_credentials'] })).toBe(
			'invalid_client_metadata'
		);
		expect(db().select().from(aiConnections).all()).toEqual([]);
	});

	it('deletes registrations the admin never allowed after a day', () => {
		const day = 24 * 60 * MINUTE;
		const unused = register(CLAUDE, 'none', 0);
		const allowed = register(CLAUDE, 'none', 0);
		allow(allowed);
		register(CLAUDE, 'none', day);
		const left = db().select({ clientId: aiConnections.clientId }).from(aiConnections).all();
		expect(left.map((row) => row.clientId)).not.toContain(unused);
		expect(left.map((row) => row.clientId)).toContain(allowed);
		expect(left).toHaveLength(2);
	});
});

describe('asking the admin', () => {
	it("is invalid for a client or redirect URI Meals doesn't know, so nothing goes back", () => {
		const clientId = register();
		expect(readAuthorizationRequest(authorization('unknown'), SITE)).toEqual({ kind: 'invalid' });
		const elsewhere = authorization(clientId, { redirect_uri: CHATGPT });
		expect(readAuthorizationRequest(elsewhere, SITE)).toEqual({ kind: 'invalid' });
		const missing = authorization(clientId);
		missing.delete('redirect_uri');
		expect(readAuthorizationRequest(missing, SITE)).toEqual({ kind: 'invalid' });
	});

	it('sends a request Meals can’t allow back to the assistant with why', () => {
		const clientId = register();
		const refusal = (fields: Record<string, string>) => {
			const read = readAuthorizationRequest(authorization(clientId, fields), SITE);
			if (read.kind !== 'refused') throw new Error(`Not refused: ${read.kind}`);
			const back = new URL(read.redirectTo);
			expect(`${back.origin}${back.pathname}`).toBe(CLAUDE);
			expect(back.searchParams.get('state')).toBe('the-state');
			expect(back.searchParams.get('iss')).toBe(SITE);
			return back.searchParams.get('error');
		};
		expect(refusal({ response_type: 'token' })).toBe('unsupported_response_type');
		expect(refusal({ code_challenge_method: 'plain' })).toBe('invalid_request');
		expect(refusal({ code_challenge: 'short' })).toBe('invalid_request');
		expect(refusal({ resource: 'https://other.example/mcp' })).toBe('invalid_target');
	});

	it('reads the same request from the form Allow and Deny send', () => {
		const clientId = register();
		const form = new FormData();
		for (const [name, value] of authorization(clientId)) form.set(name, value);
		expect(readAuthorizationRequest(form, SITE)).toEqual({
			kind: 'valid',
			request: {
				clientId,
				platform: 'claude',
				redirectUri: CLAUDE,
				state: 'the-state',
				codeChallenge: CHALLENGE
			}
		});
	});

	it('sends Deny back as access_denied, and connects nothing', () => {
		const clientId = register();
		const back = new URL(denyConnection(validRequest(clientId), SITE));
		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(back.searchParams.get('iss')).toBe(SITE);
		expect(listConnections()).toEqual([]);
	});
});

describe('tokens', () => {
	it('exchanges a code with its PKCE verifier for tokens the MCP endpoint takes', () => {
		const { access } = connect(1000);
		const [connection] = listConnections();
		expect(connection).toMatchObject({ platform: 'claude', authorizedAt: 1000, lastUsedAt: null });
		expect(validateAccessToken(access, ADMIN, 2000)).toEqual({ id: connection!.id, platform: 'claude' });
		expect(listConnections()[0]?.lastUsedAt).toBe(2000);
		// Only hashes are stored.
		expect(JSON.stringify(db().select().from(aiTokens).all())).not.toContain(access);
	});

	it('takes a code once, and only with its verifier and redirect URI, before it expires', () => {
		const clientId = register();
		const used = allow(clientId);
		expect(exchange(clientId, used).status).toBe(200);
		expect(exchange(clientId, used).body.error).toBe('invalid_grant');

		// A wrong verifier uses the code up, so it can't be guessed at.
		const guessed = allow(clientId);
		expect(exchange(clientId, guessed, 0, { code_verifier: 'x'.repeat(43) }).body.error).toBe(
			'invalid_grant'
		);
		expect(exchange(clientId, guessed).body.error).toBe('invalid_grant');

		const elsewhere = allow(clientId);
		const wrongRedirect = { redirect_uri: 'https://claude.com/api/mcp/auth_callback' };
		expect(exchange(clientId, elsewhere, 0, wrongRedirect).body.error).toBe('invalid_grant');

		const late = allow(clientId, 0);
		expect(exchange(clientId, late, 5 * MINUTE).body.error).toBe('invalid_grant');
	});

	it("won't give another client's code to a client", () => {
		const clientId = register();
		const code = allow(clientId);
		const other = register();
		expect(exchange(other, code).body.error).toBe('invalid_grant');
	});

	it('swaps a refresh token for new tokens once', () => {
		const { clientId, refresh } = connect();
		const refreshed = token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }, MINUTE);
		expect(refreshed.status).toBe(200);
		expect(refreshed.body.refresh_token).not.toBe(refresh);
		const again = token({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }, MINUTE);
		expect(again.body.error).toBe('invalid_grant');
		expect(validateAccessToken(refreshed.body.access_token as string, ADMIN, MINUTE)).not.toBeNull();
	});

	it('stops taking an access token after an hour', () => {
		const { access } = connect(0);
		expect(validateAccessToken(access, ADMIN, 60 * MINUTE - 1)).not.toBeNull();
		expect(validateAccessToken(access, ADMIN, 60 * MINUTE)).toBeNull();
		expect(validateAccessToken('unknown', ADMIN, 0)).toBeNull();
	});

	it('checks the secret of a client that registered with one, in a Basic header or the form', () => {
		const registered = registerClient({ redirect_uris: [CLAUDE] }, 0).body;
		const clientId = registered.client_id as string;
		const secret = registered.client_secret as string;
		const basic = (id: string, password: string) =>
			`Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(password)}`).toString('base64')}`;
		const fields = (code: string) => ({
			grant_type: 'authorization_code',
			code,
			code_verifier: VERIFIER,
			redirect_uri: CLAUDE
		});

		expect(token(fields(allow(clientId)), 0, basic(clientId, secret)).status).toBe(200);
		expect(token({ ...fields(allow(clientId)), client_id: clientId, client_secret: secret }).status).toBe(200);
		expect(token(fields(allow(clientId)), 0, basic(clientId, 'wrong')).body.error).toBe('invalid_client');
		expect(token({ ...fields(allow(clientId)), client_id: clientId }).body.error).toBe('invalid_client');
	});

	it("refuses a public client that sends a secret, and grants it doesn't know", () => {
		const clientId = register();
		const code = allow(clientId);
		expect(exchange(clientId, code, 0, { client_secret: 'made-up' }).body.error).toBe('invalid_client');
		expect(token({ grant_type: 'password', client_id: clientId }).body.error).toBe('unsupported_grant_type');
		expect(exchange(clientId, code, 0, { resource: 'https://other.example/mcp' }).body.error).toBe(
			'invalid_target'
		);
	});
});

describe('who a connection works for (design 6.17)', () => {
	it("stops working when its admin isn't the admin anymore", () => {
		const { access } = connect();
		expect(validateAccessToken(access, 'new-admin@example.com', 0)).toBeNull();
	});

	it('is gone with its tokens once revoked, or once its admin is removed', () => {
		const first = connect();
		const [connection] = listConnections();
		revokeConnection(connection!.id);
		expect(validateAccessToken(first.access, ADMIN, 0)).toBeNull();
		const refreshed = token({ grant_type: 'refresh_token', client_id: first.clientId, refresh_token: first.refresh });
		expect(refreshed.body.error).toBe('invalid_client');
		expect(db().select().from(aiTokens).all()).toEqual([]);

		const second = connect();
		db().delete(users).where(eq(users.id, adminId)).run();
		expect(validateAccessToken(second.access, ADMIN, 0)).toBeNull();
		expect(listConnections()).toEqual([]);
	});
});
