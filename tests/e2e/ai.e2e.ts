import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import {
	addItem,
	addPerson,
	addPhotoFiles,
	addRecipe,
	adminId,
	expect,
	makeJpeg,
	open,
	photoFile,
	signInAs,
	test
} from './fixtures.ts';

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

// Images (MEA-276). The server can't fetch an image from these tests, since it refuses their
// addresses (design 4.5), so these write a proposal with its images straight into the database, as
// proposing saves one.

type SavedChange = { change: object; preview: object };

/** Claude's connection, allowed by the admin, written straight into the database. */
function addConnection(db: Database.Database, userId: number): number {
	const now = Date.now();
	return Number(
		db
			.prepare(
				`insert into ai_connections (client_id, platform, redirect_uris, created_at, user_id, authorized_at)
				values (?, 'claude', ?, ?, ?, ?)`
			)
			.run(`client-${randomBytes(8).toString('hex')}`, JSON.stringify([CLAUDE]), now, userId, now)
			.lastInsertRowid
	);
}

/** A proposal waiting for the admin, saved as proposing these changes saves it. */
function addProposal(db: Database.Database, connectionId: number, changes: SavedChange[]): number {
	const now = Date.now();
	return Number(
		db
			.prepare(
				`insert into ai_proposals (connection_id, content, status, created_at, expires_at)
				values (?, ?, 'pending', ?, ?)`
			)
			.run(connectionId, JSON.stringify({ summary: 'Photos', changes }), now, now + 24 * 60 * 60 * 1000)
			.lastInsertRowid
	);
}

/** A picture stored as the server stores a proposed image: 1200 x 900, with its thumbnail. */
async function addImage(page: Page, hue: number): Promise<string> {
	const photo = await makeJpeg(page, { width: 1200, height: 900, hue });
	return addPhotoFiles(photo, await makeJpeg(page, { width: 400, height: 300, hue }));
}

function householdName(db: Database.Database, householdId: number): string {
	return db.prepare('select name from households where id = ?').pluck().get(householdId) as string;
}

const PIE_LINK = 'https://recipes.example/apple-pie.jpg';
const MILK_LINK = 'https://shop.example/milk.jpg';

/** A change giving the household's item an image, as proposing saves it. */
function itemImage(
	db: Database.Database,
	householdId: number,
	item: { id: number; name: string; photoKey: string | null },
	photoKey: string
): SavedChange {
	// As the page shows the item's image now: none, or the image with its key.
	const imageNow =
		item.photoKey === null
			? { name: 'Image', value: 'None' }
			: { name: 'Image', value: 'An image', photoKey: item.photoKey };
	return {
		change: { operation: 'set_item_image', householdId, itemId: item.id, imageUrl: MILK_LINK, replace: true, photoKey },
		preview: {
			title: item.photoKey === null ? 'Add an image to an item' : "Replace an item's image",
			householdId,
			householdName: householdName(db, householdId),
			record: `Item ${item.id}`,
			current: [{ name: 'Name', value: item.name }, imageNow],
			proposed: [{ name: 'Image', value: MILK_LINK, photoKey }]
		}
	};
}

/** Checks the image has loaded, and gives its width. */
async function loadedWidth(image: Locator): Promise<number> {
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth))
		.toBeGreaterThan(0);
	return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

