import { z } from 'zod';
import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../menu.ts';
import { editRequest, restoreAndEditRequest } from './data/requests.ts';
import { attempt, id, parseForm, sentName } from './forms.ts';

// Edit on a request, on the Menu and on a date's page (design 6.12): the request's name and note,
// saved together. The form sends only the request's id, name and note, so who asked stays. The
// name is a dish's or a restaurant's, depending on the request, so the data layer checks it once
// it's short enough to normalize (sentName), and says which it is.

const ACTION = 'editRequest';

/** A request's note as its sheets send it, asking or editing: none when it's left empty. */
export const requestNote = z
	.string()
	.trim()
	.max(REQUEST_NOTE_MAX, `Keep the note under ${REQUEST_NOTE_MAX} characters`)
	.transform((text) => (text === '' ? null : text));

const editSchema = z.object({
	id,
	name: sentName(REQUEST_NAME_MAX, 'the name'),
	note: requestNote
});

// The archived dish to restore, with the name and note again (6.10).
const restoreSchema = editSchema.extend({ dishId: id });

/**
 * Saves the edit sheet's form. A new name that matches an archived dish saves nothing and comes
 * back as `archived`, so the sheet can offer to restore it (6.10).
 */
export function saveRequest(householdId: number, formData: FormData, now: number) {
	const parsed = parseForm(editSchema, formData, ACTION);
	if ('failure' in parsed) return parsed.failure;
	const { id: requestId, ...fields } = parsed.data;
	const saved = attempt(ACTION, () => editRequest(householdId, requestId, fields, now));
	if (!('kind' in saved)) return saved;
	if (saved.kind === 'archived') {
		return { action: ACTION, archived: { dishId: saved.dishId, name: saved.name } };
	}
	return { action: ACTION, archived: null };
}

/** Restores the archived dish the sheet offered, and saves the request linked to it. */
export function restoreAndSaveRequest(householdId: number, formData: FormData, now: number) {
	const parsed = parseForm(restoreSchema, formData, ACTION);
	if ('failure' in parsed) return parsed.failure;
	const { id: requestId, dishId, ...fields } = parsed.data;
	return attempt(ACTION, () =>
		restoreAndEditRequest(householdId, requestId, dishId, fields, now)
	);
}
