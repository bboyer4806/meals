// Helpers for data tests. Only test files import this.
import { isHttpError } from '@sveltejs/kit';
import { expect } from 'vitest';
import { db, openDb } from './db/index.ts';
import { households, stores, users } from './db/schema.ts';

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

export function expectHttpError(run: () => unknown, status: number): void {
	try {
		run();
	} catch (e) {
		expect(isHttpError(e, status), `expected HTTP ${status}, got ${String(e)}`).toBe(true);
		return;
	}
	expect.fail(`expected HTTP ${status}, but nothing was thrown`);
}
