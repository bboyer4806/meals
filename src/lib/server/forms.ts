import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { isValidTimeZone } from '../dates.ts';
import { normalizeName } from '../text.ts';

// Field schemas shared by the form actions. Messages are shown to people as-is.

export const id = z.coerce.number().int().positive();

/**
 * Ids sent in one field, joined by commas, such as "7,12". It takes text, so a caller can limit
 * the field's length before it's split: z.string().max(1000).pipe(idList) (MEA-65).
 */
export const idList = z
	.string()
	// unknown[], the type z.array(id) takes, as id coerces any value.
	.transform((text): unknown[] => text.split(','))
	.pipe(z.array(id));

/**
 * The most characters a name of up to `max` characters may have as sent. Normalizing a name can
 * shorten it, as accents sent apart from their letters join them and runs of spaces become one,
 * but it takes time that grows with the square of a run of combining marks (text.ts), so longer
 * text is refused before it's normalized (MEA-64).
 */
export function sentMax(max: number): number {
	return max * 4;
}

/**
 * A name as sent, up to sentMax characters, for normalizing and checking after. Longer text gets
 * the message for a name over `max`, such as "Keep a label under 30 characters". `params` sets
 * the message for a missing field.
 */
export function sentName(max: number, what: string, params?: { error: string }) {
	return z.string(params).max(sentMax(max), `Keep ${what} under ${max} characters`);
}

export function nameField(max: number, what: string) {
	return sentName(max, what)
		.transform(normalizeName)
		.pipe(
			z
				.string()
				.min(1, `Enter ${what}`)
				.max(max, `Keep ${what} under ${max} characters`)
		);
}

export function optionalText(max: number) {
	return z
		.string()
		.trim()
		.max(max, `Keep it under ${max} characters`)
		.transform((value) => (value === '' ? null : value));
}

export const quantity = z.coerce
	.number()
	.positive('Enter a quantity above 0')
	.max(10_000, 'Enter a smaller quantity');

export const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter an email address'));

/** A party list's name, as it's created or renamed (design 6.15). */
export const partyListName = nameField(60, 'a name');

export const householdSettings = z.object({
	name: nameField(60, 'a household name'),
	defaultServings: z.coerce
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(50, 'Enter 50 servings or fewer'),
	timeZone: z.string().refine(isValidTimeZone, 'Pick a time zone')
});

export type FormFailure = { action: string; error: string };

/** Parses form data, or returns the first problem as a message for the form named `action`. */
export function parseForm<T extends z.ZodType>(
	schema: T,
	data: FormData,
	action: string
): { data: z.output<T> } | { failure: ActionFailure<FormFailure> } {
	const result = schema.safeParse(Object.fromEntries(data));
	if (result.success) return { data: result.data };
	const error = result.error.issues[0]?.message ?? 'Check the form and try again';
	return { failure: fail(400, { action, error }) };
}

/**
 * Runs a data change for the form named `action`. A 400 thrown by the data layer (such as
 * "Pick a store first") becomes a message on the form instead of an error page.
 */
export function attempt<T>(action: string, run: () => T): T | ActionFailure<FormFailure> {
	try {
		return run();
	} catch (e) {
		if (isHttpError(e, 400)) return fail(400, { action, error: e.body.message });
		throw e;
	}
}

/** A photo picked in a form and resized on the phone, with its thumbnail. */
export type PhotoUpload = { photo: File; thumb: File };

/** A file that was sent, null for none, or undefined for something that isn't a file. */
function upload(value: FormDataEntryValue | null): File | null | undefined {
	if (value === null) return null;
	if (!(value instanceof File)) return undefined;
	// A file input left empty sends an empty file.
	return value.size === 0 ? null : value;
}

/**
 * What a form asks for its photo or image (design 7, Edit recipe and Item images): a new one, sent
 * as two files, `photo` and `thumb`, or none to keep the current one. `removePhoto` set to '1'
 * asks to clear it, and is never true with a new one, which replaces it anyway. Undefined when the
 * files can't be read: one without the other, or a field that isn't a file.
 */
export function sentPhoto(
	formData: FormData
): { photo: PhotoUpload | null; removePhoto: boolean } | undefined {
	const photo = upload(formData.get('photo'));
	const thumb = upload(formData.get('thumb'));
	if (photo === undefined || thumb === undefined || (photo === null) !== (thumb === null)) {
		return undefined;
	}
	return {
		photo: photo && thumb ? { photo, thumb } : null,
		removePhoto: photo === null && formData.get('removePhoto') === '1'
	};
}
