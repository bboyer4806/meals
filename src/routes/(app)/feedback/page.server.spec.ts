import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { retryToken } from '#lib/server/jira.ts';
import { TEST_ENV, freshDb, makeHousehold } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const NOT_SENT = "Couldn't send your feedback. Try again.";
const ISSUE_URL = 'https://jira.example.com/rest/api/3/issue';
const ATTACHMENT_URL = 'https://jira.example.com/rest/api/3/issue/MEA-99/attachments';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

let householdId: number;
let fetch: ReturnType<typeof vi.fn<(url: URL, init: RequestInit) => Promise<Response>>>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
	// Jira creates MEA-99, and takes a file attached to it.
	fetch = vi.fn(async (url: URL) =>
		String(url) === ATTACHMENT_URL
			? Response.json([{ id: '10200' }])
			: Response.json({ key: 'MEA-99' }, { status: 201 })
	);
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Sends the feedback form as the household's member, giving the action's result. */
function send(fields: Record<string, string | File>) {
	const form = new FormData();
	const values = { page: '/menu', width: '412', height: '839', ...fields };
	for (const [name, value] of Object.entries(values)) form.set(name, value);
	const request = new Request('http://localhost/feedback', {
		method: 'POST',
		body: form,
		headers: { 'user-agent': 'Mozilla/5.0 Test' }
	});
	const user = { id: 1, householdId, email: 'pat@example.com', name: 'Pat', isAdmin: false };
	const event = { locals: { user }, request };
	return actions.default(event as unknown as Parameters<typeof actions.default>[0]);
}

/** The text of the ticket's description. */
function description(): string {
	expect(fetch).toHaveBeenCalledTimes(1);
	const init = fetch.mock.calls[0]![1];
	return JSON.stringify(JSON.parse(init.body as string).fields.description);
}

/** The URLs of the requests sent to Jira, in order. */
function requested(): string[] {
	return fetch.mock.calls.map(([url]) => String(url));
}

/** The file attached by the last request to Jira. */
function attached(): File {
	const [url, init] = fetch.mock.calls.at(-1)!;
	expect(String(url)).toBe(ATTACHMENT_URL);
	const file = (init.body as FormData).get('file');
	if (!(file instanceof File)) throw new Error('No file attached');
	return file;
}

/** A file of `size` bytes that starts with `start`, with the name and type a browser gave it. */
function file(start: number[], size = 100, name = 'shot.png', type = 'image/png'): File {
	const bytes = new Uint8Array(size);
	bytes.set(start);
	return new File([bytes], name, { type });
}

/** Fails the next request to attach a file, as Jira might. */
function failNextAttachment() {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	fetch.mockImplementationOnce(async () => Response.json({ key: 'MEA-99' }, { status: 201 }));
	fetch.mockImplementationOnce(async () => new Response('Unavailable', { status: 503 }));
}

