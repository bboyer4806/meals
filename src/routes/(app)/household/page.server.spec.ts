import { format } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { INVITE_LIMIT, listInvites } from '#lib/server/data/households.ts';
import { db } from '#lib/server/db/index.ts';
import { households, invites, users } from '#lib/server/db/schema.ts';
import { freshDb, makeHousehold, TEST_ENV } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const SENT = 'An invite email was sent to them.';
const NOT_SENT =
	"the invite email couldn't be sent. Tell them to sign in with that Google account.";

let householdId: number;
let userId: number;
let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	db().update(households).set({ name: 'The Smiths' }).where(eq(households.id, householdId)).run();
	// Resend accepts the email.
	fetch = vi.fn(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68' }));
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** The signed-in person: a member of the household, someone still in setup, or nobody. */
function locals(as: 'member' | 'setup' | 'nobody') {
	if (as === 'nobody') return { user: null };
	const user = { id: userId, email: 'a@example.com', name: 'A', isAdmin: false };
	return { user: { ...user, householdId: as === 'member' ? householdId : null } };
}

type Action = keyof typeof actions;

/** Posts a form to /household, giving what the action returned or what it threw. */
async function post(
	action: Action,
	fields: Record<string, string>,
	as: 'member' | 'setup' | 'nobody' = 'member'
): Promise<unknown> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const url = new URL(`http://localhost/household?/${action}`);
	const request = new Request(url, { method: 'POST', body });
	const event = { locals: locals(as), request, url } as unknown as Parameters<
		(typeof actions)[Action]
	>[0];
	try {
		return await actions[action](event);
	} catch (e) {
		return e;
	}
}

/** Each email Resend was asked to send, in the order asked. */
function sent(): { from: string; to: string; subject: string; html: string; text: string }[] {
	return fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string));
}

function inviteFor(email: string, inHousehold: number | null): void {
	db().insert(invites).values({ email, householdId: inHousehold, createdAt: 0 }).run();
}

describe('invite emails (6.1, MEA-26)', () => {
	it('email a new invite to the address entered, naming the household, and say it was sent', async () => {
		expect(await post('invite', { email: ' Pat@Example.com ' })).toEqual({
			action: 'invite',
			message: `Invited pat@example.com. ${SENT}`
		});
		expect(listInvites(householdId).map((invite) => invite.email)).toEqual(['pat@example.com']);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
		expect(sent()).toEqual([
			{
				from: 'Meals <noreply@boyersoftware.com>',
				to: 'pat@example.com',
				subject: "You're invited to join The Smiths on Meals",
				html: expect.stringContaining('<a href="http://localhost/login">Sign in to Meals</a>'),
				text: expect.stringContaining('To join, sign in with Google using pat@example.com.')
			}
		]);
	});

	it('go out though another household invited the same address, naming this one (MEA-112)', async () => {
		const other = makeHousehold();
		inviteFor('pat@example.com', other.householdId);
		expect(await post('invite', { email: 'pat@example.com' })).toEqual({
			action: 'invite',
			message: `Invited pat@example.com. ${SENT}`
		});
		expect(sent().map((email) => email.subject)).toEqual([
			"You're invited to join The Smiths on Meals"
		]);
		expect(listInvites(other.householdId)).toHaveLength(1);
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
		inviteFor('kim@example.com', householdId);
		expect(await post('invite', { email: 'not an email' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'Enter an email address' }
		});
		expect(await post('invite', { email: 'sam@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'sam@example.com already has a Meals account.' }
		});
		// The same invite again, in any case.
		expect(await post('invite', { email: 'KIM@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: 'Your household already invited kim@example.com.' }
		});
		for (let i = 1; i < INVITE_LIMIT; i += 1) inviteFor(`guest-${i}@example.com`, householdId);
		expect(await post('invite', { email: 'one-more@example.com' })).toMatchObject({
			status: 400,
			data: { action: 'invite', error: expect.stringContaining('20 invites waiting') }
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(listInvites(householdId)).toHaveLength(INVITE_LIMIT);
	});

	it('are not sent when an invite is cancelled', async () => {
		inviteFor('pat@example.com', householdId);
		const [invite] = listInvites(householdId);
		expect(await post('cancelInvite', { id: String(invite!.id) })).toBeUndefined();
		expect(listInvites(householdId)).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keep the invite when Resend refuses the email, say so, and log why without key or address', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refusal = { statusCode: 401, message: 'API key is invalid', name: 'validation_error' };
		fetch.mockResolvedValueOnce(Response.json(refusal, { status: 401 }));
		// Not a failure, so the page shows the invite saved and clears the field.
		expect(await post('invite', { email: 'pat@example.com' })).toEqual({
			action: 'invite',
			error: `Invited pat@example.com, but ${NOT_SENT}`
		});
		expect(listInvites(householdId).map((invite) => invite.email)).toEqual(['pat@example.com']);
		expect(consoleError).toHaveBeenCalledTimes(1);
		const log = format(...consoleError.mock.calls[0]!);
		expect(log).toContain(`The invite email for household ${householdId} was not sent`);
		expect(log).toContain('401');
		expect(log).toContain('API key is invalid');
		expect(log).not.toContain('resend-key');
		expect(log).not.toContain('pat@example.com');
	});

	it("keep the invite when Resend doesn't answer in time", async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
			AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'))
		);
		fetch.mockImplementationOnce(async (_url, init) => {
			init.signal?.throwIfAborted();
			return new Promise<Response>(() => {});
		});
		expect(await post('invite', { email: 'pat@example.com' })).toEqual({
			action: 'invite',
			error: `Invited pat@example.com, but ${NOT_SENT}`
		});
		expect(listInvites(householdId)).toHaveLength(1);
		expect(format(...consoleError.mock.calls[0]!)).toContain('Timed out');
	});

	it('are sent by members only, and invite to their own household', async () => {
		expect(await post('invite', { email: 'pat@example.com' }, 'nobody')).toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(await post('invite', { email: 'pat@example.com' }, 'setup')).toMatchObject({
			status: 303,
			location: '/setup'
		});
		expect(fetch).not.toHaveBeenCalled();
		const other = makeHousehold();
		await post('invite', { email: 'pat@example.com', householdId: String(other.householdId) });
		expect(listInvites(householdId)).toHaveLength(1);
		expect(listInvites(other.householdId)).toEqual([]);
	});
});
