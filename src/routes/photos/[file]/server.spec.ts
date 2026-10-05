import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { setDishArchived, setDishPhoto } from '#lib/server/data/dishes.ts';
import { deletePhoto, savePhoto } from '#lib/server/photos.ts';
import { freshDb, makeDish, makeHousehold, recipe } from '#lib/server/testing.ts';
import { GET } from './+server.ts';

let dataDir: string;
let householdId: number;
let dishId: number;
let key: string;

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const THUMB = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6]);

beforeEach(async () => {
	freshDb();
	dataDir = mkdtempSync(join(tmpdir(), 'meals-photos-'));
	// The settings the server reads at startup (hooks.server.ts).
	loadConfig({
		GOOGLE_CLIENT_ID: 'client-id',
		GOOGLE_CLIENT_SECRET: 'client-secret',
		ADMIN_EMAIL: 'admin@example.com',
		DATA_DIR: dataDir
	});
	({ householdId } = makeHousehold());
	dishId = makeDish(householdId, recipe('Pound cake'));
	key = await savePhoto(new File([PHOTO], 'photo.jpg'), new File([THUMB], 'thumb.jpg'));
	setDishPhoto(householdId, dishId, key, 0);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

/** GET /photos/<file> as a member of the household, another household, or nobody. */
function get(file: string, asHousehold: number | null = householdId) {
	const user =
		asHousehold === null
			? null
			: { id: 1, householdId: asHousehold, email: 'a@example.com', name: 'A', isAdmin: false };
	return GET({ locals: { user }, params: { file } } as unknown as Parameters<typeof GET>[0]);
}

async function expectNotFound(file: string, asHousehold?: number) {
	const thrown = await get(file, asHousehold).then(
		async (response) => {
			await response.body?.cancel();
			return null;
		},
		(e: unknown) => e
	);
	const message = `${JSON.stringify(file)}: expected 404, got ${String(thrown)}`;
	expect(isHttpError(thrown, 404), message).toBe(true);
}

it('serves the photo and its thumbnail as long-lived private JPEGs', async () => {
	for (const [file, bytes] of [
		[`${key}.jpg`, PHOTO],
		[`${key}-thumb.jpg`, THUMB]
	] as const) {
		const response = await get(file);
		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toEqual({
			'content-type': 'image/jpeg',
			'content-length': String(bytes.length),
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		});
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	}
});

it("serves an archived dish's photo", async () => {
	setDishArchived(householdId, dishId, true, 0);
	const response = await get(`${key}-thumb.jpg`);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(THUMB);
});

it("answers 404 for another household's photo", async () => {
	const other = makeHousehold();
	await expectNotFound(`${key}.jpg`, other.householdId);
	await expectNotFound(`${key}-thumb.jpg`, other.householdId);
});

it('answers 404 for a photo no dish has, even if its files are there', async () => {
	await expectNotFound(`${'f'.repeat(32)}.jpg`);

	// Replaced: the old files are still on disk until they're deleted.
	const next = await savePhoto(new File([PHOTO], 'photo.jpg'), new File([THUMB], 'thumb.jpg'));
	setDishPhoto(householdId, dishId, next, 0);
	await expectNotFound(`${key}.jpg`);
	const response = await get(`${next}.jpg`);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(PHOTO);
});

it("answers 404 when the dish's photo file is missing", async () => {
	deletePhoto(key);
	await expectNotFound(`${key}.jpg`);
	await expectNotFound(`${key}-thumb.jpg`);
});

it('answers 404 for any other file name', async () => {
	// Files that a looser check might serve.
	writeFileSync(join(dataDir, 'meals.db'), 'database');
	writeFileSync(join(dataDir, 'photos', `${key}.png`), 'not served');
	writeFileSync(join(dataDir, 'photos', `${key}.JPG`), 'not served');

	for (const file of [
		'meals.db',
		'../meals.db',
		`../${key}.jpg`,
		`..%2F${key}.jpg`,
		`${key}.png`,
		`${key}.JPG`,
		`${key.toUpperCase()}.jpg`,
		`${key}.jpeg`,
		`${key}-small.jpg`,
		`${key}-thumb-thumb.jpg`,
		`${key}.jpg.jpg`,
		`${key}.jpg/`,
		`${key}.jpg\n`,
		` ${key}.jpg`,
		`${key}.jpg\0`,
		`${key.slice(1)}.jpg`,
		`${key}0.jpg`,
		key,
		''
	]) {
		await expectNotFound(file);
	}
});

it('sends someone who is not signed in to sign in', async () => {
	const thrown = await get(`${key}.jpg`, null).catch((e: unknown) => e);
	expect(isRedirect(thrown) && thrown.location).toBe('/login');
});