test('shows the admin the images a proposal would give, which approving gives', async ({
	page,
	db,
	context,
	baseURL
}) => {
	const admin = adminId(db);
	await signInAs(db, context, baseURL, admin);
	const other = addPerson(db);
	const pie = addRecipe(db, other.householdId, { name: 'Apple pie', steps: 'Bake' });
	const milk = addItem(db, other.householdId, 'Milk');
	const oldMilk = await addImage(page, 200);
	db.prepare('update items set photo_key = ? where id = ?').run(oldMilk, milk);
	const pieImage = await addImage(page, 20);
	const milkImage = await addImage(page, 100);
	const proposalId = addProposal(db, addConnection(db, admin), [
		{
			change: {
				operation: 'set_recipe_image',
				householdId: other.householdId,
				recipeId: pie,
				imageUrl: PIE_LINK,
				replace: false,
				photoKey: pieImage
			},
			preview: {
				title: 'Add an image to a recipe',
				householdId: other.householdId,
				householdName: householdName(db, other.householdId),
				record: `Recipe ${pie}`,
				current: [
					{ name: 'Name', value: 'Apple pie' },
					{ name: 'Image', value: 'None' }
				],
				proposed: [{ name: 'Image', value: PIE_LINK, photoKey: pieImage }]
			}
		},
		itemImage(db, other.householdId, { id: milk, name: 'Milk', photoKey: oldMilk }, milkImage)
	]);

	await open(page, `/ai/proposals/${proposalId}`);
	const pieChange = page.getByRole('listitem').filter({ hasText: 'Add an image to a recipe' });
	await expect(pieChange).toContainText(`Recipe ${pie}`);
	await expect(pieChange).toContainText(PIE_LINK);
	const proposedPie = pieChange.getByRole('img', { name: 'The proposed image' });
	await expect(proposedPie).toHaveAttribute('src', `/ai/proposals/${proposalId}/photos/${pieImage}.jpg`);
	// The whole image, as approving gives it to the recipe.
	expect(await loadedWidth(proposedPie)).toBe(1200);
	const milkChange = page.getByRole('listitem').filter({ hasText: "Replace an item's image" });
	expect(await loadedWidth(milkChange.getByRole('img', { name: 'The image now' }))).toBe(1200);
	await expect(milkChange.getByRole('img', { name: 'The image now' })).toHaveAttribute(
		'src',
		`/ai/proposals/${proposalId}/photos/${oldMilk}.jpg`
	);
	await expect(milkChange.getByRole('img', { name: 'The proposed image' })).toHaveAttribute(
		'src',
		`/ai/proposals/${proposalId}/photos/${milkImage}.jpg`
	);

	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByRole('status')).toContainText('The changes were made.');
	await expect(page.getByRole('listitem').getByRole('img')).toHaveCount(0);
	expect(db.prepare('select photo_key from dishes where id = ?').pluck().get(pie)).toBe(pieImage);
	expect(db.prepare('select photo_key from items where id = ?').pluck().get(milk)).toBe(milkImage);
	// The image the item had goes, and the approved ones stay.
	expect(existsSync(photoFile(oldMilk, 'full'))).toBe(false);
	expect(existsSync(photoFile(milkImage, 'thumb'))).toBe(true);

	// The household sees them where it sees any recipe's photo or item's image.
	await context.clearCookies();
	await signInAs(db, context, baseURL, other.userId);
	await open(page, '/recipes');
	const card = page.getByRole('link', { name: /Apple pie/ });
	await expect(card.locator('img')).toHaveAttribute('src', `/photos/${pieImage}-thumb.jpg`);
	expect(await loadedWidth(card.locator('img'))).toBe(400);
	await open(page, '/groceries/items');
	const row = page.getByRole('button', { name: /^Milk/ });
	await expect(row.locator('img')).toHaveAttribute('src', `/photos/${milkImage}-thumb.jpg`);
	// Only the admin sees a proposal's images. Asked without the browser's cache, which still has
	// the admin's copy.
	const preview = await page.request.get(`/ai/proposals/${proposalId}/photos/${milkImage}.jpg`);
	expect(preview.status()).toBe(404);
});

test('deletes the image a rejected proposal stored, changing nothing', async ({
	page,
	db,
	context,
	baseURL
}) => {
	const admin = adminId(db);
	await signInAs(db, context, baseURL, admin);
	const other = addPerson(db);
	const eggs = addItem(db, other.householdId, 'Eggs');
	const image = await addImage(page, 40);
	const proposalId = addProposal(db, addConnection(db, admin), [
		itemImage(db, other.householdId, { id: eggs, name: 'Eggs', photoKey: null }, image)
	]);

	await open(page, `/ai/proposals/${proposalId}`);
	await expect(page.getByRole('img', { name: 'The proposed image' })).toBeVisible();
	await page.getByRole('button', { name: 'Reject' }).click();
	await expect(page.getByRole('status')).toContainText('Nothing was changed.');
	expect(db.prepare('select photo_key from items where id = ?').pluck().get(eggs)).toBeNull();
	expect(existsSync(photoFile(image, 'full'))).toBe(false);
	expect(existsSync(photoFile(image, 'thumb'))).toBe(false);
});

