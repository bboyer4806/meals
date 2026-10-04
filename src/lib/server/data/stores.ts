import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { stores } from '../db/schema.ts';

export type Store = { id: number; name: string; archivedAt: number | null };

/** Every store in the household, archived ones included, sorted by name. */
export function listStores(householdId: number): Store[] {
	return db()
		.select({ id: stores.id, name: stores.name, archivedAt: stores.archivedAt })
		.from(stores)
		.where(eq(stores.householdId, householdId))
		.orderBy(asc(sql`lower(${stores.name})`))
		.all();
}

export function getStore(householdId: number, storeId: number): Store {
	const store = db()
		.select({ id: stores.id, name: stores.name, archivedAt: stores.archivedAt })
		.from(stores)
		.where(and(eq(stores.id, storeId), eq(stores.householdId, householdId)))
		.get();
	if (!store) error(404, 'Not found');
	return store;
}

/** For assigning a store to a line: it must be in the household and not archived. */
export function requireActiveStore(householdId: number, storeId: number): Store {
	const store = getStore(householdId, storeId);
	if (store.archivedAt !== null) error(400, `${store.name} is archived`);
	return store;
}

function findByName(householdId: number, name: string): Store | undefined {
	return db()
		.select({ id: stores.id, name: stores.name, archivedAt: stores.archivedAt })
		.from(stores)
		.where(and(eq(stores.householdId, householdId), sql`fold(${stores.name}) = fold(${name})`))
		.get();
}

export type StoreNameResult = { kind: 'saved' } | { kind: 'taken'; archived: boolean };

export function createStore(householdId: number, name: string): StoreNameResult {
	const existing = findByName(householdId, name);
	if (existing) return { kind: 'taken', archived: existing.archivedAt !== null };
	db().insert(stores).values({ householdId, name }).run();
	return { kind: 'saved' };
}

export function renameStore(householdId: number, storeId: number, name: string): StoreNameResult {
	getStore(householdId, storeId);
	const existing = findByName(householdId, name);
	if (existing && existing.id !== storeId) {
		return { kind: 'taken', archived: existing.archivedAt !== null };
	}
	db().update(stores).set({ name }).where(eq(stores.id, storeId)).run();
	return { kind: 'saved' };
}

export function setStoreArchived(
	householdId: number,
	storeId: number,
	archived: boolean,
	now: number
): void {
	getStore(householdId, storeId);
	db()
		.update(stores)
		.set({ archivedAt: archived ? now : null })
		.where(eq(stores.id, storeId))
		.run();
}
