import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { TEST_ENV, freshDb, makeHousehold } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

let householdId: number;
let fetch: ReturnType<typeof vi.fn>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
	fetch = vi.fn(async () => Response.json({ key: 'MEA-99' }, { status: 201 }));
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Sends the feedback form as the household's member, giving the action's result. */
function send(fields: Record<string, string>) {
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
	const init = fetch.mock.calls[0]![1] as RequestInit;
	return JSON.stringify(JSON.parse(init.body as string).fields.description);
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
