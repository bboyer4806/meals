import { format } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '#lib/server/config.ts';
import { setDishArchived } from '#lib/server/data/dishes.ts';
import { addRequest, listRequests } from '#lib/server/data/requests.ts';
import { db } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { freshDb, makeDish, makeHousehold, recipe, TEST_ENV } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const NOW = Date.UTC(2026, 9, 7, 17, 0);

let householdId: number;
let userId: number;
let sam: number;
let lasagna: number;
let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

beforeAll(() => {
	loadConfig({ ...TEST_ENV, DATA_DIR: '/tmp' });
});

beforeEach(() => {
	freshDb();
	// The household's member, Person 1 or the like, named Person (6.1), taps Request.
	({ householdId, userId } = makeHousehold());
	sam = db()
		.insert(users)
		.values({
			householdId,
			googleSub: 'sub-sam',
			email: 'sam@example.com',
			name: 'Sam',
			createdAt: 0
		})
		.returning({ id: users.id })
		.get().id;
	lasagna = makeDish(householdId, recipe('Lasagna'));
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
	// Resend accepts each email.
	fetch = vi.fn(async () => Response.json({ id: '49a3999c-0ce1-4ea6-ab68' }));
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Taps Request on the recipe's page, giving what the action returned or what it threw. */
async function tapRequest(dishId = lasagna): Promise<unknown> {
	const url = new URL(`http://localhost/recipes/${dishId}?/request`);
	const request = new Request(url, { method: 'POST', body: new FormData() });
	const user = { id: userId, householdId, email: 'a@example.com', name: 'A', isAdmin: false };
	const event = { locals: { user }, params: { id: String(dishId) }, request, url };
	try {
		return await actions.request(event as unknown as Parameters<typeof actions.request>[0]);
	} catch (e) {
		return e;
	}
}

/** Each email Resend was asked to send, in the order asked. */
function sent(): { to: string; subject: string; text: string }[] {
	return fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string));
}

describe('Request (6.12, MEA-254)', () => {
	it('requests the recipe and emails the rest of the household about it', async () => {
		expect(await tapRequest()).toBeUndefined();
		expect(listRequests(householdId)).toMatchObject([
			{ kind: 'dish', name: 'Lasagna', note: null, dishId: lasagna }
		]);
		expect(sent()).toEqual([
			expect.objectContaining({
				to: 'sam@example.com',
				subject: 'Person requested a dish: Lasagna',
				text: 'Person requested a dish: Lasagna\n\nSee it on the Menu: http://localhost/menu'
			})
		]);
	});

	it('adds nothing and emails nobody when someone requested the recipe first', async () => {
		addRequest(householdId, sam, { name: 'Lasagna', note: null }, NOW);
		expect(await tapRequest()).toBeUndefined();
		expect(listRequests(householdId)).toHaveLength(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('emails nobody when it refuses a recipe archived since the page loaded', async () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(await tapRequest()).toMatchObject({
			status: 400,
			data: { action: 'request', error: 'Restore Lasagna before requesting it' }
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("emails nobody for another household's recipe, which isn't found", async () => {
		const other = makeHousehold();
		const curry = makeDish(other.householdId, recipe('Curry'));
		expect(await tapRequest(curry)).toMatchObject({ status: 404 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("still saves the request when its email can't be sent, and logs why", async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		fetch.mockRejectedValue(new TypeError('fetch failed'));
		expect(await tapRequest()).toBeUndefined();
		expect(listRequests(householdId)).toMatchObject([{ name: 'Lasagna' }]);
		expect(consoleError).toHaveBeenCalledTimes(1);
		expect(format(...consoleError.mock.calls[0]!)).toContain(
			`The request email to member ${sam} was not sent`
		);
	});
});
