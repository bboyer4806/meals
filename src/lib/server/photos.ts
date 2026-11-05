import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import sharp, { type Sharp } from 'sharp';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { dishes, items } from './db/schema.ts';
import { fetchLink } from './fetch-link.ts';

// Recipe photos and item images are files in $DATA_DIR/photos: <key>.jpg and <key>-thumb.jpg
// (design 4.4). One picked on a device is resized there before upload (photo-resize.ts), so the
// server only checks and stores it. One from a link is downloaded and resized here the same way
// (saveLinkedImage). A file is never written twice: a new photo gets a new key. The nightly backup
// hard-links these files, so changing one in place would change it in the older backups too.

export const PHOTO_MAX_BYTES = 3_000_000;
export const THUMB_MAX_BYTES = 400_000;

const KEY = /^[0-9a-f]{32}$/;

export function photoPath(key: string, size: 'full' | 'thumb'): string {
	// Keys only come from storePhoto, and checking them here means no caller can name another file.
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

/** Stores a JPEG photo and its thumbnail, and returns their new key (32 random hex characters). */
async function storePhoto(photo: Uint8Array, thumb: Uint8Array): Promise<string> {
	const files = [
		{ size: 'full', bytes: photo },
		{ size: 'thumb', bytes: thumb }
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
 * Checks that both files are JPEGs within the limits, as a device resizes them before upload,
 * stores them, and returns their new key.
 */
export async function savePhoto(photo: File, thumb: File): Promise<string> {
	return storePhoto(
		await jpegBytes(photo, PHOTO_MAX_BYTES),
		await jpegBytes(thumb, THUMB_MAX_BYTES)
	);
}

// The server resizes an image as a device resizes a photo (photo-resize.ts).
const PHOTO = { longestSide: 1600, quality: 85 };
const THUMB = { longestSide: 400, quality: 80 };

// Only JPEG, PNG, WebP, GIF and AVIF (a HEIF image) can be read. Anything else, such as SVG or
// TIFF, is refused before any of it is read, as if it weren't an image (design 4.5).
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
	operation: [
		'VipsForeignLoadJpegBuffer',
		'VipsForeignLoadPngBuffer',
		'VipsForeignLoadWebpBuffer',
		'VipsForeignLoadNsgifBuffer',
		'VipsForeignLoadHeifBuffer'
	]
});

// About 8,000 by 6,000 pixels. A few megabytes can hold a far larger image, which would take the
// server seconds and gigabytes of memory to read (design 4.5).
export const IMAGE_MAX_PIXELS = 50_000_000;

const UNUSABLE = "That isn't an image Meals can use. Try a JPEG, PNG, WebP or GIF.";

/** The image scaled down so its longest side is at most `longestSide` px, as a JPEG. */
function scaled(image: Sharp, { longestSide, quality }: typeof PHOTO): Promise<Buffer> {
	return image
		.resize(longestSide, longestSide, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality })
		.toBuffer();
}

/**
 * Resizes an image on the server as a device resizes a photo: the photo to at most 1600 px on its
 * longest side and the thumbnail to at most 400 px, both JPEG, turned upright, with transparent
 * parts white and none of the image's metadata, then stores them and returns their new key. A
 * smaller image keeps its size, and an animated one keeps its first frame. Refuses with a 400 an
 * image that isn't JPEG, PNG, WebP, GIF or AVIF, has over IMAGE_MAX_PIXELS, or can't be read.
 */
export async function saveImage(image: Uint8Array): Promise<string> {
	let source: Sharp;
	let pixels: number;
	try {
		// sharp's own checks for untrusted images stay on, including its default failOn.
		source = sharp(image, { autoOrient: true });
		const { width, height } = await source.metadata();
		pixels = width * height;
	} catch {
		// Not a format that can be read, or nothing at all, which sharp refuses as it starts.
		error(400, UNUSABLE);
	}
	if (pixels > IMAGE_MAX_PIXELS) error(400, 'That image is too large. Try a smaller one.');

	let photo: Buffer;
	let thumb: Buffer;
	try {
		// Transparent parts would turn black in a JPEG.
		photo = await scaled(source.flatten({ background: '#ffffff' }), PHOTO);
		// From the resized photo rather than the original, as on a device.
		thumb = await scaled(sharp(photo), THUMB);
	} catch (e) {
		// Pixels that can't be read, such as those of a file that was cut short.
		console.error("Couldn't resize an image:", e);
		error(400, UNUSABLE);
	}
	return storePhoto(photo, thumb);
}

const IMAGE_HEADERS = {
	accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
	'user-agent': 'Mozilla/5.0 (compatible; Meals)'
};

const NOT_DOWNLOADED =
	"Couldn't download an image from that link. Check the link, or try an image under 5 MB.";

/**
 * Downloads the image at a link, only from a public website and up to 5 MB (fetch-link.ts, design
 * 4.5), then resizes and stores it as saveImage does, and returns its key. A link that can't be
 * downloaded is refused with a 400, as is an image saveImage refuses.
 */
export async function saveLinkedImage(link: URL): Promise<string> {
	let body: Buffer;
	try {
		({ body } = await fetchLink(link, IMAGE_HEADERS));
	} catch (e) {
		console.error(`Couldn't download ${link.href}:`, e);
		error(400, NOT_DOWNLOADED);
	}
	return saveImage(body);
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
