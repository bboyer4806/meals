import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGINAL_DEFAULT_DISHES } from '../default-dishes.ts';
import { foldCase } from '../text.ts';
import { dishesWithoutPhoto } from './data/dishes.ts';
import {
	addDefaultDishPhotos,
	listHouseholdsWithoutDefaultDishPhotos
} from './data/households.ts';
import { discardPhoto, saveLibraryPhoto } from './photos.ts';
import { libraryName } from './standard-images.ts';

// The original default dishes' photos (design 6.19, MEA-259): photos from the library in
// default-dish-photos/, packaged with the app at the sizes a recipe's photo is stored at (2.3). A
// dish gets a copy of its own, stored as a photo saved in the recipe editor is, so it's changed,
// removed and served like any other. default-dish-photos/credits.csv records where each photo
// came from and its license.

/** The library, in the app's folder, as the standard images' is (standard-images.ts). */
export const LIBRARY = 'default-dish-photos';

/**
 * Each original default dish's library name, named as the standard images are, by its name with
 * case folded, as dish names match (2.3).
 */
const NAMES = new Map(ORIGINAL_DEFAULT_DISHES.map((name) => [foldCase(name), libraryName(name)]));

function libraryFiles(name: string): { photo: string; thumb: string } {
	return { photo: join(LIBRARY, `${name}.jpg`), thumb: join(LIBRARY, `${name}-thumb.jpg`) };
}

/** Throws if a default dish's photo isn't in the library, as when it wasn't packaged with the app. */
export function checkDefaultDishPhotos(): void {
	for (const name of NAMES.values()) {
		for (const path of Object.values(libraryFiles(name))) {
			if (!existsSync(path)) throw new Error(`The default dish photo ${path} is missing`);
		}
	}
}

/**
 * Gives each of the household's dishes named as an original default dish, archived ones included,
 * a copy of that dish's photo if it has none, and records that the household has had them, which
 * happens once (design 6.19). Stores every copy before giving any, so a failure gives none: it
 * deletes the copies it stored, and the household gets them the next time.
 */
export async function assignDefaultDishPhotos(householdId: number, now: number): Promise<void> {
	const photos = new Map<number, string>();
	let unused: string[] | undefined;
	try {
		for (const dish of dishesWithoutPhoto(householdId, ORIGINAL_DEFAULT_DISHES)) {
			const name = NAMES.get(foldCase(dish.name));
			if (name === undefined) throw new Error(`${dish.name} has no default photo`);
			const { photo, thumb } = libraryFiles(name);
			photos.set(dish.id, await saveLibraryPhoto(photo, thumb));
		}
		unused = addDefaultDishPhotos(householdId, photos, now);
	} finally {
		// Every copy, when storing or giving them failed.
		for (const key of unused ?? photos.values()) discardPhoto(key);
	}
}

/** Does the same for every household that hasn't had them, when the app starts (design 6.19). */
export async function assignAllDefaultDishPhotos(now: number): Promise<void> {
	for (const householdId of listHouseholdsWithoutDefaultDishPhotos()) {
		await assignDefaultDishPhotos(householdId, now);
	}
}
