import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
	allowConnection,
	exchangeToken,
	readAuthorizationRequest,
	registerClient
} from '#lib/server/auth/oauth.ts';
import { loadConfig } from '#lib/server/config.ts';
import { db } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { freshDb, makeHousehold, TEST_ENV } from '#lib/server/testing.ts';
import { GET, POST } from './+server.ts';

const SITE = 'https://meals.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const METADATA = `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp"`;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

let adminId: number;

beforeEach(() => {
	freshDb();
	adminId = makeHousehold().userId;
	db().update(users).set({ email: TEST_ENV.ADMIN_EMAIL }).where(eq(users.id, adminId)).run();
});

/** Connects Claude as the admin, and gives its access token. */
function accessToken(): string {
	const clientId = registerClient({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' }, 0)
		.body.client_id as string;
	const verifier = 'v'.repeat(43);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CLAUDE,
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256'
	});
	const read = readAuthorizationRequest(params, SITE);
	if (read.kind !== 'valid') throw new Error(read.kind);
	const code = new URL(allowConnection(read.request, adminId, SITE, Date.now())).searchParams.get('code');
	const answer = exchangeToken(
		new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: clientId,
			code: code ?? '',
			code_verifier: verifier,
			redirect_uri: CLAUDE
		}),
		null,
		SITE,
		Date.now()
	);
	return answer.body.access_token as string;
}

function post(body: unknown, headers: Record<string, string> = {}) {
	const request = new Request(`${SITE}/mcp`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request, url: new URL(request.url) } as unknown as Parameters<typeof POST>[0]);
}

const PING = { jsonrpc: '2.0', id: 1, method: 'ping' };

it('points a client without a token at how to connect', async () => {
	const response = await post(PING);
	expect(response.status).toBe(401);
	expect(response.headers.get('www-authenticate')).toBe(METADATA);
});

it('refuses an unknown token, and one whose admin is no longer the admin', async () => {
	const unknown = await post(PING, { authorization: 'Bearer made-up' });
	expect(unknown.status).toBe(401);
	expect(unknown.headers.get('www-authenticate')).toBe(`${METADATA}, error="invalid_token"`);

	const token = accessToken();
	expect((await post(PING, { authorization: `Bearer ${token}` })).status).toBe(200);
	db().update(users).set({ email: 'someone@example.com' }).where(eq(users.id, adminId)).run();
	expect((await post(PING, { authorization: `Bearer ${token}` })).status).toBe(401);
});

it('answers requests as JSON, and notifications with nothing', async () => {
	const authorization = `Bearer ${accessToken()}`;
	const answered = await post(PING, { authorization, 'mcp-protocol-version': '2025-06-18' });
	expect(await answered.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });

	const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization });
	expect(notified.status).toBe(202);

	const unsupported = await post(PING, { authorization, 'mcp-protocol-version': '2024-01-01' });
	expect(unsupported.status).toBe(400);
	const broken = await post('{"jsonrpc":', { authorization });
	expect(await broken.json()).toMatchObject({ error: { code: -32700 } });
});

it('opens no stream of messages from the server', () => {
	expect(GET().status).toBe(405);
});
