import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth/guards.ts';
import { latestBackupDate } from '#lib/server/backups.ts';
import { config } from '#lib/server/config.ts';
import { cancelInvite, createInvite, listHouseholds, listInvites } from '#lib/server/data/households.ts';
import { sendEmail } from '#lib/server/email.ts';
import { emailField, id, parseForm } from '#lib/server/forms.ts';

// Send test email checks that Meals can send email (design 7, Admin).
const TEST_EMAIL_TEXT =
	"This is a test email from Meals. If you're reading it, Meals can send email.";
const TEST_EMAIL = {
	subject: 'Meals test email',
	html: `<p>${TEST_EMAIL_TEXT}</p>`,
	text: TEST_EMAIL_TEXT
};
const NOT_SENT = "Couldn't send test email. Please try again.";

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
	},

	testEmail: async ({ locals }) => {
		// Only ever to the signed-in admin's own Google email, never an address from the form.
		const { email } = requireAdmin(locals);
		try {
			await sendEmail({ to: email, ...TEST_EMAIL });
		} catch (e) {
			console.error('The test email was not sent:', e);
			return fail(502, { action: 'testEmail', error: NOT_SENT });
		}
		return { action: 'testEmail', message: `Test email sent to ${email}. Check your inbox.` };
	}
};
