import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { dishes } from './db/schema.ts';

// Recipe photos are files in $DATA_DIR/photos: <key>.jpg and <key>-thumb.jpg (design 4.4). The
// phone resizes them before upload (photo-resize.ts), so the server only checks and stores them.
// A file is never written twice: a new photo gets a new key. The nightly backup hard-links these
// files, so changing one in place would change it in the older backups too.

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

/** Whether a dish in this household, archived or not, has this photo. */
export function householdOwnsPhoto(householdId: number, key: string): boolean {
	const dish = db()
		.select({ id: dishes.id })
		.from(dishes)
		.where(and(eq(dishes.householdId, householdId), eq(dishes.photoKey, key)))
		.get();
	return dish !== undefined;
}
