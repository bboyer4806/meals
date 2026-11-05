import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { createItem, getItem, setItemArchived, setItemPhoto } from './data/items.ts';
import { saveItem } from './item-form.ts';
import { photoPath } from './photos.ts';
import { TEST_ENV, freshDb, makeHousehold, servePages } from './testing.ts';

// The real functions, which a test can make fail once.
vi.mock('./data/items.ts', async (importOriginal) => {
	const items = await importOriginal<typeof import('./data/items.ts')>();
	return { ...items, setItemPhoto: vi.fn(items.setItemPhoto) };
});
// Deletes files, as when an image is deleted (photos.ts).
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return { ...fs, rmSync: vi.fn(fs.rmSync) };
});

const MILK_PNG = 'https://shop.example/milk.png';
const UNREADABLE = "The image couldn't be uploaded. Choose it again.";

let dataDir: string;
let householdId: number;
let milk: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
	milk = createItem(householdId, 'Milk', 0).id;
	dataDir = mkdtempSync(join(tmpdir(), 'meals-item-form-'));
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	vi.mocked(setItemPhoto).mockClear();
	vi.mocked(rmSync).mockClear();
	vi.restoreAllMocks();
});

function storedFiles(): string[] {
	const dir = join(dataDir, 'photos');
	return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function filesFor(key: string): string[] {
	return [`${key}-thumb.jpg`, `${key}.jpg`];
}

/** A file that starts like a JPEG, as a device sends one, that tells apart from others. */
function jpeg(size: number, fill: number): File {
	const bytes = new Uint8Array(size).fill(fill);
	bytes.set([0xff, 0xd8, 0xff]);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

/** An image picked on the device and resized there, as the sheet sends it. */
function picked(fill = 7) {
	return { photo: jpeg(500, fill), thumb: jpeg(50, fill) };
}

/** The sheet's form for Milk: its fields as they start, with these changed or added. */
function form(fields: Record<string, string | File> = {}, itemId = milk): FormData {
	const data = new FormData();
	const all = { id: String(itemId), name: 'Milk', notes: '', photoLink: '', ...fields };
	for (const [name, value] of Object.entries(all)) data.set(name, value);
	return data;
}

async function saved(fields: Record<string, string | File> = {}): Promise<void> {
	expect(await saveItem(householdId, form(fields))).toEqual({ action: 'item' });
}

/** The message a save that changes nothing shows. */
async function refused(fields: Record<string, string | File> = {}): Promise<string> {
	const result = await saveItem(householdId, form(fields));
	expect(isActionFailure(result)).toBe(true);
	if (!('status' in result)) throw new Error('Expected a failure');
	expect(result.status).toBe(400);
	expect(result.data.action).toBe('item');
	return result.data.error;
}

function photoKey(): string {
	const key = getItem(householdId, milk).photoKey;
	if (key === null) throw new Error('Expected an image');
	return key;
}

/** A real PNG, as a link might give. */
function png(width: number, height: number): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 3, background: '#f5f0e6' } })
		.png()
		.toBuffer();
}

