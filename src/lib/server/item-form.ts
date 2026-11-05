import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { setItemPhoto, updateItem, type ItemNameResult } from './data/items.ts';
import { transaction } from './db/index.ts';
import { id, nameField, optionalText, parseForm, sentPhoto, type FormFailure } from './forms.ts';
import { discardPhoto, savePhoto } from './photos.ts';

// The Items page's edit sheet (design 7, Items and Item images): an item's name, notes and
// image, saved together.

const ACTION = 'item';

const itemFields = z.object({
	id,
	name: nameField(80, 'a name'),
	notes: optionalText(200)
});

function failure(error: string): ActionFailure<FormFailure> {
	return fail(400, { action: ACTION, error });
}

/**
 * Saves the edit sheet's form: the item's name and notes, and a new image, its removal, or
 * neither (sentPhoto). Problems the person can fix come back as a failure, with nothing changed.
 *
 * A new image is stored before the item changes, so an image the server refuses changes nothing,
 * and its files are deleted again if the item isn't saved. The image it replaces, or the one
 * removed, is deleted once the item no longer points at it.
 */
export async function saveItem(
	householdId: number,
	formData: FormData
): Promise<{ action: string } | ActionFailure<FormFailure>> {
	const parsed = parseForm(itemFields, formData, ACTION);
	if ('failure' in parsed) return parsed.failure;
	const { id: itemId, ...changes } = parsed.data;
	const sent = sentPhoto(formData);
	if (sent === undefined) return failure("The image couldn't be uploaded. Choose it again.");

	let photoKey: string | null = null;
	if (sent.photo) {
		try {
			photoKey = await savePhoto(sent.photo.photo, sent.photo.thumb);
		} catch (e) {
			// Not a JPEG, or too large.
			if (isHttpError(e, 400)) return failure(e.body.message);
			throw e;
		}
	}

	let saved: { result: ItemNameResult; previousKey: string | null };
	try {
		saved = transaction(() => {
			const result = updateItem(householdId, itemId, changes);
			const changesImage = result.kind === 'saved' && (photoKey !== null || sent.removePhoto);
			const previousKey = changesImage ? setItemPhoto(householdId, itemId, photoKey) : null;
			return { result, previousKey };
		});
	} catch (e) {
		if (photoKey !== null) discardPhoto(photoKey);
		throw e;
	}

	if (saved.result.kind === 'taken') {
		if (photoKey !== null) discardPhoto(photoKey);
		return failure(
			saved.result.archived
				? `An archived item is already called ${changes.name}.`
				: `An item is already called ${changes.name}.`
		);
	}
	if (saved.previousKey !== null) discardPhoto(saved.previousKey);
	return { action: ACTION };
}
