import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { dishes, items } from './db/schema.ts';
import { fetchLink } from './fetch-link.ts';

// Recipe photos and item images are files in $DATA_DIR/photos: <key>.jpg and <key>-thumb.jpg
// (design 4.4). The phone resizes them before upload (photo-resize.ts), so the server only checks
// and stores them. A file is never written twice: a new photo gets a new key. The nightly backup
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
