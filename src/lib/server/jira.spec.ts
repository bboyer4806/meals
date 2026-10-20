import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { createFeedbackIssue, feedbackTitle, type Feedback } from './jira.ts';
import { TEST_ENV } from './testing.ts';

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const feedback: Feedback = {
	message: 'The note box is small\n\nIt cuts off long notes.',
	page: '/menu/2026-10-21?from=week',
	name: 'Pat',
	email: 'pat@example.com',
	household: 'Our house',
	userAgent: 'Mozilla/5.0 Test',
	width: 412,
	height: 839
};

function stubJira(response: () => Promise<Response>) {
	const fetch = vi.fn(async (_url: URL, _init: RequestInit) => response());
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

/** The URL, headers and fields of the one request sent to Jira. */
function sent(fetch: ReturnType<typeof stubJira>) {
	expect(fetch).toHaveBeenCalledTimes(1);
	const [url, init] = fetch.mock.calls[0]!;
	return {
		url: String(url),
		headers: init.headers as Record<string, string>,
		fields: JSON.parse(init.body as string).fields
	};
}

/** All the text in an Atlassian Document Format value, with line breaks as \n. */
function text(node: { type: string; text?: string; content?: unknown[] }): string {
	if (node.type === 'text') return node.text ?? '';
	if (node.type === 'hardBreak') return '\n';
	const inner = (node.content ?? []).map((child) => text(child as typeof node));
	return inner.join(node.type === 'doc' ? '\n\n' : '');
}

describe('feedbackTitle', () => {
	it("is the first 80 characters of the message's first line", () => {
		expect(feedbackTitle('  Too slow  \nmore')).toBe('Feedback: Too slow');
		expect(feedbackTitle('a'.repeat(100))).toBe(`Feedback: ${'a'.repeat(80)}`);
		expect(feedbackTitle(`${'a'.repeat(79)}🍅🍅`)).toBe(`Feedback: ${'a'.repeat(79)}🍅`);
	});
});

describe('createFeedbackIssue', () => {
	it('creates a Task in MEA, labeled user-feedback, signed in with the token', async () => {
		const fetch = stubJira(async () => Response.json({ key: 'MEA-99' }, { status: 201 }));
		await createFeedbackIssue(feedback);
		const { url, headers, fields } = sent(fetch);
		expect(url).toBe('https://jira.example.com/rest/api/3/issue');
		expect(headers.authorization).toBe(
			`Basic ${Buffer.from('feedback@example.com:jira-token').toString('base64')}`
		);
		expect(fields).toMatchObject({
			project: { key: 'MEA' },
			issuetype: { name: 'Task' },
			labels: ['user-feedback'],
			summary: 'Feedback: The note box is small'
		});
		expect(Object.keys(fields).sort()).toEqual(
			['description', 'issuetype', 'labels', 'project', 'summary'].sort()
		);
	});

	it('describes the message, page, sender, household, browser and window', async () => {
		const fetch = stubJira(async () => Response.json({}, { status: 201 }));
		await createFeedbackIssue(feedback);
		const { fields } = sent(fetch);
		expect(text(fields.description)).toBe(
			[
				'The note box is small\n\nIt cuts off long notes.',
				[
					'Page: /menu/2026-10-21?from=week',
					'From: Pat <pat@example.com>',
					'Household: Our house',
					'Browser: Mozilla/5.0 Test',
					'Window: 412 × 839'
				].join('\n')
			].join('\n\n')
		);
		// Jira rejects empty text nodes, such as the message's blank line.
		expect(JSON.stringify(fields.description)).not.toContain('"text":""');
	});

	it('throws when Jira refuses the ticket', async () => {
		stubJira(async () => Response.json({ errors: { labels: 'bad' } }, { status: 400 }));
		await expect(createFeedbackIssue(feedback)).rejects.toThrow(/400/);
	});

	it("throws when Jira doesn't answer within 10 seconds", async () => {
		// AbortSignal.timeout runs on Node's own timers, so the time is up straight away here.
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: URL, init: RequestInit) => {
				init.signal?.throwIfAborted();
				return new Promise<Response>(() => {});
			})
		);
		await expect(createFeedbackIssue(feedback)).rejects.toThrow('Timed out');
		expect(timeout).toHaveBeenCalledWith(10_000);
	});
});
