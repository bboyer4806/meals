import { createHash } from 'node:crypto';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, expect, it } from 'vitest';
import { listConnections, registerClient } from '#lib/server/auth/oauth.ts';
import type { SessionUser } from '#lib/server/auth/session.ts';
import { freshDb, makeHousehold } from '#lib/server/testing.ts';
import { actions, load } from './+page.server.ts';

const SITE = 'https://meals.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

let admin: SessionUser;
let clientId: string;

beforeEach(() => {
	freshDb();
	const { householdId, userId } = makeHousehold();
	admin = { id: userId, householdId, email: 'admin@example.com', name: 'Admin', isAdmin: true };
	clientId = registerClient({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' }, 0).body
		.client_id as string;
});

function query(fields: Record<string, string> = {}) {
	return new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CLAUDE,
		code_challenge: createHash('sha256').update('verifier').digest('base64url'),
		code_challenge_method: 'S256',
		state: 'the-state',
		...fields
	});
}

/** What a load or an action threw: where it redirected, or the HTTP status of its error. */
async function outcome(run: () => unknown): Promise<string | number | unknown> {
	try {
		return await run();
	} catch (e) {
		if (isRedirect(e)) return e.location;
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

function open(user: SessionUser | null, params = query()) {
	const url = new URL(`${SITE}/oauth/authorize?${params}`);
	return outcome(() => load({ locals: { user }, url } as unknown as Parameters<typeof load>[0]));
}

function press(button: 'allow' | 'deny', user: SessionUser | null, params = query()) {
	const form = new FormData();
	for (const [name, value] of params) form.set(name, value);
	const request = new Request(`${SITE}/oauth/authorize?/${button}`, { method: 'POST', body: form });
	const event = { locals: { user }, request, url: new URL(request.url) };
	return outcome(() => actions[button](event as unknown as Parameters<(typeof actions)['allow']>[0]));
}

it('asks the admin, and sends someone signed out to sign in and come back', async () => {
	expect(await open(admin)).toMatchObject({ platform: 'Claude' });
	expect(await open(null)).toBe(
		`/login/google?next=${encodeURIComponent(`/oauth/authorize?${query()}`)}`
	);
	expect(await open({ ...admin, isAdmin: false })).toBe(404);
	expect(await press('allow', { ...admin, isAdmin: false })).toBe(404);
	expect(listConnections()).toEqual([]);
});

it('sends the admin back to Claude with a code on Allow, and without one on Deny', async () => {
	const allowed = new URL(String(await press('allow', admin)));
	expect(`${allowed.origin}${allowed.pathname}`).toBe(CLAUDE);
	expect(allowed.searchParams.get('code')).toEqual(expect.any(String));
	expect(listConnections()).toHaveLength(1);

	const denied = new URL(String(await press('deny', admin)));
	expect(denied.searchParams.get('error')).toBe('access_denied');
	expect(denied.searchParams.get('code')).toBeNull();
});

it("shows an error for a client it doesn't know, and sends other problems back to Claude", async () => {
	expect(await open(admin, query({ client_id: 'unknown' }))).toBe(400);
	expect(await open(admin, query({ redirect_uri: 'https://evil.example/callback' }))).toBe(400);
	const refused = new URL(String(await open(null, query({ code_challenge_method: 'plain' }))));
	expect(refused.searchParams.get('error')).toBe('invalid_request');
	expect(await press('allow', admin, query({ redirect_uri: 'https://evil.example/callback' }))).toBe(
		400
	);
});
