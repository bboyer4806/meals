import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listCatalog, setItemArchived } from '#lib/server/data/items.ts';
import { id, parseForm } from '#lib/server/forms.ts';
import { saveItem } from '#lib/server/item-form.ts';

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

export const actions = {
	// Name, notes and image, saved together (item-form.ts).
	update: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		return saveItem(user.householdId, await request.formData());
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
