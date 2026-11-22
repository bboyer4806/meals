import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { proposalInput, proposeChanges } from '#lib/server/ai/proposals.ts';
import { loadConfig } from '#lib/server/config.ts';
import { createItem, setItemPhoto } from '#lib/server/data/items.ts';
import { db } from '#lib/server/db/index.ts';
import { aiConnections } from '#lib/server/db/schema.ts';
import { photoPath, savePhoto } from '#lib/server/photos.ts';
import { freshDb, makeHousehold, servePages, TEST_ENV } from '#lib/server/testing.ts';
import { GET } from './+server.ts';

const LINK = 'https://shop.example/milk.png';

let dataDir: string;
let householdId: number;
let proposalId: number;
let current: string;
let proposed: string;
let unrelated: string;

async function jpegFile(color: string): Promise<File> {
	const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
		.jpeg()
		.toBuffer();
	return new File([new Uint8Array(bytes)], 'photo.jpg');
}

beforeEach(async () => {
	freshDb();
	dataDir = mkdtempSync(join(tmpdir(), 'meals-proposal-photos-'));
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
	const admin = makeHousehold();
	({ householdId } = makeHousehold());
	const connectionId = db()
		.insert(aiConnections)
		.values({
			clientId: 'claude-client',
			platform: 'claude',
			redirectUris: '[]',
			createdAt: 0,
			userId: admin.userId,
			authorizedAt: 0
		})
		.returning({ id: aiConnections.id })
		.get().id;
	const milk = createItem(householdId, 'Milk', 0).id;
	current = await savePhoto(await jpegFile('#246'), await jpegFile('#246'));
	setItemPhoto(householdId, milk, current);
	// Another of the household's images, which the proposal doesn't show.
	unrelated = await savePhoto(await jpegFile('#642'), await jpegFile('#642'));
	setItemPhoto(householdId, createItem(householdId, 'Eggs', 0).id, unrelated);

	const picture = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#c84' } })
		.png()
		.toBuffer();
	servePages({ [LINK]: { status: 200, body: picture } });
	const change = { operation: 'set_item_image', householdId, itemId: milk, imageUrl: LINK, replace: true };
	const proposal = await proposeChanges(
		connectionId,
		proposalInput.parse({ summary: 'A photo', changes: [change] }),
		Date.now()
	);
	proposalId = proposal.id;
	proposed = proposal.changes[0]!.proposed[0]!.photoKey!;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** GET /ai/proposals/<id>/photos/<file> as the admin, another member, or nobody. */
function get(file: string, as: 'admin' | 'member' | null = 'admin', id = String(proposalId)) {
	const user =
		as === null
			? null
			: { id: 1, householdId: 1, email: 'a@example.com', name: 'A', isAdmin: as === 'admin' };
	return GET({ locals: { user }, params: { id, file } } as unknown as Parameters<typeof GET>[0]);
}

async function thrown(response: Promise<Response>): Promise<unknown> {
	return response.then(
		async (answer) => {
			await answer.body?.cancel();
			return null;
		},
		(e: unknown) => e
	);
}

it('shows the admin the images the proposal shows: the one it proposes and the one it would replace', async () => {
	for (const [key, size] of [
		[proposed, 'full'],
		[proposed, 'thumb'],
		[current, 'full'],
		[current, 'thumb']
	] as const) {
		const response = await get(`${key}${size === 'thumb' ? '-thumb' : ''}.jpg`);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
		expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(photoPath(key, size)));
	}
});

it('shows no other image, and nothing to anyone but the admin', async () => {
	for (const [file, as, id] of [
		[`${unrelated}.jpg`, 'admin', String(proposalId)],
		[`${proposed}.jpg`, 'admin', String(proposalId + 1)],
		[`${proposed}.jpg`, 'admin', 'x'],
		[`${proposed}.png`, 'admin', String(proposalId)],
		['../meals.db', 'admin', String(proposalId)],
		[`${proposed}.jpg`, 'member', String(proposalId)]
	] as const) {
		const error = await thrown(get(file, as, id));
		expect(isHttpError(error, 404), `${file} as ${as} for ${id}: ${String(error)}`).toBe(true);
	}
	expect(isRedirect(await thrown(get(`${proposed}.jpg`, null)))).toBe(true);
});

it('is not found once the image is gone, as after the proposal was rejected', async () => {
	rmSync(photoPath(proposed, 'full'));
	expect(isHttpError(await thrown(get(`${proposed}.jpg`)), 404)).toBe(true);
});
