import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { setItemPhoto, updateItem } from './data/items.ts';
import { transaction } from './db/index.ts';
import {
	id,
	nameField,
	optionalText,
	parseForm,
	sentPhoto,
	type FormFailure,
	type PhotoUpload
} from './forms.ts';
import { discardPhoto, saveLinkedImage, savePhoto } from './photos.ts';

// The Items page's edit sheet (design 7, Items): an item's name, notes and image, saved together.
// When any of it can't be saved, nothing changes, including the image (MEA-50).

const ACTION = 'item';

const itemFields = z.object({
	id,
	name: nameField(80, 'a name'),
	notes: optionalText(200),
	// A link to an image, which the server downloads (design 4.5). Like Import from a link's, it
	// must start with http:// or https:// and be up to 500 characters. Empty means none.
	photoLink: z
		.string()
		.trim()
		.max(500, 'Keep the image link under 500 characters')
		.transform((link) => (link === '' ? undefined : link))
		.pipe(
			z
				.url({
					protocol: /^https?$/,
					error: 'Enter an image link that starts with http:// or https://'
				})
				.optional()
		)
});

/** What saving does to the item's image. */
type ImageChange =
	| { kind: 'keep' }
	| { kind: 'upload'; upload: PhotoUpload }
	| { kind: 'link'; link: URL }
	| { kind: 'remove' };

/**
 * The image change the sheet sent: an image picked on the device and resized there (`photo` and
 * `thumb`), a link (`photoLink`), or `removePhoto` set to '1'. Undefined when the files can't be
 * read or more than one change was sent, which the sheet never does.
 */
function imageChange(formData: FormData, link: string | undefined): ImageChange | undefined {
	const upload = sentPhoto(formData);
	const remove = formData.get('removePhoto') === '1';
	if (upload === undefined) return undefined;
	if ([upload !== null, link !== undefined, remove].filter(Boolean).length > 1) return undefined;
	if (upload) return { kind: 'upload', upload };
	if (link !== undefined) return { kind: 'link', link: new URL(link) };
	if (remove) return { kind: 'remove' };
	return { kind: 'keep' };
}

/** Stores a new image and gives its key, or null when the change adds none. */
function storeImage(change: ImageChange): Promise<string | null> {
	if (change.kind === 'upload') return savePhoto(change.upload.photo, change.upload.thumb);
	if (change.kind === 'link') return saveLinkedImage(change.link);
	return Promise.resolve(null);
}

function failure(error: string): ActionFailure<FormFailure> {
	return fail(400, { action: ACTION, error });
}

/**
 * Saves the Items sheet's form: the item's name and notes, and its image when the form changes
 * it. A new image is stored first, from the device's files or downloaded from the link, so one
 * that can't be used changes nothing, and its files are deleted again if the item isn't saved.
 * The image it replaces, or the one removed, is deleted once the item no longer points at it.
 * Problems the person can fix come back as a failure, with nothing changed.
 */
export async function saveItem(
	householdId: number,
	formData: FormData
): Promise<ActionFailure<FormFailure> | { action: string }> {
	const parsed = parseForm(itemFields, formData, ACTION);
	if ('failure' in parsed) return parsed.failure;
	const { id: itemId, name, notes, photoLink } = parsed.data;
	const change = imageChange(formData, photoLink);
	if (change === undefined) return failure("The image couldn't be uploaded. Choose it again.");

	let photoKey: string | null;
	try {
		photoKey = await storeImage(change);
	} catch (e) {
		// Not an image that can be used, or a link that can't be downloaded.
		if (isHttpError(e, 400)) return failure(e.body.message);
		throw e;
	}

	let saved;
	try {
		saved = transaction(() => {
			const result = updateItem(householdId, itemId, { name, notes });
			const previousKey =
				result.kind === 'saved' && change.kind !== 'keep'
					? setItemPhoto(householdId, itemId, photoKey)
					: null;
			return { result, previousKey };
		});
	} catch (e) {
		if (photoKey !== null) discardPhoto(photoKey);
		throw e;
	}

	const { result, previousKey } = saved;
	if (result.kind === 'taken') {
		if (photoKey !== null) discardPhoto(photoKey);
		return failure(
			result.archived
				? `An archived item is already called ${name}.`
				: `An item is already called ${name}.`
		);
	}
	if (previousKey !== null) discardPhoto(previousKey);
	return { action: ACTION };
}
