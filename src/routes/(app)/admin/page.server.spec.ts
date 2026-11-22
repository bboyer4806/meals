import { format } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '#lib/server/auth/session.ts';
import { loadConfig } from '#lib/server/config.ts';
import { INVITE_LIMIT, listInvites } from '#lib/server/data/households.ts';
import { db } from '#lib/server/db/index.ts';
import { invites, users } from '#lib/server/db/schema.ts';
import { freshDb, makeHousehold, TEST_ENV } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const NOT_SENT = "Couldn't send test email. Please try again.";
const INVITE_SENT = 'An invite email was sent to them.';
const INVITE_NOT_SENT =
	"the invite email couldn't be sent. Tell them to sign in with that Google account.";

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

describe('invite emails to start a household (6.1, MEA-26)', () => {
	beforeEach(() => {
		freshDb();
	});

	/** Posts the Admin page's form `action` as `user`, giving what it returned or what it threw. */
	async function post(
		action: 'invite' | 'cancelInvite',
		fields: Record<string, string>,
		user: SessionUser | null = admin
	): Promise<unknown> {
		const body = new FormData();
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		const url = new URL(`http://localhost/admin?/${action}`);
		const request = new Request(url, { method: 'POST', body });
		const event = { locals: { user }, request, url } as unknown as Parameters<
			(typeof actions)[typeof action]
		>[0];
		try {
			return await actions[action](event);
		} catch (e) {
			return e;
		}
	}

	function inviteFor(email: string): void {
		db().insert(invites).values({ email, householdId: null, createdAt: 0 }).run();
	}

	it('email a new invite to the address entered, saying how to set up a household', async () => {
		expect(await post('invite', { email: ' Pat@Example.com ' })).toEqual({
			action: 'invite',
			message: `Invited pat@example.com to start a household. ${INVITE_SENT}`
		});
		expect(listInvites(null).map((invite) => invite.email)).toEqual(['pat@example.com']);
		const email = sentEmail();
		expect(email).toMatchObject({
			from: 'Meals <noreply@boyersoftware.com>',
			to: 'pat@example.com',
			subject: "You're invited to start a household on Meals"
		});
		expect(email.text).toContain(
			"To start it, sign in with Google using pat@example.com. Meals then asks for your household's name"
		);
		expect(email.html).toContain('<a href="http://localhost/login">Sign in to Meals</a>');
	});

	it('go out though a household invited the same address (MEA-112)', async () => {
		db()
			.insert(invites)
			.values({ email: 'pat@example.com', householdId: makeHousehold().householdId, createdAt: 0 })
			.run();
		expect(await post('invite', { email: 'pat@example.com' })).toEqual({
			action: 'invite',
			message: `Invited pat@example.com to start a household. ${INVITE_SENT}`
		});
		expect(sentEmail().subject).toBe("You're invited to start a household on Meals");
	});

	it('are not sent for an invite that is refused', async () => {
		db()
			.insert(users)
			.values({
				householdId: makeHousehold().householdId,
				googleSub: 'sub-sam',
				email: 'sam@example.com',
				name: 'Sam',
				createdAt: 0
			})
			.run();
		inviteFor('kim@example.com');
		expect(await post('invite', { email: '' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'Enter an email address' }
		});
		expect(await post('invite', { email: 'sam@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'sam@example.com already has a Meals account.' }
		});
		expect(await post('invite', { email: 'kim@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'You already invited kim@example.com to start a household.' }
		});
		for (let i = 1; i < INVITE_LIMIT; i += 1) inviteFor(`guest-${i}@example.com`);
		expect(await post('invite', { email: 'one-more@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: expect.stringContaining('20 invites to start a household') }
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('are not sent when an invite is cancelled', async () => {
		inviteFor('pat@example.com');
		const [invite] = listInvites(null);
		expect(await post('cancelInvite', { id: String(invite!.id) })).toBeUndefined();
		expect(listInvites(null)).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keep the invite when the email fails, say so, and log why without key or address', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refusal = {
			statusCode: 403,
			message: 'The domain is not verified.',
			name: 'validation_error'
		};
		fetch.mockResolvedValueOnce(Response.json(refusal, { status: 403 }));
		// Not a failure, so the page shows the invite saved and clears the field.
		expect(await post('invite', { email: 'pat@example.com' })).toEqual({
			action: 'invite',
			error: `Invited pat@example.com to start a household, but ${INVITE_NOT_SENT}`
		});
		expect(listInvites(null).map((invite) => invite.email)).toEqual(['pat@example.com']);
		const log = logged(consoleError);
		expect(log).toContain('The invite email to start a household was not sent');
		expect(log).toContain('403');
		expect(log).toContain('The domain is not verified.');
		expect(log).not.toContain('resend-key');
		expect(log).not.toContain('pat@example.com');
	});

	it('are not found for anyone but the admin, and send nothing', async () => {
		const member = { ...admin, id: 2, email: 'pat@example.com', name: 'Pat', isAdmin: false };
		expect(await post('invite', { email: 'kim@example.com' }, member)).toMatchObject({
			status: 404
		});
		expect(await post('invite', { email: 'kim@example.com' }, null)).toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(listInvites(null)).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});
});
