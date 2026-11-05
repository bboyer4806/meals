import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listCatalog, setItemArchived } from '#lib/server/data/items.ts';
import { id, parseForm } from '#lib/server/forms.ts';
import { saveItem } from '#lib/server/item-form.ts';
import { fetchImage } from '#lib/server/photos.ts';

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const { timeZone } = getHousehold(user.householdId);
	const archived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();
	// The household's time zone decides the date (design 11), not the server's or the phone's.
	const catalog = listCatalog(user.householdId, archived, search);
	const items = catalog.map(({ lastBoughtAt, ...item }) => ({
		...item,
		lastBoughtDate: lastBoughtAt === null ? null : dateIn(lastBoughtAt, timeZone)
	}));
	return { archived, search, items, today: dateIn(Date.now(), timeZone) };
}

// An image link (design 7, Item images). It isn't kept, so its limit is only there to refuse a long
// paste, and image addresses can be long.
const imageForm = z.object({
	link: z
		.string()
		.trim()
		.max(2000, 'Keep the link under 2000 characters')
		.pipe(
			z.url({ protocol: /^https?$/, error: 'Enter a link that starts with http:// or https://' })
		)
});

const NO_IMAGE =
	"Couldn't get an image from that link. Use the image's own link, not the page it's on.";

export const actions = {
	// The name, notes and image, saved together.
	update: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		return saveItem(user.householdId, await request.formData());
	},

	// Gives the image a link points at, for the page to resize as it does one from the device, and
	// saves nothing.
	image: async ({ locals, request }) => {
		requireHousehold(locals);
		const parsed = parseForm(imageForm, await request.formData(), 'image');
		if ('failure' in parsed) return parsed.failure;
		const { link } = parsed.data;
		try {
			return { action: 'image', image: await fetchImage(new URL(link)) };
		} catch (e) {
			console.error(`Couldn't get an image from ${link}:`, e);
			return fail(400, { action: 'image', error: NO_IMAGE });
		}
	},

	archive: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		setItemArchived(user.householdId, parsed.data.id, true, Date.now());
		return { action: 'item' };
	},

	restore: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		setItemArchived(user.householdId, parsed.data.id, false, Date.now());
		return { action: 'item' };
	}
};
