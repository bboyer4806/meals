// Helpers for data tests. Only test files import this.
import { isHttpError } from '@sveltejs/kit';
import { expect } from 'vitest';
import { createDish, type DishInput, type IngredientInput } from './data/dishes.ts';
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

/** Saves a recipe and returns its id. */
export function makeDish(householdId: number, input: DishInput, now = 0): number {
	const result = createDish(householdId, input, now);
	if (result.kind !== 'saved') throw new Error(`A dish is already called ${input.name}`);
	return result.id;
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
