import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { parseForm } from '#lib/server/forms.ts';
import { createFeedbackIssue } from '#lib/server/jira.ts';
import { MAX_FEEDBACK } from '#lib/feedback.ts';

// The feedback sheet on every signed-in page posts here (design 7, "Feedback"). Only the
// message, the page and the window size come from the form; who sent it comes from the session.

const feedbackForm = z.object({
	message: z
		.string()
		// Forms send line breaks as \r\n, but the box counts each as one character.
		.transform((value) => value.replaceAll('\r\n', '\n').trim())
		.pipe(
			z
				.string()
				.min(1, 'Enter your feedback')
				.max(MAX_FEEDBACK, `Keep your feedback to ${MAX_FEEDBACK.toLocaleString('en-US')} characters`)
		),
	page: z.string().startsWith('/').max(2000),
	width: z.coerce.number().int().nonnegative(),
	height: z.coerce.number().int().nonnegative()
});

const NOT_SENT = "Couldn't send your feedback. Try again.";

export const actions = {
	default: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(feedbackForm, await request.formData(), 'feedback');
		if ('failure' in parsed) return parsed.failure;
		try {
			await createFeedbackIssue({
				...parsed.data,
				name: user.name,
				email: user.email,
				household: getHousehold(user.householdId).name,
				userAgent: request.headers.get('user-agent') ?? ''
			});
		} catch (e) {
			console.error('Feedback was not sent:', e);
			return fail(502, { action: 'feedback', error: NOT_SENT });
		}
		return { action: 'feedback', sent: true };
	}
};
