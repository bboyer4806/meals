import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import {
	attachScreenshot,
	createFeedbackIssue,
	feedbackTitle,
	retryIssueKey,
	retryToken,
	type Feedback
} from './jira.ts';
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

const AUTHORIZATION = `Basic ${Buffer.from('feedback@example.com:jira-token').toString('base64')}`;

// Jira's answer to a new ticket.
const CREATED = {
	id: '10099',
	key: 'MEA-99',
	self: 'https://jira.example.com/rest/api/3/issue/10099'
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
		const fetch = stubJira(async () => Response.json(CREATED, { status: 201 }));
		expect(await createFeedbackIssue(feedback)).toBe('MEA-99');
		const { url, headers, fields } = sent(fetch);
		expect(url).toBe('https://jira.example.com/rest/api/3/issue');
		expect(headers.authorization).toBe(AUTHORIZATION);
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
		const fetch = stubJira(async () => Response.json(CREATED, { status: 201 }));
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

	it("throws when Jira's answer has no issue key", async () => {
		stubJira(async () => Response.json({ id: '10099' }, { status: 201 }));
		await expect(createFeedbackIssue(feedback)).rejects.toThrow();
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

describe('attachScreenshot', () => {
	const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
	const screenshot = new File([bytes], 'screenshot.png', { type: 'image/png' });

	it('attaches the file to the ticket with its name and type, signed in', async () => {
		const fetch = stubJira(async () => Response.json([{ id: '10200' }]));
		await attachScreenshot('MEA-99', screenshot);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toBe('https://jira.example.com/rest/api/3/issue/MEA-99/attachments');
		expect(init.method).toBe('POST');
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe(AUTHORIZATION);
		// Jira refuses an upload without it.
		expect(headers['x-atlassian-token']).toBe('no-check');
		// Left to fetch, which adds the form's boundary.
		expect(headers['content-type']).toBeUndefined();
		const file = (init.body as FormData).get('file');
		if (!(file instanceof File)) throw new Error('No file sent');
		expect(file.name).toBe('screenshot.png');
		expect(file.type).toBe('image/png');
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
	});

	it('throws when Jira refuses the file', async () => {
		stubJira(async () => new Response('Too large', { status: 413 }));
		await expect(attachScreenshot('MEA-99', screenshot)).rejects.toThrow(/413/);
	});

	it("throws when Jira doesn't answer within 10 seconds", async () => {
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
		await expect(attachScreenshot('MEA-99', screenshot)).rejects.toThrow('Timed out');
		expect(timeout).toHaveBeenCalledWith(10_000);
	});
});

describe('retry tokens', () => {
	const token = () => retryToken('MEA-99', 7, 'The note box is small');

	it('name the ticket for the person and message they were made for', () => {
		expect(retryIssueKey(token(), 7, 'The note box is small')).toBe('MEA-99');
	});

	it('are refused for another person or another message', () => {
		expect(retryIssueKey(token(), 8, 'The note box is small')).toBeNull();
		expect(retryIssueKey(token(), 7, 'The note box is tiny')).toBeNull();
	});

	it('are refused when changed', () => {
		const [, signature] = token().split('.');
		expect(retryIssueKey(`MEA-98.${signature}`, 7, 'The note box is small')).toBeNull();
		const last = token().at(-1) === 'A' ? 'B' : 'A';
		expect(retryIssueKey(`${token().slice(0, -1)}${last}`, 7, 'The note box is small')).toBeNull();
		for (const changed of [`${token()}A`, token().slice(0, -1), 'MEA-99', `.${signature}`, '']) {
			expect(retryIssueKey(changed, 7, 'The note box is small'), changed).toBeNull();
		}
	});

	it('are signed with the Jira API token, so a new one refuses older tokens', () => {
		const old = token();
		try {
			loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp', JIRA_API_TOKEN: 'new-jira-token' });
			expect(retryIssueKey(old, 7, 'The note box is small')).toBeNull();
			expect(retryIssueKey(token(), 7, 'The note box is small')).toBe('MEA-99');
		} finally {
			loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
		}
	});
});
