import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { createItem, getItem } from '#lib/server/data/items.ts';
import { TEST_ENV, freshDb, makeHousehold, servePages } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const LINK = 'https://shop.example/milk.png';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const NO_IMAGE =
	"Couldn't get an image from that link. Use the image's own link, not the page it's on.";

let dataDir: string;
let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	dataDir = mkdtempSync(join(tmpdir(), 'meals-items-page-'));
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

type ActionName = keyof typeof actions;

/** Runs the action with this form as the household's member, or as nobody. */
function run(action: ActionName, form: FormData, as: 'member' | 'nobody' = 'member') {
	const request = new Request(`http://localhost/groceries/items?/${action}`, {
		method: 'POST',
		body: form
	});
	const member = { id: userId, householdId, email: 'pat@example.com', name: 'Pat', isAdmin: false };
	const event = { locals: { user: as === 'member' ? member : null }, request };
	return actions[action](event as unknown as Parameters<(typeof actions)[ActionName]>[0]);
}

function linkForm(link: string): FormData {
	const form = new FormData();
	form.set('link', link);
	return form;
}

describe('the image action', () => {
	it('gives the image a link points at, and saves nothing', async () => {
		servePages({ [LINK]: { status: 200, body: Buffer.from(PNG) } });
		const result = await run('image', linkForm(`  ${LINK} `));
		expect(result).toEqual({ action: 'image', image: new Uint8Array(PNG) });
	});

	it("says so when the link can't be opened or isn't to an image", async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		servePages({
			[LINK]: { status: 404 },
			'https://shop.example/milk': { status: 200, body: '<!doctype html><title>Milk</title>' }
		});
		for (const link of [LINK, 'https://shop.example/milk', 'http://127.0.0.1/milk.png']) {
			const result = await run('image', linkForm(link));
			expect(result, link).toMatchObject({
				status: 400,
				data: { action: 'image', error: NO_IMAGE }
			});
		}
		expect(logged).toHaveBeenCalledTimes(3);
	});

	it('takes only an http or https link of up to 2000 characters', async () => {
		const requested = servePages({});
		const http = { action: 'image', error: 'Enter a link that starts with http:// or https://' };
		for (const link of ['', 'shop.example/milk.png', 'ftp://shop.example/milk.png']) {
			expect(await run('image', linkForm(link)), link).toMatchObject({ status: 400, data: http });
		}
		const long = `https://shop.example/${'a'.repeat(1980)}`;
		expect(await run('image', linkForm(long))).toMatchObject({
			status: 400,
			data: { action: 'image', error: 'Keep the link under 2000 characters' }
		});
		expect(requested).toEqual([]);
	});

	it('sends someone who is not signed in to sign in, without fetching', async () => {
		const requested = servePages({});
		const thrown = await Promise.resolve()
			.then(() => run('image', linkForm(LINK), 'nobody'))
			.catch((e: unknown) => e);
		expect(isRedirect(thrown) && thrown.location).toBe('/login');
		expect(requested).toEqual([]);
	});
});

describe('the update action', () => {
	it("saves the item's name and notes for the signed-in household only", async () => {
		const milk = createItem(householdId, 'Milk', 0).id;
		const form = new FormData();
		form.set('id', String(milk));
		form.set('name', 'Whole milk');
		form.set('notes', '1 gal');
		expect(await run('update', form)).toEqual({ action: 'item' });
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Whole milk', notes: '1 gal' });

		const other = makeHousehold().householdId;
		form.set('id', String(createItem(other, 'Eggs', 0).id));
		const thrown = await Promise.resolve(run('update', form)).catch((e: unknown) => e);
		expect(isHttpError(thrown, 404), String(thrown)).toBe(true);
	});
});
