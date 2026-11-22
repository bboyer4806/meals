import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createSession, type SessionUser } from '#lib/server/auth/session.ts';
import { loadConfig } from '#lib/server/config.ts';
import { listDishes } from '#lib/server/data/dishes.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listCatalog } from '#lib/server/data/items.ts';
import { openDb } from '#lib/server/db/index.ts';
import { TEST_ENV, freshDb, makeHousehold } from '#lib/server/testing.ts';
import { handle, handleError, init } from './hooks.server.ts';

// Real files unless a test says otherwise.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return { ...fs, accessSync: vi.fn(fs.accessSync), existsSync: vi.fn(fs.existsSync) };
});

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'meals-start-'));
});

function useEnv() {
	for (const [name, value] of Object.entries({ ...TEST_ENV, DATA_DIR: dataDir })) {
		vi.stubEnv(name, value);
	}
}

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dataDir, { recursive: true, force: true });
});

it('gives older households the standard items and default dishes, with their photos', async () => {
	// A household set up before them, which the migrations leave without them.
	openDb(join(dataDir, 'meals.db'));
	const { householdId } = makeHousehold();
	useEnv();
	const recipes = () =>
		listDishes(householdId, { search: '', tags: [], archived: false, sort: 'name' });

	await init();

	// 6.13 and 6.14.
	const catalog = listCatalog(householdId, false, '');
	expect(catalog).toHaveLength(288);
	expect(getHousehold(householdId).standardItemsAddedAt).not.toBeNull();
	const keys = new Set(catalog.map((item) => item.photoKey));
	expect(keys.size).toBe(288);
	expect(keys.has(null)).toBe(false);
	// 6.18 and 6.19.
	const dishes = recipes();
	expect(dishes).toHaveLength(80);
	// Each but Sloppy Joes with a photo of its own.
	const withoutPhoto = dishes.filter((dish) => dish.photoKey === null);
	expect(withoutPhoto.map((dish) => dish.name)).toEqual(['Sloppy Joes']);
	expect(new Set(dishes.map((dish) => dish.photoKey)).size).toBe(80);
	expect(getHousehold(householdId).defaultDishPhotosAddedAt).not.toBeNull();
	// Two files for each image and photo.
	expect(readdirSync(join(dataDir, 'photos'))).toHaveLength(734);

	// Starting again adds nothing.
	await init();
	expect(readdirSync(join(dataDir, 'photos'))).toHaveLength(734);
	expect(recipes()).toHaveLength(80);
});

it("doesn't start without the standard images, as when they weren't packaged with the app", async () => {
	useEnv();
	const exists = vi.mocked(existsSync).getMockImplementation()!;
	const missing = join('standard-images', 'salt.jpg');
	vi.mocked(existsSync).mockImplementation((path) => path !== missing && exists(path));

	try {
		await expect(init()).rejects.toThrow(`The standard image ${missing} is missing`);
		// Before it opens the database.
		expect(readdirSync(dataDir)).toEqual([]);
	} finally {
		vi.mocked(existsSync).mockImplementation(exists);
	}
});

it("doesn't start without the default dishes' photos, as when they weren't packaged", async () => {
	useEnv();
	const exists = vi.mocked(existsSync).getMockImplementation()!;
	const missing = join('default-dish-photos', 'pizza.jpg');
	vi.mocked(existsSync).mockImplementation((path) => path !== missing && exists(path));

	try {
		await expect(init()).rejects.toThrow(`The default dish photo ${missing} is missing`);
		// Before it opens the database.
		expect(readdirSync(dataDir)).toEqual([]);
	} finally {
		vi.mocked(existsSync).mockImplementation(exists);
	}
});

it("doesn't start when it can't write its data, as when a restore left it owned by root", async () => {
	// The database and the photos folder from an earlier start.
	const database = join(dataDir, 'meals.db');
	const photos = join(dataDir, 'photos');
	writeFileSync(database, '');
	mkdirSync(photos);
	useEnv();
	// Root can write anything, and tests may run as root, so this stands in for the refusal the
	// app's node user gets.
	const access = vi.mocked(accessSync).getMockImplementation()!;

	try {
		for (const path of [dataDir, database, photos]) {
			vi.mocked(accessSync).mockImplementation((tried, mode) => {
				if (tried === path && mode === constants.W_OK) throw new Error('EACCES');
				access(tried, mode);
			});
			// 4.3.
			await expect(init()).rejects.toThrow(`${path} is not writable`);
			// Before it opens the database.
			expect(readdirSync(dataDir).sort()).toEqual(['meals.db', 'photos']);
		}
	} finally {
		vi.mocked(accessSync).mockImplementation(access);
	}
});

it('over https, takes the session only from the __Host-session cookie (MEA-83)', async () => {
	freshDb();
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
	const { userId } = makeHousehold();
	const { token } = createSession(userId, Date.now());
	const url = new URL('https://meals.dev.boyersoftware.com/groceries');
	const signedIn = async (stored: Record<string, string>) => {
		const event = {
			request: new Request(url),
			route: { id: '/(app)/groceries' },
			url,
			cookies: { get: (name: string) => stored[name], set: vi.fn(), delete: vi.fn() },
			locals: {} as App.Locals
		};
		const input = { event, resolve: async () => new Response() };
		await handle(input as unknown as Parameters<typeof handle>[0]);
		return event.locals.user;
	};

	// Another dev.boyersoftware.com app can set a cookie with the plain name for Meals.
	expect(await signedIn({ session: token })).toBeNull();
	expect(await signedIn({ '__Host-session': token })).toMatchObject({ id: userId });
});

