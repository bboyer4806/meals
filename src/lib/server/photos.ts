import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { PHOTO, THUMB } from '../photo-resize.ts';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { dishes, items } from './db/schema.ts';
import { fetchLink } from './fetch-link.ts';

// Recipe photos and item images are files in $DATA_DIR/photos: <key>.jpg and <key>-thumb.jpg
// (design 4.4). The phone resizes them before upload (photo-resize.ts), so the server only checks
// and stores them. Only an image an AI assistant proposes is resized here, to the same sizes
// (design 6.17). A file is never written twice: a new photo gets a new key. The nightly backup
// hard-links these files, so changing one in place would change it in the older backups too.

export const PHOTO_MAX_BYTES = 3_000_000;
export const THUMB_MAX_BYTES = 400_000;

const KEY = /^[0-9a-f]{32}$/;

export function photoPath(key: string, size: 'full' | 'thumb'): string {
	// Keys only come from savePhoto, and checking them here means no caller can name another file.
	if (!KEY.test(key)) throw new Error('Not a photo key');
	return join(config().DATA_DIR, 'photos', size === 'full' ? `${key}.jpg` : `${key}-thumb.jpg`);
}

/** The file's bytes, if it's a JPEG within the limit. Anything else is refused with a 400. */
async function jpegBytes(file: File, maxBytes: number): Promise<Uint8Array> {
	if (file.size > maxBytes) error(400, 'That photo is too large. Try another one.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	// Every JPEG starts with these three bytes.
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
		error(400, 'The photo must be a JPEG.');
	}
	return bytes;
}

/**
 * Checks that both files are JPEGs within the limits, stores them, and returns their new key
 * (32 random hex characters).
 */
export async function savePhoto(photo: File, thumb: File): Promise<string> {
	const files = [
		{ size: 'full', bytes: await jpegBytes(photo, PHOTO_MAX_BYTES) },
		{ size: 'thumb', bytes: await jpegBytes(thumb, THUMB_MAX_BYTES) }
	] as const;

	// Not recursive: DATA_DIR must already exist (hooks.server.ts), and making it here would put
	// photos where the next deploy deletes them.
	await mkdir(join(config().DATA_DIR, 'photos')).catch((e: NodeJS.ErrnoException) => {
		if (e.code !== 'EEXIST') throw e;
	});

	const key = randomBytes(16).toString('hex');
	const created: string[] = [];
	try {
		for (const { size, bytes } of files) {
			const path = photoPath(key, size);
			// 'wx' fails rather than replace an existing file.
			const handle = await open(path, 'wx');
			created.push(path);
			try {
				await handle.writeFile(bytes);
			} finally {
				await handle.close();
			}
		}
	} catch (e) {
		// Only what this call created, including a file it couldn't finish writing.
		for (const path of created) rmSync(path, { force: true });
		throw e;
	}
	return key;
}

/**
 * Stores a copy of a photo packaged with the app and its thumbnail, checked as savePhoto checks
 * an upload, and returns its new key (design 6.14, 6.19).
 */
export async function saveLibraryPhoto(photo: string, thumb: string): Promise<string> {
	return savePhoto(await libraryFile(photo), await libraryFile(thumb));
}

async function libraryFile(path: string): Promise<File> {
	return new File([await readFile(path)], path, { type: 'image/jpeg' });
}

/** Removes both files. Files that are already gone are fine. */
export function deletePhoto(key: string): void {
	rmSync(photoPath(key, 'full'), { force: true });
	rmSync(photoPath(key, 'thumb'), { force: true });
}

/**
 * Removes a photo's files when nothing should point at them. A file left behind only takes up
 * space, so a failure here is logged rather than failing a save that has already happened.
 */
export function discardPhoto(key: string): void {
	try {
		deletePhoto(key);
	} catch (e) {
		console.error(`Couldn't delete photo ${key}`, e);
	}
}

/** Whether a dish or an item in this household, archived or not, has this photo. */
export function householdOwnsPhoto(householdId: number, key: string): boolean {
	const dish = db()
		.select({ id: dishes.id })
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), eq(dishes.photoKey, key)))
		.get();
	const item = db()
		.select({ id: items.id })
		.from(items)
		.where(and(eq(items.householdId, householdId), eq(items.photoKey, key)))
		.get();
	return dish !== undefined || item !== undefined;
}

// <key>.jpg or <key>-thumb.jpg, and nothing else. SvelteKit decodes a route's parameter, so
// "..%2Fmeals.db" arrives as "../meals.db".
const FILE_NAME = /^([0-9a-f]{32})(-thumb)?\.jpg$/;

/** The photo a file name in a photo's address names, or null for any other name. */
export function parsePhotoFile(name: string): { key: string; size: 'full' | 'thumb' } | null {
	const match = FILE_NAME.exec(name);
	if (!match) return null;
	return { key: match[1]!, size: match[2] ? 'thumb' : 'full' };
}

/**
 * The photo's file as a long-lived private JPEG, for a route that has checked who may see it.
 * Not found when its file is gone, as after a restore that skipped the photos.
 */
