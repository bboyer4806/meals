import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth/guards.ts';
import { latestBackupDate } from '#lib/server/backups.ts';
import { config } from '#lib/server/config.ts';
import { cancelInvite, createInvite, listHouseholds, listInvites } from '#lib/server/data/households.ts';
import { emailField, id, parseForm } from '#lib/server/forms.ts';

export function load({ locals }) {
	requireAdmin(locals);
	return {
		invites: listInvites(null),
		households: listHouseholds(),
		latestBackup: latestBackupDate(config().DATA_DIR)
	};
}

export const actions = {
	invite: async ({ locals, request }) => {
		requireAdmin(locals);
		const parsed = parseForm(z.object({ email: emailField }), await request.formData(), 'invite');
		if ('failure' in parsed) return parsed.failure;
		const { email } = parsed.data;
		const result = createInvite(null, email, Date.now());
		if (result.kind === 'member') {
			return fail(400, { action: 'invite', error: `${email} already has a Meals account.` });
		}
		if (result.kind === 'invited-already') {
			return fail(400, { action: 'invite', error: `${email} already has an invite.` });
		}
		return {
			action: 'invite',
			message: `Invited ${email} to start a household. Tell them to sign in with that Google account.`
		};
	},

	cancelInvite: async ({ locals, request }) => {
		requireAdmin(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'invite');
		if ('failure' in parsed) return parsed.failure;
		cancelInvite(null, parsed.data.id);
	}
};
