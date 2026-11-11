import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { sendEmail, type Email } from './email.ts';
import { TEST_ENV } from './testing.ts';

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const email: Email = {
	to: 'pat@example.com',
	subject: 'Groceries for Saturday',
	html: '<p>Milk and <strong>eggs</strong></p>',
	text: 'Milk and eggs'
};

function stubResend(response: () => Promise<Response>) {
	const fetch = vi.fn(async (_url: string, _init: RequestInit) => response());
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

describe('sendEmail', () => {
	it('sends the HTML and text from Meals through Resend, signed in with the API key', async () => {
		const fetch = stubResend(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68' }));
		await sendEmail(email);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0]!;
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			accept: 'application/json',
			'content-type': 'application/json',
			authorization: 'Bearer resend-key',
			// Resend refuses a request without one.
			'user-agent': 'Meals'
		});
		expect(JSON.parse(init.body as string)).toEqual({
			from: 'Meals <noreply@meals.dev.boyersoftware.com>',
			to: 'pat@example.com',
			subject: 'Groceries for Saturday',
			html: '<p>Milk and <strong>eggs</strong></p>',
			text: 'Milk and eggs'
		});
	});

	it("throws Resend's answer when it refuses the email, without the API key", async () => {
		const refusal = {
			statusCode: 403,
			message: 'The meals.dev.boyersoftware.com domain is not verified.',
			name: 'validation_error'
		};
		stubResend(async () => Response.json(refusal, { status: 403 }));
		const error = await sendEmail(email).then(
			() => expect.fail('sendEmail resolved'),
			(e: unknown) => e
		);
		if (!(error instanceof Error)) throw error;
		expect(error.message).toMatch(/^Resend send-email request failed: 403 .*domain is not verified/);
		expect(error.message).not.toContain('resend-key');
	});

	it("throws when Resend doesn't answer within 10 seconds", async () => {
		// AbortSignal.timeout runs on Node's own timers, so the time is up straight away here.
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				init.signal?.throwIfAborted();
				return new Promise<Response>(() => {});
			})
		);
		await expect(sendEmail(email)).rejects.toThrow('Timed out');
		expect(timeout).toHaveBeenCalledWith(10_000);
	});
});
