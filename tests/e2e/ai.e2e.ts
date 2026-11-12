import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { addItem, addPerson, adminId, expect, open, signInAs, test } from './fixtures.ts';

// ChatGPT and Claude connecting to Meals as the admin, reading households and proposing changes
// that happen only when the admin approves them (design 6.17). The tests play the assistant's
// server with Playwright's request, which sends no Origin, as a server doesn't.

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

// Admin lists every connection, newest first, so one test's Revoke must not meet another's.
test.describe.configure({ mode: 'serial' });

async function register(request: APIRequestContext): Promise<string> {
	const registered = await request.post('/oauth/register', {
		data: {
			client_name: 'Claude',
			redirect_uris: [CLAUDE],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		}
	});
	expect(registered.status()).toBe(201);
	return (await registered.json()).client_id;
}

/** The address of the page where Claude asks the admin, and the PKCE verifier it keeps. */
function authorization(clientId: string, baseURL: string | undefined) {
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CLAUDE,
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		state: 'claude-state',
		resource: `${baseURL}/mcp`
	});
	return { path: `/oauth/authorize?${query}`, verifier };
}

/**
 * Presses Allow, and gives where the server sends the browser back to Claude. The browser doesn't
 * go there, so a test never reaches the real Claude: Playwright can't catch a request a redirect
 * makes, so Allow's own request is answered here once the server has answered it.
 */
async function allow(page: Page): Promise<URL> {
	let back: URL | undefined;
	await page.route(
		(url) => url.pathname === '/oauth/authorize' && url.search.startsWith('?/'),
		async (route) => {
			const response = await route.fetch({ maxRedirects: 0 });
			expect(response.status()).toBe(303);
			back = new URL(response.headers().location ?? '');
			await route.fulfill({ contentType: 'text/html', body: '<p>Back in Claude</p>' });
		}
	);
	await page.getByRole('button', { name: 'Allow' }).click();
	await expect(page.getByText('Back in Claude')).toBeVisible();
	if (!back) throw new Error('Allow sent nothing back');
	return back;
}

/** Calls the MCP endpoint as Claude, and gives a tool's result. */
function mcp(request: APIRequestContext, token: string) {
	const send = (method: string, params: object) =>
		request.post('/mcp', {
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-06-18'
			},
			data: { jsonrpc: '2.0', id: 1, method, params }
		});
	return {
		send,
		call: async (name: string, args: object) => {
			const answer = await (await send('tools/call', { name, arguments: args })).json();
			return JSON.parse(answer.result.content[0].text);
		}
	};
}

