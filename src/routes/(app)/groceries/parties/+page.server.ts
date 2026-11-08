import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { createPartyList, listPartyLists } from '#lib/server/data/party-lists.ts';
import { attempt, parseForm, partyListName } from '#lib/server/forms.ts';

export function load({ locals }) {
	const user = requireHousehold(locals);
	return { lists: listPartyLists(user.householdId) };
}

export const actions = {
	// A new list opens right away, ready for its first thing (design 6.15).
	create: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ name: partyListName }), await request.formData(), 'create');
		if ('failure' in parsed) return parsed.failure;
		const { name } = parsed.data;
		const listId = attempt('create', () => createPartyList(user.householdId, name, Date.now()));
		if (typeof listId !== 'number') return listId;
		redirect(303, `/groceries/parties/${listId}`);
	}
};
