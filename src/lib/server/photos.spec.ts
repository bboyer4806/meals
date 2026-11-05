import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { isHttpError } from '@sveltejs/kit';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { setDishArchived, setDishPhoto } from './data/dishes.ts';
import { createItem, setItemArchived, setItemPhoto } from './data/items.ts';
import {
	deletePhoto,
	discardPhoto,
	householdOwnsPhoto,
	PHOTO_MAX_BYTES,
	photoPath,
	saveImage,
	saveLinkedImage,
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

	it("is true for an image on one of the household's items, archived or not", () => {
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

describe('discardPhoto', () => {
	it("removes a photo's files, and logs rather than throws when it can't", async () => {
		const key = await savePhoto(jpeg(), jpeg());
		discardPhoto(key);
		expect(storedFiles()).toEqual([]);

		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		writeFileSync(join(dataDir, 'secret.jpg'), 'not a photo');
		expect(() => discardPhoto('../secret')).not.toThrow();
		expect(logged).toHaveBeenCalledOnce();
		expect(existsSync(join(dataDir, 'secret.jpg'))).toBe(true);
	});
});

type Format = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'tiff';

/** A real image of one color in this format. */
function image(format: Format, width: number, height: number): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 3, background: '#c0502a' } })
		[format]()
		.toBuffer();
}

/** A stored file's format and size. */
async function stored(key: string, size: 'full' | 'thumb') {
	const file = readFileSync(photoPath(key, size));
	const { format, width, height, exif } = await sharp(file).metadata();
	return { format, width, height, exif };
}