test("refuses an image link Meals can't get an image from, saving nothing", async ({
	page,
	db,
	context,
	baseURL,
	request
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	const other = addPerson(db);
	const eggs = addItem(db, other.householdId, 'Eggs');
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
	const propose = async (imageUrl: string) => {
		const answer = await (
			await claude.send('tools/call', {
				name: 'propose_changes',
				arguments: {
					summary: 'A photo of eggs',
					changes: [{ operation: 'set_item_image', householdId: other.householdId, itemId: eggs, imageUrl, replace: false }]
				}
			})
		).json();
		expect(answer.result.isError).toBe(true);
		return answer.result.content[0].text;
	};

	// Meals itself, which it never fetches from.
	expect(await propose(`https://localhost:${new URL(baseURL ?? '').port}/eggs.jpg`)).toBe(
		"Change 1 (set_item_image): Couldn't get an image from that link. Use the image's own link, not the page it's on."
	);
	expect(await propose('http://shop.example/eggs.jpg')).toBe(
		'changes.0.imageUrl: Send a link that starts with https://'
	);
	expect(db.prepare('select photo_key from items where id = ?').pluck().get(eggs)).toBeNull();
});

// New items (MEA-279).

type NewItem = {
	name: string;
	notes: string | null;
	imageUrl: string | null;
	photoKey: string | null;
};

/** A change adding an item to the household's catalog, as proposing saves it. */
function newItem(db: Database.Database, householdId: number, item: NewItem): SavedChange {
	const { name, notes, imageUrl, photoKey } = item;
	return {
		change: { operation: 'create_item', householdId, ...item },
		preview: {
			title: 'Add an item',
			householdId,
			householdName: householdName(db, householdId),
			record: null,
			current: [],
			proposed: [
				{ name: 'Name', value: name },
				{ name: 'Notes', value: notes ?? 'None' },
				imageUrl === null || photoKey === null
					? { name: 'Image', value: 'None' }
					: { name: 'Image', value: imageUrl, photoKey }
			]
		}
	};
}

/** The household's items, with what a new item gets: its notes and image. */
function catalog(db: Database.Database, householdId: number) {
	return db
		.prepare('select name, notes, photo_key as photoKey from items where household_id = ? order by name')
		.all(householdId);
}

function groceryLines(db: Database.Database, householdId: number): number {
	return db
		.prepare('select count(*) from grocery_needs where household_id = ?')
		.pluck()
		.get(householdId) as number;
}

test('adds the new items Claude proposes to the catalog only, once the admin approves', async ({
	page,
	db,
	context,
	baseURL,
	request
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	const other = addPerson(db);
	const saffron = addItem(db, other.householdId, 'Saffron');
	db.prepare('update items set archived_at = ? where id = ?').run(Date.now(), saffron);
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
	const create = (name: string, notes: string | null) => ({
		operation: 'create_item',
		householdId: other.householdId,
		name,
		notes,
		imageUrl: null
	});

	// A name an item has is refused, an archived item's included.
	const refused = await claude.send('tools/call', {
		name: 'propose_changes',
		arguments: { summary: 'Saffron', changes: [create('saffron', null)] }
	});
	expect((await refused.json()).result).toEqual({
		isError: true,
		content: [
			{
				type: 'text',
				text: 'Change 1 (create_item): An archived item is already called saffron. Restore it instead.'
			}
		]
	});

	const proposal = await claude.call('propose_changes', {
		summary: 'Fruit for the catalog',
		changes: [create('Lychees', 'Fresh, in season'), create('Kumquats', null)]
	});
	expect(proposal.status).toBe('pending');
	await open(page, new URL(proposal.url).pathname);
	const lychees = page.getByRole('listitem').filter({ hasText: 'Lychees' });
	await expect(lychees.getByRole('heading', { name: 'Add an item' })).toBeVisible();
	await expect(lychees.getByRole('heading', { name: 'New' })).toBeVisible();
	await expect(lychees).toContainText(`(household ${other.householdId})`);
	await expect(lychees).toContainText('Fresh, in season');
	const kumquats = page.getByRole('listitem').filter({ hasText: 'Kumquats' });
	await expect(kumquats).toContainText('Image');
	await expect(kumquats.getByRole('img')).toHaveCount(0);
	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByRole('status')).toContainText('The changes were made.');

	const added = [
		{ name: 'Kumquats', notes: null, photoKey: null },
		{ name: 'Lychees', notes: 'Fresh, in season', photoKey: null }
	];
	expect(catalog(db, other.householdId)).toEqual([
		...added,
		{ name: 'Saffron', notes: null, photoKey: null }
	]);
	expect(groceryLines(db, other.householdId)).toBe(0);
	const { items } = await claude.call('list_items', { householdId: other.householdId });
	expect(items).toMatchObject(added);
});

test('shows the admin the new items a proposal would add with their images, which approving adds', async ({
	page,
	db,
	context,
	baseURL
}) => {
	const admin = adminId(db);
	const other = addPerson(db);
	const fruits = ['Dragon fruit', 'Kumquats', 'Lychees', 'Passion fruit', 'Starfruit'];
	const added: { name: string; notes: string; imageUrl: string; photoKey: string }[] = [];
	for (const [index, name] of fruits.entries()) {
		const photoKey = await addImage(page, index * 60);
		const imageUrl = `https://shop.example/fruit-${index}.jpg`;
		added.push({ name, notes: `${name}, ripe`, imageUrl, photoKey });
	}
	const proposalId = addProposal(
		db,
		addConnection(db, admin),
		added.map((item) => newItem(db, other.householdId, item))
	);

	// Only the admin can see or approve it.
	await signInAs(db, context, baseURL, other.userId);
	expect((await page.goto(`/ai/proposals/${proposalId}`))?.status()).toBe(404);
	// With the hash the page would send, which the member can't see.
	const content = db
		.prepare('select content from ai_proposals where id = ?')
		.pluck()
		.get(proposalId) as string;
	const approving = await page.request.post(`/ai/proposals/${proposalId}?/approve`, {
		form: { hash: createHash('sha256').update(content).digest('hex') },
		headers: { origin: baseURL ?? '' }
	});
	expect(approving.status()).toBe(404);
	expect(catalog(db, other.householdId)).toEqual([]);

	await context.clearCookies();
	await signInAs(db, context, baseURL, admin);
	await open(page, `/ai/proposals/${proposalId}`);
	for (const { name, notes, imageUrl, photoKey } of added) {
		const change = page.getByRole('listitem').filter({ hasText: name });
		await expect(change.getByRole('heading', { name: 'Add an item' })).toBeVisible();
		await expect(change).toContainText(`(household ${other.householdId})`);
		await expect(change).toContainText(notes);
		await expect(change).toContainText(imageUrl);
		await expect(change.getByRole('img', { name: 'The proposed image' })).toHaveAttribute(
			'src',
			`/ai/proposals/${proposalId}/photos/${photoKey}.jpg`
		);
	}
	// The whole image, as approving gives it to the item.
	const dragonFruit = page.getByRole('listitem').filter({ hasText: 'Dragon fruit' });
	expect(await loadedWidth(dragonFruit.getByRole('img', { name: 'The proposed image' }))).toBe(1200);

	await page.getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByRole('status')).toContainText('The changes were made.');
	expect(catalog(db, other.householdId)).toEqual(
		added.map(({ name, notes, photoKey }) => ({ name, notes, photoKey }))
	);
	for (const { photoKey } of added) expect(existsSync(photoFile(photoKey, 'thumb'))).toBe(true);
	expect(groceryLines(db, other.householdId)).toBe(0);

	// The household sees them on Items, each with its image.
	await context.clearCookies();
	await signInAs(db, context, baseURL, other.userId);
	await open(page, '/groceries/items');
	for (const { name, photoKey } of added) {
		const row = page.getByRole('button', { name: new RegExp(`^${name}`) });
		await expect(row.locator('img')).toHaveAttribute('src', `/photos/${photoKey}-thumb.jpg`);
	}
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