describe('the feedback action', () => {
	it('says to enter feedback when the box is empty, and sends nothing', async () => {
		for (const message of ['', '  \r\n ']) {
			expect(await send({ message })).toMatchObject({
				status: 400,
				data: { error: 'Enter your feedback' }
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('takes 2,000 characters, counting a line break as one, and rejects 2,001', async () => {
		expect(await send({ message: 'a'.repeat(2001) })).toMatchObject({
			status: 400,
			data: { error: 'Keep your feedback to 2,000 characters' }
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(await send({ message: `${'a'.repeat(999)}\r\n${'b'.repeat(1000)}` })).toEqual({
			action: 'feedback',
			sent: true
		});
	});

	it('names the sender and household from the session, not the form', async () => {
		const result = await send({
			message: 'Hello',
			name: 'Mallory',
			email: 'mallory@example.com',
			household: 'Not mine',
			userAgent: 'Forged'
		});
		expect(result).toEqual({ action: 'feedback', sent: true });
		const text = description();
		expect(text).toContain('From: Pat <pat@example.com>');
		expect(text).toContain(`Household: ${getHousehold(householdId).name}`);
		expect(text).toContain('Browser: Mozilla/5.0 Test');
		expect(text).toContain('Page: /menu');
		expect(text).toContain('Window: 412 × 839');
		expect(text).not.toMatch(/Mallory|Not mine|Forged/);
	});

	it("says it couldn't send when Jira fails", async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		fetch.mockResolvedValueOnce(new Response('down', { status: 503 }));
		expect(await send({ message: 'Hello' })).toMatchObject({
			status: 502,
			data: { error: "Couldn't send your feedback. Try again." }
		});
	});
});

describe('the feedback action with a screenshot', () => {
	it('creates the ticket, then attaches the screenshot to it', async () => {
		const screenshot = file(PNG, 2000, 'Screenshot 2026-11-04.png');
		expect(await send({ message: 'Hello', screenshot })).toEqual({
			action: 'feedback',
			sent: true
		});
		expect(requested()).toEqual([ISSUE_URL, ATTACHMENT_URL]);
		const sent = attached();
		expect(sent.name).toBe('screenshot.png');
		expect(sent.type).toBe('image/png');
		expect(new Uint8Array(await sent.arrayBuffer())).toEqual(
			new Uint8Array(await screenshot.arrayBuffer())
		);
	});

	it("keeps the ticket's title, labels and description as without a screenshot", async () => {
		await send({ message: 'Hello' });
		const textOnly = fetch.mock.calls[0]![1].body;
		fetch.mockClear();
		await send({ message: 'Hello', screenshot: file(PNG) });
		expect(fetch.mock.calls[0]![1].body).toBe(textOnly);
	});

	it('names the screenshot for its content, not the name or type it came with', async () => {
		await send({ message: 'Hello', screenshot: file(JPEG, 100, 'shot.png', 'image/png') });
		expect(attached()).toMatchObject({ name: 'screenshot.jpg', type: 'image/jpeg' });
	});

	it('takes a screenshot of 3 MB, 3,000,000 bytes', async () => {
		expect(await send({ message: 'Hello', screenshot: file(PNG, 3_000_000) })).toEqual({
			action: 'feedback',
			sent: true
		});
		expect(attached().size).toBe(3_000_000);
	});

	it('refuses a screenshot over 3 MB or not a PNG or JPEG, and creates no ticket', async () => {
		const page = new File(['<html>Not a picture</html>'], 'shot.png', { type: 'image/png' });
		const gif = file([0x47, 0x49, 0x46, 0x38], 100, 'shot.gif', 'image/gif');
		const notPngOrJpeg = 'The screenshot must be a PNG or JPEG.';
		const refused: [File | string, string][] = [
			[file(PNG, 3_000_001), 'That screenshot is over 3 MB. Choose a smaller one.'],
			[gif, notPngOrJpeg],
			[page, notPngOrJpeg],
			['not a file', notPngOrJpeg]
		];
		for (const [screenshot, error] of refused) {
			expect(await send({ message: 'Hello', screenshot })).toMatchObject({
				status: 400,
				data: { action: 'feedback', error }
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it("says it couldn't send when the screenshot fails, then attaches it to the same ticket", async () => {
		failNextAttachment();
		const screenshot = file(PNG);
		// Made for this person, message and ticket.
		const retry = retryToken('MEA-99', 1, 'Hello');
		expect(await send({ message: 'Hello', screenshot })).toMatchObject({
			status: 502,
			data: { action: 'feedback', error: NOT_SENT, retry }
		});
		expect(requested()).toEqual([ISSUE_URL, ATTACHMENT_URL]);

		fetch.mockClear();
		expect(await send({ message: 'Hello', screenshot, retry })).toEqual({
			action: 'feedback',
			sent: true
		});
		expect(requested()).toEqual([ATTACHMENT_URL]);
	});

	it('gives the token again when the screenshot fails again', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const retry = retryToken('MEA-99', 1, 'Hello');
		fetch.mockImplementationOnce(async () => new Response('Unavailable', { status: 503 }));
		expect(await send({ message: 'Hello', screenshot: file(PNG), retry })).toMatchObject({
			status: 502,
			data: { error: NOT_SENT, retry }
		});
		expect(requested()).toEqual([ATTACHMENT_URL]);
	});

	it('finishes without Jira when the screenshot was removed before sending again', async () => {
		const retry = retryToken('MEA-99', 1, 'Hello');
		expect(await send({ message: 'Hello', retry })).toEqual({ action: 'feedback', sent: true });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses a changed token, or one for another person or message, and sends nothing', async () => {
		const token = retryToken('MEA-99', 1, 'Hello');
		const refused: [string, string][] = [
			[token.replace('MEA-99', 'MEA-98'), 'Hello'],
			[`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, 'Hello'],
			[retryToken('MEA-99', 2, 'Hello'), 'Hello'],
			[token, 'Hello again'],
			['MEA-99', 'Hello']
		];
		for (const [retry, message] of refused) {
			expect(await send({ message, retry, screenshot: file(PNG) }), retry).toMatchObject({
				status: 400,
				data: { action: 'feedback', error: NOT_SENT }
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});
});
