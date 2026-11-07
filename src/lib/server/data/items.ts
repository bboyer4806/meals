import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { foldCase } from '../../text.ts';
import { db, insertBatches, transaction } from '../db/index.ts';
import { groceryNeeds, items, stores } from '../db/schema.ts';

export type Item = {
	id: number;
	name: string;
	notes: string | null;
	defaultStoreId: number | null;
	/** The item's image (photos.ts), if it has one. */
	photoKey: string | null;
	archivedAt: number | null;
};

const itemFields = {
	id: items.id,
	name: items.name,
	notes: items.notes,
	defaultStoreId: items.defaultStoreId,
	photoKey: items.photoKey,
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

/** Names are unique per household, ignoring case (fold() also folds non-ASCII letters). */
export function findItemByName(householdId: number, name: string): Item | undefined {
	return db()
		.select(itemFields)
		.from(items)
		.where(and(eq(items.householdId, householdId), sql`fold(${items.name}) = fold(${name})`))
		.get();
}

/**
 * The household's items, archived ones included, by name with case folded, as findItemByName
 * matches names, for looking up many at once (MEA-89).
 */
export function itemsByName(householdId: number): Map<string, Item> {
	const rows = db()
		.select(itemFields)
		.from(items)
		.where(eq(items.householdId, householdId))
		.all();
	return new Map(rows.map((item) => [foldCase(item.name), item]));
}

export function createItem(householdId: number, name: string, now: number): Item {
	return db()
		.insert(items)
		.values({ householdId, name, createdAt: now })
		.returning(itemFields)
		.get();
}

/** Adds many items at once, as createItem adds one (MEA-89). */
export function createItems(householdId: number, names: string[], now: number): Item[] {
	return insertBatches(names).flatMap((batch) =>
		db()
			.insert(items)
			.values(batch.map((name) => ({ householdId, name, createdAt: now })))
			.returning(itemFields)
			.all()
	);
}

export type PickerItem = {
	id: number;
	name: string;
	notes: string | null;
	photoKey: string | null;
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
			photoKey: items.photoKey,
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
	photoKey: string | null;
	alwaysHave: boolean;
	archivedAt: number | null;
	defaultStoreName: string | null;
	lastBoughtAt: number | null;
	lastBoughtStoreName: string | null;
};

/**
 * The Items page: active items, or archived ones, optionally filtered by name. Sorted by name in
 * code rather than in SQL, so "Éclairs" sorts with the E's (MEA-88).
 */
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
			photoKey: items.photoKey,
			alwaysHave: items.alwaysHave,
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
				search === '' ? undefined : sql`instr(fold(${items.name}), fold(${search})) > 0`
			)
		)
		.all()
		.sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * Sets or clears the item's image (MEA-50). Returns the previous key, so the caller can delete its
 * files, or null when there was none or it didn't change.
 */
export function setItemPhoto(
	householdId: number,
	itemId: number,
	photoKey: string | null
): string | null {
	return transaction(() => {
		const previous = getItem(householdId, itemId).photoKey;
		db().update(items).set({ photoKey }).where(eq(items.id, itemId)).run();
		return previous === photoKey ? null : previous;
	});
}

/** Households with items not yet checked for a standard image, oldest first (design 6.14). */
export function listHouseholdsToCheck(): number[] {
	return db()
		.selectDistinct({ householdId: items.householdId })
		.from(items)
		.where(isNull(items.standardImageCheckedAt))
		.orderBy(asc(items.householdId))
		.all()
		.map((row) => row.householdId);
}

/** The household's items not yet checked for a standard image, archived ones included (6.14). */
export function listUncheckedItems(
	householdId: number
): { id: number; name: string; photoKey: string | null }[] {
	return db()
		.select({ id: items.id, name: items.name, photoKey: items.photoKey })
		.from(items)
		.where(and(eq(items.householdId, householdId), isNull(items.standardImageCheckedAt)))
		.orderBy(asc(items.id))
		.all();
}

/**
 * Records that the item has been checked for a standard image, which happens once (design 6.14).
 * The first time, it takes `photoKey` if it still has no image. Returns whether it took it, so the
 * caller can delete the files of a key it didn't.
 */
export function setStandardImage(
	householdId: number,
	itemId: number,
	photoKey: string | null,
	now: number
): boolean {
	return transaction(() => {
		const item = db()
			.select({ photoKey: items.photoKey, checkedAt: items.standardImageCheckedAt })
			.from(items)
			.where(and(eq(items.id, itemId), eq(items.householdId, householdId)))
			.get();
		if (!item) error(404, 'Not found');
		if (item.checkedAt !== null) return false;
		const takes = photoKey !== null && item.photoKey === null;
		db()
			.update(items)
			.set(takes ? { photoKey, standardImageCheckedAt: now } : { standardImageCheckedAt: now })
			.where(eq(items.id, itemId))
			.run();
		return takes;
	});
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
