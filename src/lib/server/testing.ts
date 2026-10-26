// Helpers for data tests. Only test files import this.
import { EventEmitter } from 'node:events';
import http, { type ClientRequest, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isHttpError } from '@sveltejs/kit';
import { expect, vi } from 'vitest';
import type { DinnerType, DishRole } from '../menu.ts';
import { createDish, type DishInput, type IngredientInput } from './data/dishes.ts';
import { db, openDb } from './db/index.ts';
import { dinnerDishes, dinners, households, stores, users } from './db/schema.ts';

/** Settings for loadConfig, with DATA_DIR to fill in. */
export const TEST_ENV = {
	GOOGLE_CLIENT_ID: 'client-id',
	GOOGLE_CLIENT_SECRET: 'client-secret',
	ADMIN_EMAIL: 'admin@example.com',
	JIRA_URL: 'https://jira.example.com',
	JIRA_EMAIL: 'feedback@example.com',
	JIRA_API_TOKEN: 'jira-token'
};

export function freshDb(): void {
	openDb(':memory:');
}

let counter = 0;

export function makeHousehold(timeZone = 'America/Chicago'): { householdId: number; userId: number } {
	counter += 1;
	const household = db()
		.insert(households)
		.values({ name: `Household ${counter}`, defaultServings: 4, timeZone, createdAt: 0 })
		.returning({ id: households.id })
		.get();
	const user = db()
		.insert(users)
		.values({
			householdId: household.id,
			googleSub: `sub-${counter}`,
			email: `person${counter}@example.com`,
			name: `Person ${counter}`,
			createdAt: 0
		})
		.returning({ id: users.id })
		.get();
	return { householdId: household.id, userId: user.id };
}

export function makeStore(householdId: number, name: string): number {
	return db().insert(stores).values({ householdId, name }).returning({ id: stores.id }).get().id;
}

/** A recipe with only the fields a test cares about. */
export function recipe(name: string, fields: Partial<DishInput> = {}): DishInput {
	return {
		name,
		servings: 4,
		prepMinutes: null,
		cookMinutes: null,
		steps: null,
		notes: null,
		source: null,
		calories: null,
		proteinG: null,
		carbsG: null,
		fatG: null,
		tags: [],
		ingredients: [],
		...fields
	};
}

/** An ingredient row, such as ingredient('Flour', 2, 'cup'). */
export function ingredient(
	itemName: string,
	amount: number | null = null,
	unit: string | null = null,
	fields: Partial<IngredientInput> = {}
): IngredientInput {
	return { section: null, amount, unit, itemName, prepNote: null, ...fields };
}

/** Saves a recipe, without restoring archived items, and returns its id. */
export function makeDish(householdId: number, input: DishInput, now = 0): number {
	const result = createDish(householdId, input, [], now);
	if (result.kind !== 'saved') throw new Error(`Couldn't save ${input.name}: ${result.kind}`);
	return result.id;
}

/**
 * A dinner written straight to the database, so a test can set up any menu (past dates,
 * archived dishes). Dishes are [dishId, role] in the order they were added. Returns its id.
 */
export function makeDinner(
	householdId: number,
	date: string,
	fields: {
		type?: DinnerType;
		note?: string | null;
		servings?: number;
		dishes?: [dishId: number, role: DishRole][];
	} = {},
	now = 0
): number {
	const dinnerId = db()
		.insert(dinners)
		.values({
			householdId,
			date,
			type: fields.type ?? 'cook',
			note: fields.note ?? null,
			servings: fields.servings ?? 4,
			createdAt: now,
			updatedAt: now
		})
		.returning({ id: dinners.id })
		.get().id;
	for (const [dishId, role] of fields.dishes ?? []) {
		db().insert(dinnerDishes).values({ householdId, dinnerId, dishId, role }).run();
	}
	return dinnerId;
}

export function expectHttpError(run: () => unknown, status: number): void {
	try {
		run();
	} catch (e) {
		expect(isHttpError(e, status), `expected HTTP ${status}, got ${String(e)}`).toBe(true);
		return;
	}
	expect.fail(`expected HTTP ${status}, but nothing was thrown`);
}

/** How a web page answers a GET, for servePages. */
export type PageAnswer = {
	status: number;
	headers?: Record<string, string>;
	body?: string | Buffer;
};

/**
 * Answers GETs of these links in place of the network (recipe-page.ts), and gives the links
 * asked for, in order. A link to localhost gets the real request, which refuses it as it
 * connects; any other link fails. vi.restoreAllMocks() puts the network back.
 */
export function servePages(pages: Record<string, PageAnswer>): string[] {
	const requested: string[] = [];
	type Answered = (response: IncomingMessage) => void;

	/** The page's answer, or null for a request to localhost. */
	function answer(url: URL, answered: Answered): ClientRequest | null {
		requested.push(url.href);
		const page = pages[url.href];
		if (!page) {
			if (url.hostname === 'localhost') return null;
			throw new Error(`No page for ${url.href}`);
		}
		const response = Object.assign(Readable.from([Buffer.from(page.body ?? '')]), {
			statusCode: page.status,
			headers: page.headers ?? {}
		});
		process.nextTick(answered, response);
		return new EventEmitter() as ClientRequest;
	}

	const { get: httpGet } = http;
	const { get: httpsGet } = https;
	vi.spyOn(http, 'get').mockImplementation(((
		url: URL,
		options: http.RequestOptions,
		answered: Answered
	) => answer(url, answered) ?? httpGet(url, options, answered)) as typeof http.get);
	vi.spyOn(https, 'get').mockImplementation(((
		url: URL,
		options: https.RequestOptions,
		answered: Answered
	) => answer(url, answered) ?? httpsGet(url, options, answered)) as typeof https.get);
	return requested;
}
