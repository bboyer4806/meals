import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listCatalog, setItemArchived, updateItem } from '#lib/server/data/items.ts';
import { id, nameField, optionalText, parseForm } from '#lib/server/forms.ts';

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const archived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();
	return { archived, search, items: listCatalog(user.householdId, archived, search) };
}

const updateSchema = z.object({
	id,
	name: nameField(80, 'a name'),
	notes: optionalText(200),
	// A checkbox is only sent when it's checked.
	alwaysHave: z
		.literal('on')
		.optional()
		.transform((value) => value === 'on')
});

export const actions = {
	update: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(updateSchema, await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		const { id: itemId, ...changes } = parsed.data;
		const result = updateItem(user.householdId, itemId, changes);
		if (result.kind === 'taken') {
			const error = result.archived
				? `An archived item is already called ${changes.name}.`
				: `An item is already called ${changes.name}.`;
			return fail(400, { action: 'item', error });
		}
		return { action: 'item' };
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