export async function photoResponse(key: string, size: 'full' | 'thumb'): Promise<Response> {
	let file: FileHandle;
	try {
		file = await open(photoPath(key, size));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') error(404, 'Not found');
		throw e;
	}
	try {
		const { size: bytes } = await file.stat();
		// The stream closes the file when it ends or the request is cancelled.
		const body = Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
		return new Response(body, {
			headers: {
				'content-type': 'image/jpeg',
				'content-length': String(bytes),
				// A changed photo gets a new key, so a browser never needs to ask again.
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	} catch (e) {
		await file.close();
		throw e;
	}
}

const IMAGE_HEADERS = {
	accept: 'image/jpeg,image/png,image/webp,image/gif',
	'user-agent': 'Mozilla/5.0 (compatible; Meals item image)'
};

/** Whether the bytes start as a JPEG, PNG, GIF or WebP (a RIFF file of type WEBP) does. */
function isImage(bytes: Buffer): boolean {
	const start = bytes.toString('latin1', 0, 12);
	return (
		start.startsWith('\xff\xd8\xff') ||
		start.startsWith('\x89PNG\r\n\x1a\n') ||
		start.startsWith('GIF8') ||
		(start.startsWith('RIFF') && start.slice(8) === 'WEBP')
	);
}

/**
 * The image a link points at, for the browser to resize as it does one picked on the device, so
 * the server never decodes an image (design 7, Item images). Throws if fetchLink can't get it
 * (design 4.5), or if it isn't a JPEG, PNG, GIF or WebP, such as the web page an image is on.
 */
export async function fetchImage(link: URL): Promise<Uint8Array> {
	const { body } = await fetchLink(link, IMAGE_HEADERS);
	if (!isImage(body)) throw new Error(`${link.href} isn't a JPEG, PNG, GIF or WebP`);
	// A copy of its own: a small Buffer can be part of a larger shared one, which sending it to
	// the browser would send whole.
	return new Uint8Array(body);
}

/** What an image link says when it doesn't lead to an image (design 7, Item images; 6.17). */
export const NO_IMAGE =
	"Couldn't get an image from that link. Use the image's own link, not the page it's on.";

// An AI assistant's image is the only one the server decodes (design 4.5), and only as one of the
// kinds of image fetchImage takes. libvips's other loaders, such as SVG's, never run.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
	operation: [
		'VipsForeignLoadJpegBuffer',
		'VipsForeignLoadPngBuffer',
		'VipsForeignLoadNsgifBuffer',
		'VipsForeignLoadWebpBuffer'
	]
});

/** The most pixels an image the server resizes may have, so one can't fill its memory (4.5). */
export const MAX_IMAGE_PIXELS = 25_000_000;

/** What sharp gives, or a refusal (400) when it can't read the image. */
async function readable<T>(reading: Promise<T>): Promise<T> {
	try {
		return await reading;
	} catch (e) {
		console.error("Couldn't read an image:", e);
		error(400, "That image couldn't be read. Try another one.");
	}
}

/**
 * The image as a JPEG at most `size.longestSide` px on its longest side, as the phone makes one
 * (photo-resize.ts): upright, on white where it's transparent, and never enlarged.
 */
function resized(image: Uint8Array, size: { longestSide: number; quality: number }): Promise<Buffer> {
	return (
		sharp(image)
			// Turned upright by the camera's orientation tag, which the new JPEG won't have.
			.rotate()
			// JPEG has no transparency, and transparent parts would turn black.
			.flatten({ background: '#ffffff' })
			.resize(size.longestSide, size.longestSide, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: Math.round(size.quality * 100) })
			.toBuffer()
	);
}

/**
 * Stores the image a link points at, resized as the phone resizes a photo (photo-resize.ts), and
 * returns its new key, for an AI assistant's proposal (design 6.17). Refused (400) when fetchImage
 * can't get it, when it can't be read or is over MAX_IMAGE_PIXELS, or when savePhoto refuses it.
 */
export async function saveImageFromLink(link: URL): Promise<string> {
	let image: Uint8Array;
	try {
		image = await fetchImage(link);
	} catch (e) {
		console.error(`Couldn't get an image from ${link.href}:`, e);
		error(400, NO_IMAGE);
	}
	const { width, height } = await readable(sharp(image).metadata());
	if (width * height > MAX_IMAGE_PIXELS) {
		error(400, `That image is over ${MAX_IMAGE_PIXELS / 1_000_000} megapixels. Try a smaller one.`);
	}
	const photo = await readable(resized(image, PHOTO));
	// From the resized photo rather than the original, as the phone makes it.
	const thumb = await resized(photo, THUMB);
	// As files, as savePhoto takes an upload, each copied out of a Buffer that may be shared.
	return savePhoto(
		new File([new Uint8Array(photo)], 'photo.jpg', { type: 'image/jpeg' }),
		new File([new Uint8Array(thumb)], 'thumb.jpg', { type: 'image/jpeg' })
	);
}
