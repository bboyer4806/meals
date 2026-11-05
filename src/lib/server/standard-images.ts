import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { foldCase } from '../text.ts';
import { listHouseholdsToCheck, listUncheckedItems, setStandardImage } from './data/items.ts';
import { discardPhoto, savePhoto } from './photos.ts';
import { STANDARD_ITEMS } from './standard-items.ts';

// Each standard item's image (design 6.14, MEA-62): a photo from the library in standard-images/,
// packaged with the app at the sizes an image picked on Items is stored at (MEA-50). An item gets a
// copy of its own, stored as such an image is, so it's changed, removed and served like any other.
// standard-images/credits.csv records where each photo came from and its license.

/** The library, in the app's folder, as the migrations are (db/index.ts). */
export const LIBRARY = 'standard-images';

/** The library's name for an item's photo, before .jpg: Jalapeños is jalapenos. */
export function libraryName(itemName: string): string {
	return itemName
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Each standard item's library name, by its name with case folded, as item names match (2.3). */
const NAMES = new Map(STANDARD_ITEMS.map((name) => [foldCase(name), libraryName(name)]));

function libraryFiles(name: string): { photo: string; thumb: string } {
	return { photo: join(LIBRARY, `${name}.jpg`), thumb: join(LIBRARY, `${name}-thumb.jpg`) };
}

/** Throws if a standard item's photo isn't in the library, as when it wasn't packaged with the app. */
export function checkLibrary(): void {
	for (const name of NAMES.values()) {
		for (const path of Object.values(libraryFiles(name))) {
			if (!existsSync(path)) throw new Error(`The standard image ${path} is missing`);
		}
	}
}

async function libraryFile(path: string): Promise<File> {
	return new File([await readFile(path)], path, { type: 'image/jpeg' });
}

/**
 * Gives each of the household's items that hasn't been checked for a standard image the one for its
 * name, if it's a standard item and has no image, and records that it's been checked, so nothing
 * gives it one again (design 6.14). Stops at the first failure, leaving the items not yet checked
 * for the next try.
 */
export async function assignStandardImages(householdId: number, now: number): Promise<void> {
	for (const item of listUncheckedItems(householdId)) {
		const name = item.photoKey === null ? NAMES.get(foldCase(item.name)) : undefined;
		let key: string | null = null;
		if (name !== undefined) {
			const { photo, thumb } = libraryFiles(name);
			key = await savePhoto(await libraryFile(photo), await libraryFile(thumb));
		}
		let taken = false;
		try {
			taken = setStandardImage(householdId, item.id, key, now);
		} finally {
			// It got an image of its own meanwhile, or recording failed.
			if (key !== null && !taken) discardPhoto(key);
		}
	}
}

/** Does the same for every household, when the app starts (design 6.14). */
export async function assignAllStandardImages(now: number): Promise<void> {
	for (const householdId of listHouseholdsToCheck()) await assignStandardImages(householdId, now);
}
