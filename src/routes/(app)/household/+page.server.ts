import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	cancelInvite,
	createInvite,
	getHousehold,
	listInvites,
	listMembers,
	removeMember,
	updateHousehold
} from '#lib/server/data/households.ts';
import {
	createStore,
	listStores,
	renameStore,
	setStoreArchived,
	type StoreNameResult
} from '#lib/server/data/stores.ts';
import { attempt, emailField, householdSettings, id, nameField, parseForm } from '#lib/server/forms.ts';
import { fail } from '@sveltejs/kit';

export function load({ locals }) {
	const user = requireHousehold(locals);
	return {
		household: getHousehold(user.householdId),
		members: listMembers(user.householdId),
		invites: listInvites(user.householdId),
		stores: listStores(user.householdId),
		timeZones: Intl.supportedValuesOf('timeZone')
	};
}

const storeName = nameField(40, 'a store name');

function storeNameFailure(action: string, name: string, result: StoreNameResult) {
	if (result.kind === 'saved') return null;
	const error = result.archived
		? `${name} is archived. Restore it from the archived stores.`
		: `You already have a store called ${name}.`;
	return fail(400, { action, error });
}

export const actions = {
	settings: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(householdSettings, await request.formData(), 'settings');
		if ('failure' in parsed) return parsed.failure;
		updateHousehold(user.householdId, parsed.data);
		return { action: 'settings', message: 'Saved.' };
	},

	invite: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ email: emailField }), await request.formData(), 'invite');
		if ('failure' in parsed) return parsed.failure;
		const { email } = parsed.data;
		const result = createInvite(user.householdId, email, Date.now());
		if (result.kind === 'member') {
			return fail(400, { action: 'invite', error: `${email} already has a Meals account.` });
		}
		if (result.kind === 'invited-already') {
			return fail(400, { action: 'invite', error: `${email} already has an invite.` });
		}
		if (result.kind === 'joined') {
			return { action: 'invite', message: `${email} already had an account and has joined.` };
		}
		return {
			action: 'invite',
			message: `Invited ${email}. Tell them to sign in with that Google account.`
		};
	},

	cancelInvite: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'invite');
		if ('failure' in parsed) return parsed.failure;
		cancelInvite(user.householdId, parsed.data.id);
	},

	removeMember: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'members');
		if ('failure' in parsed) return parsed.failure;
		return attempt('members', () => removeMember(user.householdId, user.id, parsed.data.id));
	},

	addStore: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ name: storeName }), await request.formData(), 'stores');
		if ('failure' in parsed) return parsed.failure;
		const result = createStore(user.householdId, parsed.data.name);
		return storeNameFailure('stores', parsed.data.name, result) ?? { action: 'stores' };
	},

	renameStore: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id, name: storeName }), await request.formData(), 'store');
		if ('failure' in parsed) return parsed.failure;
		const result = renameStore(user.householdId, parsed.data.id, parsed.data.name);
		return storeNameFailure('store', parsed.data.name, result) ?? { action: 'store' };
	},

	archiveStore: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'store');
		if ('failure' in parsed) return parsed.failure;
		setStoreArchived(user.householdId, parsed.data.id, true, Date.now());
		return { action: 'store' };
	},

	restoreStore: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'stores');
		if ('failure' in parsed) return parsed.failure;
		setStoreArchived(user.householdId, parsed.data.id, false, Date.now());
		return { action: 'stores' };
	}
};
