import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import {
	addPartyItem,
	addToGroceries,
	deletePartyList,
	getPartyList,
	markBought,
	removePartyItem,
	renamePartyList,
	setPartyItemQuantity,
	unmarkBought
} from '#lib/server/data/party-lists.ts';
import { listStores } from '#lib/server/data/stores.ts';
import {
	attempt,
	id,
	idList,
	nameField,
	optionalText,
	parseForm,
	partyListName,
	quantity
} from '#lib/server/forms.ts';
import { assignStandardImages } from '#lib/server/standard-images.ts';

/** The list's id in its address, such as /groceries/parties/7. */
function listIdIn(params: { id: string }): number {
	const parsed = id.safeParse(params.id);
	if (!parsed.success) error(404, 'Not found');
	return parsed.data;
}

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	return {
		list: getPartyList(user.householdId, listIdIn(params)),
		items: listPickerItems(user.householdId),
		stores: listStores(user.householdId)
	};
}

const addSchema = z.object({
	itemName: nameField(80, 'an item'),
	quantity,
	unit: optionalText(20)
});

// Checking a thing off names the store it was bought at when a grocery line it's on has none.
const buySchema = z.object({ id, store: id.optional() });

export const actions = {
	rename: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ name: partyListName }), await request.formData(), 'list');
		if ('failure' in parsed) return parsed.failure;
		const { name } = parsed.data;
		return attempt('list', () => {
			renamePartyList(user.householdId, listIdIn(params), name);
			return { action: 'list' as const };
		});
	},

	// The page asks first (design 6.15).
	delete: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({}), await request.formData(), 'list');
		if ('failure' in parsed) return parsed.failure;
		deletePartyList(user.householdId, listIdIn(params));
		redirect(303, '/groceries/parties');
	},

	add: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(addSchema, await request.formData(), 'add');
		if ('failure' in parsed) return parsed.failure;
		const now = Date.now();
		const added = attempt('add', () => {
			addPartyItem(user.householdId, listIdIn(params), parsed.data, now);
			return { action: 'add' as const };
		});
		// A new item gets its standard image (design 6.14).
		await assignStandardImages(user.householdId, now);
		return added;
	},

	quantity: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id, quantity }), await request.formData(), 'thing');
		if ('failure' in parsed) return parsed.failure;
		const { id: thingId, quantity: needed } = parsed.data;
		return attempt('thing', () =>
			setPartyItemQuantity(user.householdId, listIdIn(params), thingId, needed, Date.now())
		);
	},

	remove: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'thing');
		if ('failure' in parsed) return parsed.failure;
		return attempt('thing', () => removePartyItem(user.householdId, listIdIn(params), parsed.data.id));
	},

	buy: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(buySchema, await request.formData(), 'thing');
		if ('failure' in parsed) return parsed.failure;
		const { id: thingId, store } = parsed.data;
		return attempt('thing', () =>
			markBought(user.householdId, listIdIn(params), thingId, store, Date.now())
		);
	},

	unbuy: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'thing');
		if ('failure' in parsed) return parsed.failure;
		return attempt('thing', () =>
			unmarkBought(user.householdId, listIdIn(params), parsed.data.id, Date.now())
		);
	},

	addToGroceries: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'thing');
		if ('failure' in parsed) return parsed.failure;
		addToGroceries(user.householdId, listIdIn(params), [parsed.data.id], Date.now());
		return { action: 'thing' as const };
	},

	// Add all sends the things its question counted, and adds only those (design 6.2, 6.15).
	addAllToGroceries: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ ids: idList }), await request.formData(), 'all');
		if ('failure' in parsed) return parsed.failure;
		const added = addToGroceries(user.householdId, listIdIn(params), parsed.data.ids, Date.now());
		return { action: 'all' as const, added };
	}
};