describe('handleError (design 4.5, MEA-118)', () => {
	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
	const robin: SessionUser = {
		id: 7,
		householdId: 3,
		email: 'robin@example.com',
		name: 'Robin',
		isAdmin: false
	};
	let logged: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-22T15:04:05.123Z'));
		logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		logged.mockRestore();
		vi.useRealTimers();
	});

	/** The parts of a request's event that handleError reads, as SvelteKit makes them. */
	function eventFor(request: Request, routeId: string | null, locals: Partial<App.Locals>) {
		const event = { request, url: new URL(request.url), route: { id: routeId }, locals };
		return event as unknown as RequestEvent;
	}

	/** Everything one console.error call logged. */
	function log(call = 0): string {
		const args = logged.mock.calls[call];
		if (!args) throw new Error(`Nothing was logged for call ${call}`);
		return args.join(' ');
	}

	it('logs an unexpected error with an id, and gives the error page only that id', async () => {
		// A request with what must stay out of the log: a sign-in code in the query, the session
		// cookie, an access token and a form.
		const request = new Request(
			'https://meals.dev.boyersoftware.com/recipes/12/edit?code=sign-in-code',
			{
				method: 'POST',
				headers: { cookie: '__Host-session=session-token', authorization: 'Bearer access-token' },
				body: 'name=Pumpkin+pie'
			}
		);
		const thrown = new Error('database disk image is malformed', {
			cause: new Error('SQLITE_CORRUPT')
		});

		const result = await handleError({
			kind: 'unknown',
			error: thrown,
			event: eventFor(request, '/(app)/recipes/[id]/edit', { user: robin })
		});

		expect(logged).toHaveBeenCalledOnce();
		const [context, ...details] = log().split('\n');
		const id = /^Unexpected error (\S+) /.exec(context!)?.[1];
		expect(id).toMatch(UUID);
		expect(context).toBe(
			`Unexpected error ${id} time=2026-11-22T15:04:05.123Z method=POST path=/recipes/12/edit` +
				' route=/(app)/recipes/[id]/edit status=500 user=7 household=3'
		);
		// The error's message and stack, and its cause's.
		const stack = details.join('\n');
		expect(stack).toMatch(
			/^Error: database disk image is malformed\n\s+at .*hooks\.server\.spec\.ts/
		);
		expect(stack).toContain('[cause]: Error: SQLITE_CORRUPT');
		const leftOut = /robin@example\.com|sign-in-code|session-token|access-token|Pumpkin/;
		expect(log()).not.toMatch(leftOut);
		// The id the log has, and nothing from the error: SvelteKit adds "Internal Error".
		expect(result).toEqual({ status: 500, id });
	});

	it('gives each unexpected error its own id', async () => {
		const request = new Request('https://meals.dev.boyersoftware.com/menu');
		const event = eventFor(request, '/(app)/menu', { user: robin });

		const first = await handleError({ kind: 'unknown', error: new Error('One'), event });
		const second = await handleError({ kind: 'unknown', error: new Error('Two'), event });

		expect(first).toEqual({ status: 500, id: expect.stringMatching(UUID) });
		expect(second).toEqual({ status: 500, id: expect.stringMatching(UUID) });
		expect(second).not.toEqual(first);
	});

	it('logs an unexpected error without a household or a session, or before handle reads it', async () => {
		const request = new Request('https://meals.dev.boyersoftware.com/nowhere');
		const cases: [Partial<App.Locals>, string][] = [
			// Signed in, but not yet in a household (6.1).
			[{ user: { ...robin, householdId: null } }, 'user=7 household=none'],
			// Not signed in.
			[{ user: null }, 'user=none household=none'],
			// Before handle reads the session, when locals has no user yet.
			[{}, 'user=none household=none']
		];

		for (const [index, [locals, who]] of cases.entries()) {
			const result = await handleError({
				kind: 'unknown',
				error: new Error('Boom'),
				event: eventFor(request, null, locals)
			});

			expect(result).toEqual({ status: 500, id: expect.stringMatching(UUID) });
			expect(log(index).split('\n')[0]).toMatch(
				new RegExp(` method=GET path=/nowhere route=none status=500 ${who}$`)
			);
		}
	});

	it('leaves errors Meals expects as SvelteKit has them, with no id and no log', async () => {
		const event = eventFor(
			new Request('https://meals.dev.boyersoftware.com/recipes/999999'),
			'/(app)/recipes/[id]',
			{ user: robin }
		);

		// Thrown with error(), and SvelteKit's own for an address that matches no page.
		for (const status of [400, 403, 404]) {
			const error = { status, message: 'A message for people' };
			expect(await handleError({ kind: 'app', error, event })).toBeUndefined();
		}
		const notFound = { status: 404, message: 'Not Found' };
		expect(await handleError({ kind: 'framework', error: notFound, event })).toBeUndefined();
		expect(logged).not.toHaveBeenCalled();
	});
});
