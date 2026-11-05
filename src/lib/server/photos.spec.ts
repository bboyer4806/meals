import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { setDishArchived, setDishPhoto } from './data/dishes.ts';
import { createItem, setItemArchived, setItemPhoto } from './data/items.ts';
import {
	deletePhoto,
	discardPhoto,
	fetchImage,
	householdOwnsPhoto,
	PHOTO_MAX_BYTES,
	photoPath,
	savePhoto,
	THUMB_MAX_BYTES
} from './photos.ts';
import { TEST_ENV, freshDb, makeDish, makeHousehold, recipe, servePages } from './testing.ts';

// Real random bytes unless a test says otherwise.
vi.mock('node:crypto', async (importOriginal) => {
	const crypto = await importOriginal<typeof import('node:crypto')>();
	return { ...crypto, randomBytes: vi.fn(crypto.randomBytes) };
});

const KEY = '0123456789abcdef0123456789abcdef';

let dataDir: string;

/** Loads the settings the way the server does at startup, with a new, empty data folder. */
function useDataDir(dir: string) {
	loadConfig({ ...TEST_ENV, DATA_DIR: dir });
}

beforeEach(() => {
	freshDb();
	dataDir = mkdtempSync(join(tmpdir(), 'meals-photos-'));
	useDataDir(dataDir);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** A file of `size` bytes that starts like a JPEG. */
function jpeg(size = 100, fill = 7): File {
	const bytes = new Uint8Array(size).fill(fill);
	bytes.set([0xff, 0xd8, 0xff]);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

function file(bytes: number[]): File {
	return new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
}

async function expectRefused(saving: Promise<string>): Promise<void> {
	const thrown = await saving.then(
		() => null,
		(e: unknown) => e
	);
	expect(isHttpError(thrown, 400), `expected HTTP 400, got ${String(thrown)}`).toBe(true);
}

function storedFiles(): string[] {
	const dir = join(dataDir, 'photos');
	return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe('savePhoto', () => {
	it('stores the photo and its thumbnail under a new random key', async () => {
		const photo = jpeg(500, 1);
		const thumb = jpeg(50, 2);

		const key = await savePhoto(photo, thumb);

		expect(key).toMatch(/^[0-9a-f]{32}$/);
		expect(storedFiles()).toEqual([`${key}-thumb.jpg`, `${key}.jpg`]);
		expect(readFileSync(join(dataDir, 'photos', `${key}.jpg`))).toEqual(
			Buffer.from(await photo.arrayBuffer())
		);
		expect(readFileSync(join(dataDir, 'photos', `${key}-thumb.jpg`))).toEqual(
			Buffer.from(await thumb.arrayBuffer())
		);

		const next = await savePhoto(jpeg(), jpeg());
		expect(next).not.toBe(key);
		expect(storedFiles()).toHaveLength(4);
	});

	it('accepts files up to the limits and refuses larger ones', async () => {
		const key = await savePhoto(jpeg(PHOTO_MAX_BYTES), jpeg(THUMB_MAX_BYTES));

		await expectRefused(savePhoto(jpeg(PHOTO_MAX_BYTES + 1), jpeg()));
		await expectRefused(savePhoto(jpeg(), jpeg(THUMB_MAX_BYTES + 1)));
		expect(storedFiles()).toEqual([`${key}-thumb.jpg`, `${key}.jpg`]);
	});

	it('refuses anything that is not a JPEG, and stores nothing', async () => {
		const png = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		await expectRefused(savePhoto(png, jpeg()));
		await expectRefused(savePhoto(jpeg(), png));
		await expectRefused(savePhoto(file([]), jpeg()));
		await expectRefused(savePhoto(file([0xff, 0xd8]), jpeg()));
		await expectRefused(savePhoto(new File(['<svg></svg>'], 'photo.jpg'), jpeg()));
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});

	it("never replaces or removes another photo's files", async () => {
		// The same key twice, which random keys never really give.
		const sameKey = () => Buffer.alloc(16, 0xab);
		vi.mocked(randomBytes).mockImplementationOnce(sameKey).mockImplementationOnce(sameKey);
		const key = await savePhoto(jpeg(100, 1), jpeg(50, 2));

		await expect(savePhoto(jpeg(100, 3), jpeg(50, 4))).rejects.toThrow(/EEXIST/);

		expect(key).toBe('ab'.repeat(16));
		expect(storedFiles()).toEqual([`${key}-thumb.jpg`, `${key}.jpg`]);
		expect(readFileSync(join(dataDir, 'photos', `${key}.jpg`))).toEqual(
			Buffer.from(await jpeg(100, 1).arrayBuffer())
		);
	});

	it('never makes the data folder itself', async () => {
		const missing = join(dataDir, 'missing');
		useDataDir(missing);

		await expect(savePhoto(jpeg(), jpeg())).rejects.toThrow(/ENOENT/);
		expect(existsSync(missing)).toBe(false);
	});
});

describe('deletePhoto', () => {
	it('removes both files, and files that are already gone are fine', async () => {
		const kept = await savePhoto(jpeg(), jpeg());
		const key = await savePhoto(jpeg(), jpeg());

		deletePhoto(key);
		expect(storedFiles()).toEqual([`${kept}-thumb.jpg`, `${kept}.jpg`]);
		expect(() => deletePhoto(key)).not.toThrow();

		// Only the thumbnail is left, as after a save that stopped partway.
		rmSync(join(dataDir, 'photos', `${kept}.jpg`));
		deletePhoto(kept);
		expect(storedFiles()).toEqual([]);
	});
});

describe('photoPath', () => {
	it('names the files in the photos folder', () => {
		expect(photoPath(KEY, 'full')).toBe(join(dataDir, 'photos', `${KEY}.jpg`));
		expect(photoPath(KEY, 'thumb')).toBe(join(dataDir, 'photos', `${KEY}-thumb.jpg`));
	});

	it('refuses anything but a key that savePhoto makes', () => {
		for (const key of [
			'',
			'../meals.db',
			`../${KEY.slice(3)}`,
			KEY.toUpperCase(),
			KEY.slice(1),
			`${KEY}0`,
			`${KEY}\n`,
			`${KEY}/..`,
			`${KEY.slice(1)}g`
		]) {
			expect(() => photoPath(key, 'full'), key).toThrow('Not a photo key');
			expect(() => photoPath(key, 'thumb'), key).toThrow('Not a photo key');
		}
	});

	it('keeps deletePhoto inside the photos folder', () => {
		// What photos/../secret.jpg would remove without the check.
		writeFileSync(join(dataDir, 'secret.jpg'), 'not a photo');
		expect(() => deletePhoto('../secret')).toThrow('Not a photo key');
		expect(existsSync(join(dataDir, 'secret.jpg'))).toBe(true);
	});
});

describe('discardPhoto', () => {
	it('removes both files', async () => {
		const key = await savePhoto(jpeg(), jpeg());
		discardPhoto(key);
		expect(storedFiles()).toEqual([]);
	});

	it("logs rather than throws when the files can't be deleted", async () => {
		const key = await savePhoto(jpeg(), jpeg());
		// A folder in place of the photo can't be deleted as a file.
		rmSync(photoPath(key, 'full'));
		mkdirSync(photoPath(key, 'full'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(() => discardPhoto(key)).not.toThrow();
		expect(logged).toHaveBeenCalledExactlyOnceWith(
			`Couldn't delete photo ${key}`,
			expect.any(Error)
		);
	});
});

describe('householdOwnsPhoto', () => {
	it("is true only for a photo on one of the household's dishes, archived or not", () => {
		const { householdId } = makeHousehold();
		const other = makeHousehold();
		const dishId = makeDish(householdId, recipe('Pound cake'));
		setDishPhoto(householdId, dishId, KEY, 0);

		expect(householdOwnsPhoto(householdId, KEY)).toBe(true);
		expect(householdOwnsPhoto(other.householdId, KEY)).toBe(false);
		expect(householdOwnsPhoto(householdId, 'f'.repeat(32))).toBe(false);

		setDishArchived(householdId, dishId, true, 0);
		expect(householdOwnsPhoto(householdId, KEY)).toBe(true);

		setDishPhoto(householdId, dishId, null, 0);
		expect(householdOwnsPhoto(householdId, KEY)).toBe(false);
	});

	it("is true only for an image on one of the household's items, archived or not", () => {
		const { householdId } = makeHousehold();
		const other = makeHousehold();
		const itemId = createItem(householdId, 'Milk', 0).id;
		setItemPhoto(householdId, itemId, KEY);

		expect(householdOwnsPhoto(householdId, KEY)).toBe(true);
		expect(householdOwnsPhoto(other.householdId, KEY)).toBe(false);

		setItemArchived(householdId, itemId, true, 0);
		expect(householdOwnsPhoto(householdId, KEY)).toBe(true);

		setItemPhoto(householdId, itemId, null);
		expect(householdOwnsPhoto(householdId, KEY)).toBe(false);
	});
});

describe('fetchImage', () => {
	const LINK = 'https://shop.example/milk.png';
	// The first bytes of each kind of image it takes, then some of the picture.
	const IMAGES = {
		JPEG: [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3],
		PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3],
		GIF: [...Buffer.from('GIF89a'), 1, 2, 3],
		WebP: [...Buffer.from('RIFF'), 9, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 1, 2, 3]
	};

	it.each(Object.entries(IMAGES))('gets a %s that a link points at', async (_kind, bytes) => {
		const requested = servePages({ [LINK]: { status: 200, body: Buffer.from(bytes) } });
		const image = await fetchImage(new URL(LINK));
		expect([...image]).toEqual(bytes);
		expect(requested).toEqual([LINK]);
	});

	it('asks for an image, uncompressed', async () => {
		servePages({ [LINK]: { status: 200, body: Buffer.from(IMAGES.PNG) } });
		await fetchImage(new URL(LINK));
		const [[, options]] = vi.mocked(https.get).mock.calls as unknown as [
			[URL, http.RequestOptions]
		];
		expect(options.headers).toEqual({
			accept: 'image/jpeg,image/png,image/webp,image/gif',
			'user-agent': 'Mozilla/5.0 (compatible; Meals item image)',
			'accept-encoding': 'identity'
		});
	});

	it('gives the image in an array of its own', async () => {
		// Small enough that Node could keep it in a larger shared buffer.
		servePages({ [LINK]: { status: 200, body: Buffer.from(IMAGES.JPEG) } });
		const image = await fetchImage(new URL(LINK));
		expect(image.byteOffset).toBe(0);
		expect(image.buffer.byteLength).toBe(IMAGES.JPEG.length);
	});

	it.each([
		['a web page', '<!doctype html><html><img src="milk.png"></html>'],
		['an SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
		['a TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3])],
		['a RIFF file that is not WebP', Buffer.from('RIFF\x09\x00\x00\x00WAVEfmt ', 'latin1')],
		['nothing', '']
	])("refuses %s, which isn't a JPEG, PNG, GIF or WebP", async (_kind, body) => {
		servePages({ [LINK]: { status: 200, body } });
		await expect(fetchImage(new URL(LINK))).rejects.toThrow(
			`${LINK} isn't a JPEG, PNG, GIF or WebP`
		);
	});

	it("fails as Import from a link does when it can't get the link", async () => {
		const requested = servePages({ [LINK]: { status: 404 } });
		await expect(fetchImage(new URL(LINK))).rejects.toThrow(`${LINK} answered 404`);
		await expect(fetchImage(new URL('http://169.254.169.254/milk.png'))).rejects.toThrow(
			'169.254.169.254 is a private address'
		);
		await expect(fetchImage(new URL('http://localhost:5173/milk.png'))).rejects.toThrow(
			/^localhost is at (127\.0\.0\.1|::1), a private address$/
		);
		expect(requested).toEqual([LINK, 'http://localhost:5173/milk.png']);
	});
});
