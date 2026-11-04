import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.ts';

// Feedback becomes a Task in the MEA backlog, created with the Jira settings' API token, so its
// reporter is that token's account, and a screenshot sent with it is attached to the Task
// (design 7, "Feedback").

const PROJECT = 'MEA';
const ISSUE_TYPE = 'Task';
const LABEL = 'user-feedback';
const TITLE_LENGTH = 80;
const TIMEOUT_MS = 10_000;

// An issue key, such as MEA-123.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
// An issue key, a dot and a base64url SHA-256 signature.
const RETRY_TOKEN = /^([A-Z][A-Z0-9_]*-\d+)\.([\w-]{43})$/;

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

/** The Jira settings' account and API token, as Jira's API takes them. */
function authorization(): string {
	const { JIRA_EMAIL, JIRA_API_TOKEN } = config();
	return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

const createdIssue = z.object({ key: z.string().regex(ISSUE_KEY) });

/**
 * Creates the feedback's ticket and returns its key, such as MEA-123, or throws if Jira refuses it
 * or doesn't answer in time.
 */
export async function createFeedbackIssue(feedback: Feedback): Promise<string> {
	const response = await fetch(new URL('/rest/api/3/issue', config().JIRA_URL), {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/json',
			authorization: authorization()
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
	return createdIssue.parse(await response.json()).key;
}

/**
 * Attaches the screenshot to the ticket with the screenshot's name and type, or throws if Jira
 * refuses it or doesn't answer in time.
 */
export async function attachScreenshot(issueKey: string, screenshot: File): Promise<void> {
	const body = new FormData();
	body.set('file', screenshot);
	const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`;
	const response = await fetch(new URL(path, config().JIRA_URL), {
		method: 'POST',
		headers: {
			accept: 'application/json',
			authorization: authorization(),
			// Jira refuses an upload without it, as protection against cross-site requests.
			'x-atlassian-token': 'no-check'
		},
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`Jira attachment request failed: ${response.status} ${await response.text()}`);
	}
}

// When a ticket is created but its screenshot isn't attached, sending again attaches the
// screenshot to that ticket rather than creating another. The browser keeps which ticket in a
// retry token, signed so it works only for the person and message it was made for. The Jira API
// token signs it, so it needs no setting or storage of its own; a new API token turns away older
// retry tokens.

function retrySignature(issueKey: string, userId: number, message: string): string {
	return createHmac('sha256', config().JIRA_API_TOKEN)
		.update(JSON.stringify(['feedback retry', issueKey, userId, message]))
		.digest('base64url');
}

/** A token that lets this person send this message again to the ticket already created for it. */
export function retryToken(issueKey: string, userId: number, message: string): string {
	return `${issueKey}.${retrySignature(issueKey, userId, message)}`;
}

/**
 * The ticket a retry token names, or null if the token wasn't made for this person and message or
 * has been changed.
 */
export function retryIssueKey(token: string, userId: number, message: string): string | null {
	const match = RETRY_TOKEN.exec(token);
	if (!match) return null;
	const [, issueKey = '', signature = ''] = match;
	const expected = retrySignature(issueKey, userId, message);
	return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? issueKey : null;
}