/** A PNG whose header says it's this size, with no pixels after it. */
function pngHeader(width: number, height: number): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
		return Buffer.concat([length, Buffer.from(type), data, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	// 8 bits per channel, RGB.
	header.set([8, 2], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.alloc(0))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

async function expectRefusedWith(saving: Promise<string>, message: string): Promise<void> {
	const thrown = await saving.then(
		() => null,
		(e: unknown) => e
	);
	expect(isHttpError(thrown, 400), `expected HTTP 400, got ${String(thrown)}`).toBe(true);
	expect(isHttpError(thrown) && thrown.body.message).toBe(message);
}

const UNUSABLE = "That isn't an image Meals can use. Try a JPEG, PNG, WebP or GIF.";

describe('saveImage', () => {
	it('stores the photo at most 1600 px and the thumbnail at most 400 px, both JPEG', async () => {
		const key = await saveImage(await image('png', 3200, 1600));

		expect(storedFiles()).toEqual([`${key}-thumb.jpg`, `${key}.jpg`]);
		expect(await stored(key, 'full')).toMatchObject({ format: 'jpeg', width: 1600, height: 800 });
		expect(await stored(key, 'thumb')).toMatchObject({ format: 'jpeg', width: 400, height: 200 });
	});

	it('keeps the size of a smaller image', async () => {
		const key = await saveImage(await image('jpeg', 300, 500));
		expect(await stored(key, 'full')).toMatchObject({ width: 300, height: 500 });
		expect(await stored(key, 'thumb')).toMatchObject({ width: 240, height: 400 });
	});

	it.each(['jpeg', 'png', 'webp', 'gif', 'avif'] as const)('reads a %s image', async (format) => {
		const key = await saveImage(await image(format, 64, 48));
		expect(await stored(key, 'full')).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
	});

	it('turns the image upright and leaves out its metadata', async () => {
		// A camera's picture taken sideways: 200 by 100, to be turned a quarter clockwise.
		const sideways = await sharp({
			create: { width: 200, height: 100, channels: 3, background: '#fff' }
		})
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toBuffer();
		const key = await saveImage(sideways);
		expect(await stored(key, 'full')).toEqual({
			format: 'jpeg',
			width: 100,
			height: 200,
			exif: undefined
		});
	});

	it('makes transparent parts white', async () => {
		const clear = await sharp({
			create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
		})
			.png()
			.toBuffer();
		const key = await saveImage(clear);
		const pixels = await sharp(readFileSync(photoPath(key, 'full'))).raw().toBuffer();
		expect([...pixels.subarray(0, 3)]).toEqual([255, 255, 255]);
	});

	it("refuses SVG, TIFF and what isn't an image, and stores nothing", async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>';
		for (const bytes of [
			Buffer.from(svg),
			await image('tiff', 64, 48),
			Buffer.from('<!doctype html><title>Milk</title>'),
			Buffer.alloc(0)
		]) {
			await expectRefusedWith(saveImage(bytes), UNUSABLE);
		}
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});

	it('refuses an image over 50 megapixels before reading its pixels', async () => {
		await expectRefusedWith(
			saveImage(pngHeader(10_000, 5_001)),
			'That image is too large. Try a smaller one.'
		);
		// Exactly 50 megapixels is allowed, so this one is read, and has no pixels to read.
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expectRefusedWith(saveImage(pngHeader(10_000, 5_000)), UNUSABLE);
		expect(logged).toHaveBeenCalledOnce();
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});

	it('refuses an image that was cut short', async () => {
		const whole = await image('jpeg', 640, 480);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expectRefusedWith(saveImage(whole.subarray(0, whole.length / 2)), UNUSABLE);
		expect(logged).toHaveBeenCalledOnce();
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});
});

describe('saveLinkedImage', () => {
	const MILK = 'https://shop.example/milk.png';
	const NOT_DOWNLOADED =
		"Couldn't download an image from that link. Check the link, or try an image under 5 MB.";

	it('downloads the image, asking for one, and stores it resized', async () => {
		const body = await image('png', 2000, 1000);
		const requested = servePages({
			[MILK]: { status: 200, headers: { 'content-type': 'image/png' }, body }
		});

		const key = await saveLinkedImage(new URL(MILK));

		expect(requested).toEqual([MILK]);
		const headers = {
			accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
			'user-agent': 'Mozilla/5.0 (compatible; Meals)',
			'accept-encoding': 'identity'
		};
		expect(https.get).toHaveBeenCalledExactlyOnceWith(
			expect.anything(),
			expect.objectContaining({ headers }),
			expect.any(Function)
		);
		expect(await stored(key, 'full')).toMatchObject({ format: 'jpeg', width: 1600, height: 800 });
		expect(await stored(key, 'thumb')).toMatchObject({ format: 'jpeg', width: 400, height: 200 });
	});

	it("refuses a link it can't download, and stores nothing", async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const requested = servePages({
			'https://shop.example/gone.png': { status: 404 },
			'https://shop.example/huge.png': { status: 200, body: Buffer.alloc(5_000_001) },
			'https://shop.example/inside.png': {
				status: 302,
				headers: { location: 'http://169.254.169.254/latest/meta-data/' }
			}
		});
		for (const link of [
			'http://127.0.0.1/milk.png',
			'http://10.0.0.1/milk.png',
			'https://shop.example/gone.png',
			'https://shop.example/huge.png',
			'https://shop.example/inside.png'
		]) {
			await expectRefusedWith(saveLinkedImage(new URL(link)), NOT_DOWNLOADED);
		}
		// The private addresses are never asked, not even by a redirect.
		expect(requested).toEqual([
			'https://shop.example/gone.png',
			'https://shop.example/huge.png',
			'https://shop.example/inside.png'
		]);
		expect(logged).toHaveBeenCalledTimes(5);
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});

	it("refuses a link to a page that isn't an image", async () => {
		servePages({
			'https://shop.example/milk': {
				status: 200,
				headers: { 'content-type': 'text/html' },
				body: '<!doctype html><img src="milk.png">'
			}
		});
		await expectRefusedWith(saveLinkedImage(new URL('https://shop.example/milk')), UNUSABLE);
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
	});
});
