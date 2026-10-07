import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { householdOwnsPhoto, photoPath } from '#lib/server/photos.ts';

// <key>.jpg or <key>-thumb.jpg, and nothing else. SvelteKit decodes the parameter, so
// "..%2Fmeals.db" arrives here as "../meals.db".
const FILE_NAME = /^([0-9a-f]{32})(-thumb)?\.jpg$/;

// A recipe photo, only for the household whose dish has it (design 4.5).
export async function GET({ locals, params }) {
	const user = requireHousehold(locals);
	const match = FILE_NAME.exec(params.file);
	const key = match?.[1];
	// Another household's photo gets the same answer as one that doesn't exist.
	if (!match || !key || !householdOwnsPhoto(user.householdId, key)) error(404, 'Not found');

	let file: FileHandle;
	try {
		file = await open(photoPath(key, match[2] ? 'thumb' : 'full'));
	} catch (e) {
		// The dish has the photo but its file is gone, as after a restore that skipped the photos.
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') error(404, 'Not found');
		throw e;
	}
	try {
		const { size } = await file.stat();
		// The stream closes the file when it ends or the request is cancelled.
		const body = Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
		return new Response(body, {
			headers: {
				'content-type': 'image/jpeg',
				'content-length': String(size),
				// A changed photo gets a new key, so a browser never needs to ask again.
				'cache-control': 'private, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		await file.close();
		throw e;
	}
}
