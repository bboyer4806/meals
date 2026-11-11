import { format } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '#lib/server/auth/session.ts';
import { loadConfig } from '#lib/server/config.ts';
import { TEST_ENV } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const NOT_SENT = "Couldn't send test email. Please try again.";

const admin: SessionUser = {
	id: 1,
	householdId: 1,
	email: 'admin@example.com',
	name: 'Admin',
	isAdmin: true
};

let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	// Resend accepts the email.
	fetch = vi.fn(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68' }));
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Presses Send test email as `user`, with any other fields a forged form might add. */
function sendTestEmail(user: SessionUser | null, fields: Record<string, string> = {}) {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	const request = new Request('http://localhost/admin?/testEmail', { method: 'POST', body: form });
	const event = { locals: { user }, request };
	return actions.testEmail(event as unknown as Parameters<typeof actions.testEmail>[0]);
}

/** The email the one request to Resend sent. */
function sentEmail() {
	expect(fetch).toHaveBeenCalledTimes(1);
	return JSON.parse(fetch.mock.calls[0]![1].body as string);
}

/** Everything the one logged error printed. */
function logged(consoleError: ReturnType<typeof vi.spyOn>): string {
	expect(consoleError).toHaveBeenCalledTimes(1);
	return format(...consoleError.mock.calls[0]!);
}

describe('the test email action', () => {
	it("sends a test email to the admin's own Google email and says so", async () => {
		expect(await sendTestEmail(admin)).toEqual({
			action: 'testEmail',
			message: 'Test email sent to admin@example.com. Check your inbox.'
		});
		expect(sentEmail()).toEqual({
			from: 'Meals <noreply@boyersoftware.com>',
			to: 'admin@example.com',
			subject: 'Meals test email',
			html: "<p>This is a test email from Meals. If you're reading it, Meals can send email.</p>",
			text: "This is a test email from Meals. If you're reading it, Meals can send email."
		});
	});

	it('sends it to the session\'s email, never to one from the form', async () => {
		await sendTestEmail(admin, { to: 'mallory@example.com', email: 'mallory@example.com' });
		expect(sentEmail().to).toBe('admin@example.com');
	});

	it("says it couldn't send when Resend refuses it, and logs why without the API key", async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refusal = { statusCode: 401, message: 'API key is invalid', name: 'validation_error' };
		fetch.mockResolvedValueOnce(Response.json(refusal, { status: 401 }));
		expect(await sendTestEmail(admin)).toEqual({
			status: 502,
			data: { action: 'testEmail', error: NOT_SENT }
		});
		const log = logged(consoleError);
		expect(log).toContain('The test email was not sent');
		expect(log).toContain('401');
		expect(log).toContain('API key is invalid');
		expect(log).not.toContain('resend-key');
	});

	it("says it couldn't send when Resend doesn't answer in time", async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
			AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'))
		);
		fetch.mockImplementationOnce(async (_url, init) => {
			init.signal?.throwIfAborted();
			return new Promise<Response>(() => {});
		});
		expect(await sendTestEmail(admin)).toEqual({
			status: 502,
			data: { action: 'testEmail', error: NOT_SENT }
		});
		expect(logged(consoleError)).toContain('Timed out');
	});

	it('is not found for anyone but the admin, and sends nothing', async () => {
		const member = { ...admin, id: 2, email: 'pat@example.com', name: 'Pat', isAdmin: false };
		await expect(sendTestEmail(member)).rejects.toMatchObject({ status: 404 });
		await expect(sendTestEmail(null)).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(fetch).not.toHaveBeenCalled();
	});
});