test('connects Claude as the admin to read households and make the changes the admin approves', async ({
	page,
	db,
	context,
	baseURL,
	request
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	const other = addPerson(db);
	addItem(db, other.householdId, 'Oat milk');

	const clientId = await register(request);
	const { path, verifier } = authorization(clientId, baseURL);
	await open(page, path);
	await expect(page.getByRole('heading', { name: 'Connect Claude to Meals?' })).toBeVisible();
	const back = await allow(page);
	expect(`${back.origin}${back.pathname}`).toBe(CLAUDE);
	expect(back.searchParams.get('state')).toBe('claude-state');
	expect(back.searchParams.get('iss')).toBe(baseURL);

	// Claude's server swaps the code for tokens: a form, from another site.
	const tokens = await request.post('/oauth/token', {
		form: {
			grant_type: 'authorization_code',
			client_id: clientId,
			code: back.searchParams.get('code') ?? '',
			code_verifier: verifier,
			redirect_uri: CLAUDE
		}
	});
	expect(tokens.status()).toBe(200);
	const claude = mcp(request, (await tokens.json()).access_token);

	const init = await claude.send('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
	const initialized = await init.json();
	expect(initialized.result.serverInfo.name).toBe('meals');
	const { households } = await claude.call('list_households', {});
	expect(households.map((household: { id: number }) => household.id)).toContain(other.householdId);

	const proposal = await claude.call('propose_changes', {
		summary: 'Oat milk for the week',
		changes: [
			{
				operation: 'add_grocery_line',
				householdId: other.householdId,
				itemName: 'Oat milk',
				quantity: 2,
				unit: 'cartons',
				store: 'none'
			}
		]
	});
	expect(proposal.status).toBe('pending');
	const lines = () =>
		db
			.prepare(
				`select quantity, unit, status from grocery_needs n join items i on i.id = n.item_id
				where n.household_id = ? and i.name = 'Oat milk'`
			)
			.all(other.householdId);
	expect(lines()).toEqual([]);

	// The admin opens the link and approves.
	await open(page, new URL(proposal.url).pathname);
	await expect(page.getByRole('heading', { name: 'Changes from Claude' })).toBeVisible();
	const change = page.getByRole('listitem').filter({ hasText: 'Add to the grocery list' });
	await expect(change).toContainText(`(household ${other.householdId})`);
	await expect(change).toContainText('Oat milk');
	await expect(change).toContainText('2 cartons');
	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByRole('status')).toContainText('The changes were made.');
	await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
	expect(lines()).toEqual([{ quantity: 2, unit: 'cartons', status: 'to_order' }]);
	expect((await claude.call('get_proposal', { proposalId: proposal.proposalId })).status).toBe(
		'approved'
	);

	// Revoking it on Admin stops it at once.
	await open(page, '/admin');
	const newest = page.getByRole('listitem').filter({ hasText: 'Claude connected' }).first();
	await newest.getByRole('button', { name: 'Revoke' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	expect((await claude.send('ping', {})).status()).toBe(401);
});

test('rejects a proposal, which changes nothing', async ({ page, db, context, baseURL, request }) => {
	await signInAs(db, context, baseURL, adminId(db));
	const other = addPerson(db);
	const clientId = await register(request);
	const { path, verifier } = authorization(clientId, baseURL);
	await open(page, path);
	const back = await allow(page);
	const tokens = await request.post('/oauth/token', {
		form: {
			grant_type: 'authorization_code',
			client_id: clientId,
			code: back.searchParams.get('code') ?? '',
			code_verifier: verifier,
			redirect_uri: CLAUDE
		}
	});
	const claude = mcp(request, (await tokens.json()).access_token);
	const name = `Renamed ${Date.now()}`;
	const proposal = await claude.call('propose_changes', {
		summary: 'A new name',
		changes: [
			{
				operation: 'update_household',
				householdId: other.householdId,
				name,
				defaultServings: 2,
				timeZone: 'America/Chicago'
			}
		]
	});

	await open(page, new URL(proposal.url).pathname);
	await page.getByRole('button', { name: 'Reject' }).click();
	await expect(page.getByRole('status')).toContainText('Nothing was changed.');
	const household = db.prepare('select name from households where id = ?').get(other.householdId);
	expect(household).not.toEqual({ name });
	expect((await claude.call('get_proposal', { proposalId: proposal.proposalId })).status).toBe(
		'rejected'
	);
});

test('lets only the admin allow a connection or see a proposal', async ({
	page,
	request,
	baseURL,
	person: _signedIn
}) => {
	const clientId = await register(request);
	const { path } = authorization(clientId, baseURL);
	expect((await page.goto(path))?.status()).toBe(404);
	expect((await page.goto('/ai/proposals/1'))?.status()).toBe(404);

	// Someone signed out signs in with Google first, and comes back to the same page.
	const signedOut = await request.get(path, { maxRedirects: 0 });
	expect(signedOut.status()).toBe(303);
	expect(signedOut.headers().location).toBe(`/login/google?next=${encodeURIComponent(path)}`);
});

test('refuses forms from other sites, but for the token endpoint ChatGPT and Claude use', async ({
	request,
	baseURL
}) => {
	const form = { id: '1' };
	const elsewhere = await request.post('/admin?/cancelInvite', {
		form,
		headers: { origin: 'https://evil.example' }
	});
	expect(elsewhere.status()).toBe(403);
	expect((await request.post('/admin?/cancelInvite', { form })).status()).toBe(403);
	const same = await request.post('/admin?/cancelInvite', { form, headers: { origin: baseURL ?? '' } });
	expect(same.status()).not.toBe(403);

	const token = await request.post('/oauth/token', { form: { grant_type: 'authorization_code' } });
	expect(token.status()).toBe(401);
	expect(await token.json()).toMatchObject({ error: 'invalid_client' });
});

test('tells assistants how to connect', async ({ request, baseURL }) => {
	const unauthorized = await request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } });
	expect(unauthorized.status()).toBe(401);
	expect(unauthorized.headers()['www-authenticate']).toBe(
		`Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource/mcp"`
	);
	const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json();
	expect(resource).toMatchObject({ resource: `${baseURL}/mcp`, authorization_servers: [baseURL] });
	expect(await (await request.get('/.well-known/oauth-protected-resource')).json()).toEqual(resource);
	const server = await (await request.get('/.well-known/oauth-authorization-server')).json();
	expect(server).toMatchObject({
		issuer: baseURL,
		registration_endpoint: `${baseURL}/oauth/register`,
		code_challenge_methods_supported: ['S256'],
		authorization_response_iss_parameter_supported: true
	});
});
