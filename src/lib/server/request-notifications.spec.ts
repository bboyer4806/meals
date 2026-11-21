import { format } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import type { NewRequest } from './data/requests.ts';
import { db } from './db/index.ts';
import { users } from './db/schema.ts';
import { notifyRequest } from './request-notifications.ts';
import { freshDb, makeHousehold, TEST_ENV } from './testing.ts';

const ORIGIN = 'https://meals.example.com';

let householdId: number;
let userId: number;
let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	freshDb();
	// The household's member, Person 1 or the like, named Person (6.1), asks.
	({ householdId, userId } = makeHousehold());
	// Resend accepts each email.
	fetch = vi.fn(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68' }));
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Another member of the household, or of `inHousehold`, with the email `<key>@example.com`. */
function addMember(key: string, name: string, inHousehold = householdId): number {
	return db()
		.insert(users)
		.values({
			householdId: inHousehold,
			googleSub: `sub-${key}`,
			email: `${key}@example.com`,
			name,
			createdAt: 0
		})
		.returning({ id: users.id })
		.get().id;
}

/** The member's email, as Google gave it. */
function emailOf(memberId: number): string {
	return db().select({ email: users.email }).from(users).where(eq(users.id, memberId)).get()!.email;
}

function dish(name: string, note: string | null = null, asker = userId): NewRequest {
	return { kind: 'dish', name, note, userId: asker };
}

/** Each email Resend was asked to send, in the order asked. */
function sent(): { to: string; subject: string; html: string; text: string }[] {
	return fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string));
}

describe('notifyRequest (6.12, MEA-254)', () => {
	it("emails each of the household's other members, never the asker or another household", async () => {
		addMember('sam', 'Sam');
		addMember('robin', 'Robin Lee');
		const other = makeHousehold();
		addMember('kim', 'Kim', other.householdId);
		await notifyRequest(householdId, dish('Lasagna'), ORIGIN);
		expect(sent().map((email) => email.to)).toEqual(['robin@example.com', 'sam@example.com']);
		// Each has the same email of their own, from Meals.
		expect(fetch.mock.calls.every(([url]) => url === 'https://api.resend.com/emails')).toBe(true);
		const [robin, sam] = sent();
		expect({ ...robin, to: '' }).toEqual({ ...sam, to: '' });
		expect(sam).toMatchObject({ from: 'Meals <noreply@boyersoftware.com>' });
	});

	it('says who asked for which dish, with its note and a link to the Menu', async () => {
		addMember('sam', 'Sam');
		await notifyRequest(householdId, dish('Lasagna', 'Extra cheese'), ORIGIN);
		expect(sent()).toEqual([
			{
				from: 'Meals <noreply@boyersoftware.com>',
				to: 'sam@example.com',
				subject: 'Person requested a dish: Lasagna',
				html: [
					'<p>Person requested a dish: <strong>Lasagna</strong></p>',
					'<p>Note: Extra cheese</p>',
					'<p><a href="https://meals.example.com/menu">See it on the Menu</a></p>'
				].join('\n'),
				text: [
					'Person requested a dish: Lasagna',
					'Note: Extra cheese',
					'',
					'See it on the Menu: https://meals.example.com/menu'
				].join('\n')
			}
		]);
	});

	it('says a restaurant request is for a restaurant, and leaves out a note it lacks', async () => {
		const sam = addMember('sam', 'Sam');
		addMember('robin', 'Robin');
		const restaurant: NewRequest = {
			kind: 'restaurant',
			name: 'Olive Garden',
			note: null,
			userId: sam
		};
		await notifyRequest(householdId, restaurant, 'http://localhost:5173');
		expect(sent()).toEqual([
			expect.objectContaining({
				to: emailOf(userId),
				subject: 'Sam requested a restaurant: Olive Garden',
				html: [
					'<p>Sam requested a restaurant: <strong>Olive Garden</strong></p>',
					'<p><a href="http://localhost:5173/menu">See it on the Menu</a></p>'
				].join('\n'),
				text: [
					'Sam requested a restaurant: Olive Garden',
					'',
					'See it on the Menu: http://localhost:5173/menu'
				].join('\n')
			}),
			expect.objectContaining({ to: 'robin@example.com' })
		]);
	});

	it('names the asker by whole name while another member has the same first name (6.1)', async () => {
		const samLee = addMember('sam-lee', 'Sam Lee');
		addMember('sam-wu', 'sam Wu');
		await notifyRequest(householdId, dish('Lasagna', null, samLee), ORIGIN);
		expect(sent().map((email) => email.subject)).toEqual([
			'Sam Lee requested a dish: Lasagna',
			'Sam Lee requested a dish: Lasagna'
		]);
	});

	it('shows names and notes as typed, so they never change the HTML', async () => {
		const asker = addMember('tag', '<i>Tag</i>');
		await notifyRequest(householdId, dish('<b>Tea</b> & "cake"', "Kim's <br> pick", asker), ORIGIN);
		const [email] = sent();
		expect(email?.html).toBe(
			[
				'<p>&lt;i&gt;Tag&lt;/i&gt; requested a dish: ' +
					'<strong>&lt;b&gt;Tea&lt;/b&gt; &amp; &quot;cake&quot;</strong></p>',
				'<p>Note: Kim&#39;s &lt;br&gt; pick</p>',
				'<p><a href="https://meals.example.com/menu">See it on the Menu</a></p>'
			].join('\n')
		);
		expect(email?.subject).toBe('<i>Tag</i> requested a dish: <b>Tea</b> & "cake"');
		expect(email?.text).toContain("Note: Kim's <br> pick");
	});

	it('sends nothing when nobody else is in the household', async () => {
		await notifyRequest(householdId, dish('Lasagna'), ORIGIN);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("still emails the others when one member's email fails, and logs why, without key or address", async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const robin = addMember('robin', 'Robin');
		const sam = addMember('sam', 'Sam');
		addMember('kim', 'Kim');
		const refusal = { statusCode: 422, message: 'Invalid `to` field.', name: 'validation_error' };
		fetch.mockImplementation(async (_url, init) => {
			const { to } = JSON.parse(init.body as string);
			if (to === 'robin@example.com') return Response.json(refusal, { status: 422 });
			if (to === 'sam@example.com') throw new TypeError('fetch failed');
			return Response.json({ id: '49a3999c-0ce1-4ea6-ab68' });
		});
		await expect(notifyRequest(householdId, dish('Lasagna'), ORIGIN)).resolves.toBeUndefined();
		// All three were asked for; Kim's was accepted.
		expect(sent().map((email) => email.to)).toEqual([
			'kim@example.com',
			'robin@example.com',
			'sam@example.com'
		]);
		expect(consoleError).toHaveBeenCalledTimes(2);
		const logs = consoleError.mock.calls.map((call) => format(...call));
		// Each failure is logged as it happens, in no particular order.
		const logFor = (memberId: number) =>
			logs.find((log) => log.includes(`The request email to member ${memberId} was not sent`));
		expect(logFor(robin)).toContain('422');
		expect(logFor(robin)).toContain('Invalid `to` field.');
		expect(logFor(sam)).toContain('fetch failed');
		for (const log of logs) {
			expect(log).not.toContain('resend-key');
			expect(log).not.toContain('@example.com');
		}
	});
});
