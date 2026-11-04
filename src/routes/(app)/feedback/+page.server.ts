import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { parseForm } from '#lib/server/forms.ts';
import {
	attachScreenshot,
	createFeedbackIssue,
	retryIssueKey,
	retryToken
} from '#lib/server/jira.ts';
import { MAX_FEEDBACK, NOT_PNG_OR_JPEG, screenshotType } from '#lib/feedback.ts';

// The feedback sheet on every signed-in page posts here (design 7, "Feedback"). Only the
// message, the page, the window size, the screenshot and a retry token come from the form; who
// sent it comes from the session.

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
	height: z.coerce.number().int().nonnegative(),
	// Sent again after the ticket was created but its screenshot wasn't attached.
	retry: z.string().optional()
});

const NOT_SENT = "Couldn't send your feedback. Try again.";

/**
 * The screenshot sent, if any, named for the type its content shows rather than the name and type
 * the browser gives it.
 */
async function readScreenshot(
	value: FormDataEntryValue | null
): Promise<{ screenshot: File | null } | { problem: string }> {
	if (value === null) return { screenshot: null };
	if (!(value instanceof File)) return { problem: NOT_PNG_OR_JPEG };
	const checked = await screenshotType(value);
	if ('problem' in checked) return checked;
	const name = checked.type === 'image/png' ? 'screenshot.png' : 'screenshot.jpg';
	return { screenshot: new File([value], name, { type: checked.type }) };
}

export const actions = {
	default: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const formData = await request.formData();
		const parsed = parseForm(feedbackForm, formData, 'feedback');
		if ('failure' in parsed) return parsed.failure;
		const { retry, ...fields } = parsed.data;
		// Before the ticket is created, so a screenshot that can't be sent sends nothing.
		const read = await readScreenshot(formData.get('screenshot'));
		if ('problem' in read) return fail(400, { action: 'feedback', error: read.problem });

		let issueKey: string | null;
		if (retry === undefined) {
			try {
				issueKey = await createFeedbackIssue({
					...fields,
					name: user.name,
					email: user.email,
					household: getHousehold(user.householdId).name,
					userAgent: request.headers.get('user-agent') ?? ''
				});
			} catch (e) {
				console.error('Feedback was not sent:', e);
				return fail(502, { action: 'feedback', error: NOT_SENT });
			}
		} else {
			// The ticket has the message already; only the screenshot is left to send.
			issueKey = retryIssueKey(retry, user.id, fields.message);
			if (issueKey === null) return fail(400, { action: 'feedback', error: NOT_SENT });
		}

		if (read.screenshot) {
			try {
				await attachScreenshot(issueKey, read.screenshot);
			} catch (e) {
				console.error(`The screenshot was not attached to ${issueKey}:`, e);
				const token = retryToken(issueKey, user.id, fields.message);
				return fail(502, { action: 'feedback', error: NOT_SENT, retry: token });
			}
		}
		return { action: 'feedback', sent: true };
	}
};
