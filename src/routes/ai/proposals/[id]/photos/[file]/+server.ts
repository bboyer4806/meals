import { error } from '@sveltejs/kit';
import { getProposal } from '#lib/server/ai/proposals.ts';
import { requireAdmin } from '#lib/server/auth/guards.ts';
import { id } from '#lib/server/forms.ts';
import { parsePhotoFile, photoResponse } from '#lib/server/photos.ts';

// An image a proposal's page shows (design 6.17): one it proposes, or the one a record has that it
// would replace. Only for the admin, and only the images that proposal shows, whatever household
// they're in.
export async function GET({ locals, params }) {
	requireAdmin(locals);
	const proposalId = id.safeParse(params.id);
	const photo = parsePhotoFile(params.file);
	if (!proposalId.success || !photo) error(404, 'Not found');
	const shown = getProposal(proposalId.data, Date.now()).changes.some((change) =>
		[...change.current, ...change.proposed].some((field) => field.photoKey === photo.key)
	);
	if (!shown) error(404, 'Not found');
	return photoResponse(photo.key, photo.size);
}
