import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { createItem, getItem, setItemArchived, setItemPhoto } from './data/items.ts';
import { saveItem } from './item-form.ts';
import { PHOTO_MAX_BYTES, photoPath, THUMB_MAX_BYTES } from './photos.ts';
import { TEST_ENV, freshDb, makeHousehold } from './testing.ts';

// The real function, which a test can make fail once.
vi.mock('./data/items.ts', async (importOriginal) => {
	const items = await importOriginal<typeof import('./data/items.ts')>();
	return { ...items, setItemPhoto: vi.fn(items.setItemPhoto) };
});

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
});

/** A file of `size` bytes that starts like a JPEG. */
function jpeg(size = 100, fill = 7): File {
	const bytes = new Uint8Array(size).fill(fill);
	bytes.set([0xff, 0xd8, 0xff]);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

/** A new image for the form, as the page sends it: resized, with its thumbnail. */
function newImage(fill = 7) {
	return { photo: jpeg(500, fill), thumb: jpeg(50, fill) };
}

/** The sheet's form for an item: its name and notes, and anything else it sends. */
function formData(
	fields: { id?: number; name?: string; notes?: string } = {},
	extra: Record<string, string | File> = {}
): FormData {
	const form = new FormData();
	form.set('id', String(fields.id ?? milk));
	form.set('name', fields.name ?? 'Milk');
	form.set('notes', fields.notes ?? '');
	for (const [name, value] of Object.entries(extra)) form.set(name, value);
	return form;
}

async function save(fields: Parameters<typeof formData>[0] = {}, extra = {}) {
	const result = await saveItem(householdId, formData(fields, extra));
	expect(result, JSON.stringify(result)).toEqual({ action: 'item' });
}

async function refused(fields: Parameters<typeof formData>[0] = {}, extra = {}) {
	const result = await saveItem(householdId, formData(fields, extra));
	if (!('status' in result)) throw new Error('Expected a failure');
	expect(result.status).toBe(400);
	return result.data;
}

function storedFiles(): string[] {
	const dir = join(dataDir, 'photos');
	return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function filesFor(key: string): string[] {
	return [`${key}-thumb.jpg`, `${key}.jpg`];
}

function imageOf(itemId = milk): string | null {
	return getItem(householdId, itemId).photoKey;
}

describe('saveItem', () => {
	it('saves the name and notes, leaving the item without an image', async () => {
		await save({ name: '  Whole   milk ', notes: ' 1 gal ' });
		expect(getItem(householdId, milk)).toMatchObject({
			name: 'Whole milk',
			notes: '1 gal',
			photoKey: null
		});
		expect(setItemPhoto).not.toHaveBeenCalled();
		expect(storedFiles()).toEqual([]);
	});

	it('checks the fields as before', async () => {
		expect(await refused({ name: ' ' }, newImage())).toEqual({
			action: 'item',
			error: 'Enter a name'
		});
		expect(await refused({ notes: 'x'.repeat(201) })).toEqual({
			action: 'item',
			error: 'Keep it under 200 characters'
		});
		expect(storedFiles()).toEqual([]);
	});

	it('stores a new image with the name and notes', async () => {
		const { photo, thumb } = newImage(1);
		await save({ notes: 'Organic' }, { photo, thumb });

		const key = imageOf();
		expect(key).toMatch(/^[0-9a-f]{32}$/);
		if (key === null) return;
		expect(getItem(householdId, milk).notes).toBe('Organic');
		expect(storedFiles()).toEqual(filesFor(key));
		expect(readFileSync(photoPath(key, 'full'))).toEqual(Buffer.from(await photo.arrayBuffer()));
		expect(readFileSync(photoPath(key, 'thumb'))).toEqual(Buffer.from(await thumb.arrayBuffer()));
	});

	it('replaces an image and deletes the old one', async () => {
		await save({}, newImage(1));
		const oldKey = imageOf();

		await save({}, newImage(2));
		const newKey = imageOf();
		expect(newKey).not.toBeNull();
		expect(newKey).not.toBe(oldKey);
		if (newKey === null) return;
		expect(storedFiles()).toEqual(filesFor(newKey));
	});

	it('keeps the image when none is sent', async () => {
		await save({}, newImage());
		const key = imageOf();

		await save({ name: 'Whole milk' });
		expect(imageOf()).toBe(key);
		expect(storedFiles()).toHaveLength(2);
		expect(setItemPhoto).toHaveBeenCalledTimes(1);
	});

	it('removes the image and its files', async () => {
		await save({}, newImage());
		await save({}, { removePhoto: '1' });
		expect(imageOf()).toBeNull();
		expect(storedFiles()).toEqual([]);
	});

	it('takes a new image over removing one, as the page never sends both', async () => {
		await save({}, newImage(1));
		await save({}, { ...newImage(2), removePhoto: '1' });
		const key = imageOf();
		expect(key).not.toBeNull();
		if (key === null) return;
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it('refuses a name another item has, changing nothing and keeping no new image', async () => {
		await save({}, newImage(1));
		const key = imageOf();
		if (key === null) throw new Error('Expected an image');
		createItem(householdId, 'Eggs', 0);
		const flour = createItem(householdId, 'Flour', 0).id;
		setItemArchived(householdId, flour, true, 0);

		expect(await refused({ name: 'EGGS', notes: 'Dozen' }, newImage(2))).toEqual({
			action: 'item',
			error: 'An item is already called EGGS.'
		});
		expect(await refused({ name: 'flour' }, { removePhoto: '1' })).toEqual({
			action: 'item',
			error: 'An archived item is already called flour.'
		});
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Milk', notes: null, photoKey: key });
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it("refuses an image that isn't a JPEG or is too large, changing nothing", async () => {
		await save({}, newImage(1));
		const key = imageOf();
		if (key === null) throw new Error('Expected an image');
		const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png');

		expect(await refused({ name: 'Whole milk' }, { photo: png, thumb: jpeg() })).toEqual({
			action: 'item',
			error: 'The photo must be a JPEG.'
		});
		expect(await refused({}, { photo: jpeg(PHOTO_MAX_BYTES + 1), thumb: jpeg() })).toEqual({
			action: 'item',
			error: 'That photo is too large. Try another one.'
		});
		expect(await refused({}, { photo: jpeg(), thumb: jpeg(THUMB_MAX_BYTES + 1) })).toEqual({
			action: 'item',
			error: 'That photo is too large. Try another one.'
		});
		expect(getItem(householdId, milk)).toMatchObject({ name: 'Milk', photoKey: key });
		expect(storedFiles()).toEqual(filesFor(key));
	});

	it("says so when the image's files can't be read, changing nothing", async () => {
		const message = { action: 'item', error: "The image couldn't be uploaded. Choose it again." };
		expect(await refused({ name: 'Whole milk' }, { photo: jpeg() })).toEqual(message);
		expect(await refused({}, { photo: 'not a file', thumb: jpeg() })).toEqual(message);
		expect(getItem(householdId, milk).name).toBe('Milk');
		expect(storedFiles()).toEqual([]);
	});

	it("is not found for another household's item, and keeps no new image", async () => {
		const other = makeHousehold().householdId;
		const theirs = createItem(other, 'Eggs', 0).id;

		const thrown = await saveItem(householdId, formData({ id: theirs }, newImage())).catch(
			(e: unknown) => e
		);
		expect(isHttpError(thrown, 404), String(thrown)).toBe(true);
		expect(getItem(other, theirs)).toMatchObject({ name: 'Eggs', photoKey: null });
		expect(storedFiles()).toEqual([]);
	});

	it("deletes the new image when it can't be set, keeping the old name, notes and image", async () => {
		await save({}, newImage(1));
		const oldKey = imageOf();
		if (oldKey === null) throw new Error('Expected an image');

		vi.mocked(setItemPhoto).mockImplementationOnce(() => {
			throw new Error('disk I/O error');
		});
		await expect(
			saveItem(householdId, formData({ name: 'Whole milk', notes: '1 gal' }, newImage(2)))
		).rejects.toThrow('disk I/O error');
		expect(getItem(householdId, milk)).toMatchObject({
			name: 'Milk',
			notes: null,
			photoKey: oldKey
		});
		expect(storedFiles()).toEqual(filesFor(oldKey));
	});

	it("still saves when the old image's files can't be deleted", async () => {
		await save({}, newImage(1));
		const key = imageOf();
		if (key === null) throw new Error('Expected an image');
		// A folder in place of the image can't be deleted as a file.
		rmSync(photoPath(key, 'full'));
		mkdirSync(photoPath(key, 'full'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await save({}, { removePhoto: '1' });
			expect(imageOf()).toBeNull();
			expect(logged).toHaveBeenCalledOnce();
		} finally {
			logged.mockRestore();
		}
	});
});
