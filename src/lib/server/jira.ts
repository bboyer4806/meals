import { config } from './config.ts';

// Feedback becomes a Task in the MEA backlog, created with the Jira settings' API token, so its
// reporter is that token's account (design 7, "Feedback").

const PROJECT = 'MEA';
const ISSUE_TYPE = 'Task';
const LABEL = 'user-feedback';
const TITLE_LENGTH = 80;
const TIMEOUT_MS = 10_000;

export type Feedback = {
	message: string;
	/** The path and query the feedback was sent from, such as /menu/2026-10-21. */
	page: string;
	name: string;
	email: string;
	household: string;
	userAgent: string;
	width: number;
	height: number;
};

/** "Feedback: " and the first 80 characters of the message's first line. */
export function feedbackTitle(message: string): string {
	const firstLine = message.trim().split('\n', 1)[0] ?? '';
	// By code point, so an emoji at the cut isn't split in half.
	return `Feedback: ${Array.from(firstLine.trim()).slice(0, TITLE_LENGTH).join('')}`;
}

type Inline = { type: 'text'; text: string } | { type: 'hardBreak' };

/** A paragraph in Atlassian Document Format. Its lines are joined with line breaks. */
function paragraph(text: string) {
	const content: Inline[] = [];
	text.split('\n').forEach((line, index) => {
		if (index > 0) content.push({ type: 'hardBreak' });
		// Jira rejects empty text nodes.
		if (line !== '') content.push({ type: 'text', text: line });
	});
	return { type: 'paragraph', content };
}

export function feedbackDescription(feedback: Feedback) {
	return {
		type: 'doc',
		version: 1,
		content: [
			paragraph(feedback.message),
			paragraph(
				[
					`Page: ${feedback.page}`,
					`From: ${feedback.name} <${feedback.email}>`,
					`Household: ${feedback.household}`,
					`Browser: ${feedback.userAgent}`,
					`Window: ${feedback.width} × ${feedback.height}`
				].join('\n')
			)
		]
	};
}

/** Creates the feedback's ticket, or throws if Jira refuses it or doesn't answer in time. */
export async function createFeedbackIssue(feedback: Feedback): Promise<void> {
	const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = config();
	const response = await fetch(new URL('/rest/api/3/issue', JIRA_URL), {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/json',
			authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`
		},
		body: JSON.stringify({
			fields: {
				project: { key: PROJECT },
				issuetype: { name: ISSUE_TYPE },
				labels: [LABEL],
				summary: feedbackTitle(feedback.message),
				description: feedbackDescription(feedback)
			}
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`Jira create-issue request failed: ${response.status} ${await response.text()}`);
	}
}
