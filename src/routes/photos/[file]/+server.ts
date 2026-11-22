import { error } from '@sveltejs/kit';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { householdOwnsPhoto, parsePhotoFile, photoResponse } from '#lib/server/photos.ts';

// A recipe photo, only for the household whose dish has it (design 4.5).
export async function GET({ locals, params }) {
	const user = requireHousehold(locals);
	const photo = parsePhotoFile(params.file);
	// Another household's photo gets the same answer as one that doesn't exist.
	if (!photo || !householdOwnsPhoto(user.householdId, photo.key)) error(404, 'Not found');
	return photoResponse(photo.key, photo.size);
}