describe('saveItem', () => {
	it('saves the name and notes, keeping the image', async () => {
		await saved(picked());
		const key = photoKey();

		await saved({ name: 'Whole milk', notes: '1 gal' });

		expect(getItem(householdId, milk)).toMatchObject({
			name: 'Whole milk',
			notes: '1 gal',
			photoKey: key
		});
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it('adds an image picked on the device, as it was sent', async () => {
		const { photo, thumb } = picked(3);
		await saved({ photo, thumb, name: 'Whole milk' });

		const key = photoKey();
		expect(getItem(householdId, milk).name).toBe('Whole milk');
		expect(storedFiles()).toEqual(filesFor(key));
		expect(readFileSync(photoPath(key, 'full'))).toEqual(Buffer.from(await photo.arrayBuffer()));
		expect(readFileSync(photoPath(key, 'thumb'))).toEqual(Buffer.from(await thumb.arrayBuffer()));
	});

	it('adds an image from a link, downloaded and resized', async () => {
		servePages({ [MILK_PNG]: { status: 200, body: await png(2400, 1200) } });
		await saved({ photoLink: ` ${MILK_PNG} ` });

		const key = photoKey();
		expect(storedFiles()).toEqual(filesFor(key));
		const full = await sharp(readFileSync(photoPath(key, 'full'))).metadata();
		expect(full).toMatchObject({ format: 'jpeg', width: 1600, height: 800 });
	});

	it("replaces the image, deleting the old one's files", async () => {
		await saved(picked(1));
		const first = photoKey();

		await saved(picked(2));
		const second = photoKey();
		expect(second).not.toBe(first);
		expect(storedFiles()).toEqual(filesFor(second));

		servePages({ [MILK_PNG]: { status: 200, body: await png(40, 40) } });
		await saved({ photoLink: MILK_PNG });
		const third = photoKey();
		expect(third).not.toBe(second);
		expect(storedFiles()).toEqual(filesFor(third));
	});

	it('removes the image, deleting its files', async () => {
		await saved(picked());
		await saved({ removePhoto: '1' });
		expect(getItem(householdId, milk).photoKey).toBeNull();
		expect(storedFiles()).toEqual([]);

		// Without one, there's nothing to remove.
		await saved({ removePhoto: '1' });
		expect(getItem(householdId, milk).photoKey).toBeNull();
	});

	it("changes nothing when the link can't be downloaded or isn't an image", async () => {
		await saved(picked());
		const key = photoKey();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		servePages({
			'https://shop.example/gone.png': { status: 404 },
			'https://shop.example/milk': { status: 200, body: '<!doctype html><title>Milk</title>' }
		});
		const changed = { name: 'Oat milk', notes: 'Barista' };

		expect(await refused({ ...changed, photoLink: 'http://127.0.0.1/milk.png' })).toBe(
			"Couldn't download an image from that link. Check the link, or try an image under 5 MB."
		);
		expect(await refused({ ...changed, photoLink: 'https://shop.example/gone.png' })).toBe(
			"Couldn't download an image from that link. Check the link, or try an image under 5 MB."
		);
		expect(await refused({ ...changed, photoLink: 'https://shop.example/milk' })).toBe(
			"That isn't an image Meals can use. Try a JPEG, PNG, WebP or GIF."
		);

		expect(getItem(householdId, milk)).toMatchObject({ name: 'Milk', notes: null, photoKey: key });
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it('refuses a link that is not http or https, or is too long, without fetching it', async () => {
		const requested = servePages({});
		expect(await refused({ photoLink: 'ftp://shop.example/milk.png' })).toBe(
			'Enter an image link that starts with http:// or https://'
		);
		expect(await refused({ photoLink: 'shop.example/milk.png' })).toBe(
			'Enter an image link that starts with http:// or https://'
		);
		expect(await refused({ photoLink: `https://shop.example/${'a'.repeat(481)}` })).toBe(
			'Keep the image link under 500 characters'
		);
		expect(requested).toEqual([]);
		expect(getItem(householdId, milk).photoKey).toBeNull();
	});

	it('refuses files it cannot read, or more than one change, storing nothing', async () => {
		const { photo, thumb } = picked();
		for (const fields of <Record<string, string | File>[]>[
			{ photo },
			{ thumb },
			{ photo: 'not a file', thumb },
			{ photo, thumb, photoLink: MILK_PNG },
			{ photo, thumb, removePhoto: '1' },
			{ photoLink: MILK_PNG, removePhoto: '1' }
		]) {
			expect(await refused(fields), JSON.stringify(Object.keys(fields))).toBe(UNREADABLE);
		}
		expect(getItem(householdId, milk).photoKey).toBeNull();
		expect(storedFiles()).toEqual([]);
	});

	it('refuses a name another item has, keeping the old image and no new one', async () => {
		await saved(picked(1));
		const key = photoKey();
		createItem(householdId, 'Eggs', 0);
		const archived = createItem(householdId, 'Butter', 0).id;
		setItemArchived(householdId, archived, true, 0);

		expect(await refused({ name: 'eggs', ...picked(2) })).toBe('An item is already called eggs.');
		expect(await refused({ name: 'Butter', removePhoto: '1' })).toBe(
			'An archived item is already called Butter.'
		);
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Milk', photoKey: key });
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it("can't change another household's item, and keeps no files", async () => {
		const other = makeHousehold().householdId;
		const theirs = createItem(other, 'Bread', 0).id;

		const thrown = await saveItem(householdId, form({ name: 'Bread', ...picked() }, theirs)).then(
			() => null,
			(e: unknown) => e
		);
		expect(isHttpError(thrown, 404), `expected HTTP 404, got ${String(thrown)}`).toBe(true);
		expect(getItem(other, theirs)).toMatchObject({ name: 'Bread', photoKey: null });
		expect(storedFiles()).toEqual([]);
	});

	it("deletes the new image when it can't be set, keeping the item as it was", async () => {
		await saved(picked(1));
		const key = photoKey();
		vi.mocked(setItemPhoto).mockImplementationOnce(() => {
			throw new Error('disk I/O error');
		});

		await expect(saveItem(householdId, form({ name: 'Oat milk', ...picked(2) }))).rejects.toThrow(
			'disk I/O error'
		);
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Milk', photoKey: key });
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it("still saves when the old image's files can't be deleted", async () => {
		await saved(picked());
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(rmSync).mockImplementationOnce(() => {
			throw new Error('permission denied');
		});

		await saved({ removePhoto: '1' });
		expect(getItem(householdId, milk).photoKey).toBeNull();
		expect(logged).toHaveBeenCalledOnce();
	});
});
