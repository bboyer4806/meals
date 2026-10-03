import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { groceryNeeds, items, stores } from '../db/schema.ts';

export type Item = {
	id: number;
	name: string;
	notes: string | null;
	defaultStoreId: number | null;
	archivedAt: number | null;
};

const itemFields = {
	id: items.id,
	name: items.name,
	notes: items.notes,
	defaultStoreId: items.defaultStoreId,
	archivedAt: items.archivedAt
};

export function getItem(householdId: number, itemId: number): Item {
	const item = db()
		.select(itemFields)
		.from(items)
		.where(and(eq(items.id, itemId), eq(items.householdId, householdId)))
		.get();
	if (!item) error(404, 'Not found');
	return item;
}

/** Names are unique per household, ignoring case. */
export function findItemByName(householdId: number, name: string): Item | undefined {
	return db()
		.select(itemFields)
		.from(items)
		.where(and(eq(items.householdId, householdId), sql`lower(${items.name}) = lower(${name})`))
		.get();
}

export function createItem(householdId: number, name: string, now: number): Item {
	return db()
		.insert(items)
		.values({ householdId, name, createdAt: now })
		.returning(itemFields)
		.get();
}

export type PickerItem = {
	id: number;
	name: string;
	notes: string | null;
	/** Empty when the item has no default store or it's archived. */
	defaultStoreId: number | null;
	lastUnit: string | null;
	timesAdded: number;
};

/** Active items for the add bar's suggestions. */
export function listPickerItems(householdId: number): PickerItem[] {
	return db()
		.select({
			id: items.id,
			name: items.name,
			notes: items.notes,
			defaultStoreId: sql<number | null>`case when ${stores.archivedAt} is null then ${items.defaultStoreId} end`,
			lastUnit: sql<string | null>`(select ${groceryNeeds.unit} from ${groceryNeeds}
				where ${groceryNeeds.itemId} = ${items.id}
				order by ${groceryNeeds.createdAt} desc, ${groceryNeeds.id} desc limit 1)`,
			timesAdded: sql<number>`(select count(*) from ${groceryNeeds} where ${groceryNeeds.itemId} = ${items.id})`
		})
		.from(items)
		.leftJoin(stores, eq(stores.id, items.defaultStoreId))
		.where(and(eq(items.householdId, householdId), isNull(items.archivedAt)))
		.all();
}

export type CatalogItem = {
	id: number;
	name: string;
	notes: string | null;
	archivedAt: number | null;
	defaultStoreName: string | null;
	lastBoughtAt: number | null;
	lastBoughtStoreName: string | null;
};

/** The Items page: active items, or archived ones, optionally filtered by name. */
export function listCatalog(householdId: number, archived: boolean, search: string): CatalogItem[] {
	const lastBought = db()
		.select({
			itemId: groceryNeeds.itemId,
			receivedAt: sql<number>`max(${groceryNeeds.receivedAt})`.as('received_at')
		})
		.from(groceryNeeds)
		.where(and(eq(groceryNeeds.householdId, householdId), eq(groceryNeeds.status, 'received')))
		.groupBy(groceryNeeds.itemId)
		.as('last_bought');

	return db()
		.select({
			id: items.id,
			name: items.name,
			notes: items.notes,
			archivedAt: items.archivedAt,
			defaultStoreName: sql<string | null>`(select ${stores.name} from ${stores} where ${stores.id} = ${items.defaultStoreId})`,
			lastBoughtAt: lastBought.receivedAt,
			lastBoughtStoreName: sql<string | null>`(select s.name from ${groceryNeeds} n join ${stores} s on s.id = n.store_id
				where n.item_id = ${items.id} and n.status = 'received'
				order by n.received_at desc, n.id desc limit 1)`
		})
		.from(items)
		.leftJoin(lastBought, eq(lastBought.itemId, items.id))
		.where(
			and(
				eq(items.householdId, householdId),
				archived ? isNotNull(items.archivedAt) : isNull(items.archivedAt),
				search === '' ? undefined : sql`instr(lower(${items.name}), lower(${search})) > 0`
			)
		)
		.orderBy(asc(sql`lower(${items.name})`))
		.all();
}

export type ItemNameResult = { kind: 'saved' } | { kind: 'taken'; archived: boolean };

export function updateItem(
	householdId: number,
	itemId: number,
	changes: { name: string; notes: string | null }
): ItemNameResult {
	getItem(householdId, itemId);
	const existing = findItemByName(householdId, changes.name);
	if (existing && existing.id !== itemId) {
		return { kind: 'taken', archived: existing.archivedAt !== null };
	}
	db().update(items).set(changes).where(eq(items.id, itemId)).run();
	return { kind: 'saved' };
}

/** Archiving only hides an item from suggestions and lists; everything using it keeps working. */
export function setItemArchived(
	householdId: number,
	itemId: number,
	archived: boolean,
	now: number
): void {
	getItem(householdId, itemId);
	db()
		.update(items)
		.set({ archivedAt: archived ? now : null })
		.where(eq(items.id, itemId))
		.run();
}

/** The item's default store becomes the store it was just ordered or bought from (Q17). */
export function setDefaultStore(householdId: number, itemId: number, storeId: number): void {
	db()
		.update(items)
		.set({ defaultStoreId: storeId })
		.where(and(eq(items.id, itemId), eq(items.householdId, householdId)))
		.run();
}
