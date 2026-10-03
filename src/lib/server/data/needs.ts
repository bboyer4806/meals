import { error } from '@sveltejs/kit';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { dateIn } from '../../dates.ts';
import { normalizeName } from '../../text.ts';
import { db } from '../db/index.ts';
import { groceryNeeds, items, stores, type NeedStatus } from '../db/schema.ts';
import { createItem, findItemByName, setDefaultStore, type Item } from './items.ts';
import { getStore, requireActiveStore } from './stores.ts';

// The rules in this file are design sections 6.2 to 6.4.

const DAY = 24 * 60 * 60 * 1000;

export type GroceryLine = {
	id: number;
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	quantity: number;
	unit: string | null;
	storeId: number | null;
	storeName: string | null;
	status: NeedStatus;
	note: string | null;
	orderedAt: number | null;
	receivedAt: number | null;
};

function selectLines() {
	return db()
		.select({
			id: groceryNeeds.id,
			itemId: groceryNeeds.itemId,
			itemName: items.name,
			itemNotes: items.notes,
			quantity: groceryNeeds.quantity,
			unit: groceryNeeds.unit,
			storeId: groceryNeeds.storeId,
			storeName: stores.name,
			status: groceryNeeds.status,
			note: groceryNeeds.note,
			orderedAt: groceryNeeds.orderedAt,
			receivedAt: groceryNeeds.receivedAt
		})
		.from(groceryNeeds)
		.innerJoin(items, eq(items.id, groceryNeeds.itemId))
		.leftJoin(stores, eq(stores.id, groceryNeeds.storeId));
}

function getLine(householdId: number, needId: number): GroceryLine {
	const line = selectLines()
		.where(and(eq(groceryNeeds.id, needId), eq(groceryNeeds.householdId, householdId)))
		.get();
	if (!line) error(404, 'Not found');
	return line;
}

function receivedToday(line: GroceryLine, timeZone: string, now: number): boolean {
	return line.receivedAt !== null && dateIn(line.receivedAt, timeZone) === dateIn(now, timeZone);
}

/** The list: everything To Order or Ordered, plus what was received today (addition 2.2.3). */
export function listActiveLines(householdId: number, timeZone: string, now: number): GroceryLine[] {
	return selectLines()
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				or(
					inArray(groceryNeeds.status, ['to_order', 'ordered']),
					// Today in any time zone started less than two days ago.
					gt(groceryNeeds.receivedAt, now - 2 * DAY)
				)
			)
		)
		.all()
		.filter((line) => line.status !== 'received' || receivedToday(line, timeZone, now));
}

/** Received lines, newest first, optionally filtered by item name. */
export function listHistory(householdId: number, search: string, limit: number): GroceryLine[] {
	return selectLines()
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				eq(groceryNeeds.status, 'received'),
				search === '' ? undefined : sql`instr(lower(${items.name}), lower(${search})) > 0`
			)
		)
		.orderBy(desc(groceryNeeds.receivedAt), desc(groceryNeeds.id))
		.limit(limit)
		.all();
}

export type StoreChoice = 'usual' | 'none' | number;

export type AddInput = {
	itemName: string;
	quantity: number;
	unit: string | null;
	store: StoreChoice;
	/** How the person answered a previous prompt for this same add. */
	resolution: 'none' | 'restore' | 'update' | 'add';
};

export type AddResult =
	| { kind: 'added' }
	| { kind: 'updated' }
	| { kind: 'archived'; itemName: string }
	| {
			kind: 'duplicate';
			status: 'to_order' | 'ordered';
			itemName: string;
			quantity: number;
			unit: string | null;
			storeName: string | null;
			suggestedQuantity: number;
	  };

function sameUnit(a: string | null, b: string | null): boolean {
	return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

function storeForNewLine(householdId: number, item: Item, store: StoreChoice): number | null {
	if (store === 'none') return null;
	if (store === 'usual') {
		if (item.defaultStoreId === null) return null;
		return getStore(householdId, item.defaultStoreId).archivedAt === null
			? item.defaultStoreId
			: null;
	}
	return requireActiveStore(householdId, store).id;
}

/** Adds an item to the list, creating the item if the name is new (Q1, Q18, Q22). */
export function addNeed(householdId: number, input: AddInput, now: number): AddResult {
	return db().transaction(() => {
		const name = normalizeName(input.itemName);
		let item = findItemByName(householdId, name);
		if (item && item.archivedAt !== null) {
			if (input.resolution !== 'restore') return { kind: 'archived', itemName: item.name };
			db().update(items).set({ archivedAt: null }).where(eq(items.id, item.id)).run();
		}
		item ??= createItem(householdId, name, now);

		const open = selectLines()
			.where(
				and(
					eq(groceryNeeds.householdId, householdId),
					eq(groceryNeeds.itemId, item.id),
					inArray(groceryNeeds.status, ['to_order', 'ordered'])
				)
			)
			.all();
		const toOrder = open.find((line) => line.status === 'to_order');
		const ordered = open.find((line) => line.status === 'ordered');

		if (toOrder) {
			if (input.resolution === 'update') {
				db()
					.update(groceryNeeds)
					.set({ quantity: input.quantity, unit: input.unit })
					.where(eq(groceryNeeds.id, toOrder.id))
					.run();
				return { kind: 'updated' };
			}
			return {
				kind: 'duplicate',
				status: 'to_order',
				itemName: item.name,
				quantity: toOrder.quantity,
				unit: toOrder.unit,
				storeName: toOrder.storeName,
				suggestedQuantity: sameUnit(toOrder.unit, input.unit)
					? toOrder.quantity + input.quantity
					: input.quantity
			};
		}
		if (ordered && input.resolution !== 'add') {
			return {
				kind: 'duplicate',
				status: 'ordered',
				itemName: item.name,
				quantity: ordered.quantity,
				unit: ordered.unit,
				storeName: ordered.storeName,
				suggestedQuantity: input.quantity
			};
		}

		db()
			.insert(groceryNeeds)
			.values({
				householdId,
				itemId: item.id,
				quantity: input.quantity,
				unit: input.unit,
				storeId: storeForNewLine(householdId, item, input.store),
				status: 'to_order',
				createdAt: now
			})
			.run();
		return { kind: 'added' };
	});
}

/**
 * The store a line is ordered or received from: the one picked in the request, or the line's
 * own. A line with neither can't change status; the page asks for a store first.
 */
function storeForStatusChange(
	householdId: number,
	line: GroceryLine,
	storeId: number | undefined
): number {
	if (storeId !== undefined) return requireActiveStore(householdId, storeId).id;
	if (line.storeId === null) error(400, 'Pick a store first');
	return line.storeId;
}

export function markOrdered(
	householdId: number,
	needId: number,
	storeId: number | undefined,
	now: number
): void {
	db().transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status !== 'to_order') error(400, 'Only lines to order can be marked ordered');
		const store = storeForStatusChange(householdId, line, storeId);
		db()
			.update(groceryNeeds)
			.set({ status: 'ordered', storeId: store, orderedAt: now })
			.where(eq(groceryNeeds.id, needId))
			.run();
		setDefaultStore(householdId, line.itemId, store);
	});
}

export function markReceived(
	householdId: number,
	needId: number,
	storeId: number | undefined,
	now: number
): void {
	db().transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status === 'received') error(400, 'This line was already received');
		const store = storeForStatusChange(householdId, line, storeId);
		db()
			.update(groceryNeeds)
			.set({ status: 'received', storeId: store, receivedAt: now })
			.where(eq(groceryNeeds.id, needId))
			.run();
		setDefaultStore(householdId, line.itemId, store);
	});
}

/** Marks every To Order line at a store as Ordered. Returns how many changed. */
export function markAllOrdered(householdId: number, storeId: number, now: number): number {
	return db().transaction(() => {
		getStore(householdId, storeId);
		const lines = db()
			.update(groceryNeeds)
			.set({ status: 'ordered', orderedAt: now })
			.where(
				and(
					eq(groceryNeeds.householdId, householdId),
					eq(groceryNeeds.storeId, storeId),
					eq(groceryNeeds.status, 'to_order')
				)
			)
			.returning({ itemId: groceryNeeds.itemId })
			.all();
		for (const line of lines) setDefaultStore(householdId, line.itemId, storeId);
		return lines.length;
	});
}

/** Marks every Ordered line at a store as Received. Returns how many changed. */
export function markAllReceived(householdId: number, storeId: number, now: number): number {
	return db().transaction(() => {
		getStore(householdId, storeId);
		const lines = db()
			.update(groceryNeeds)
			.set({ status: 'received', receivedAt: now })
			.where(
				and(
					eq(groceryNeeds.householdId, householdId),
					eq(groceryNeeds.storeId, storeId),
					eq(groceryNeeds.status, 'ordered')
				)
			)
			.returning({ id: groceryNeeds.id })
			.all();
		return lines.length;
	});
}

/** An ordered line that didn't arrive goes back to To Order, keeping its store (Q20). */
export function markDidntCome(householdId: number, needId: number): void {
	const line = getLine(householdId, needId);
	if (line.status !== 'ordered') error(400, 'Only ordered lines can be marked as not arrived');
	db()
		.update(groceryNeeds)
		.set({ status: 'to_order', orderedAt: null })
		.where(eq(groceryNeeds.id, needId))
		.run();
}

/**
 * Some of a line arrived or was bought: a Received line is split off for that amount, and the
 * original stays To Order with the rest (Q20).
 */
export function markGotFewer(
	householdId: number,
	needId: number,
	receivedQuantity: number,
	storeId: number | undefined,
	now: number
): void {
	db().transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status === 'received') error(400, 'This line was already received');
		if (!(receivedQuantity > 0 && receivedQuantity < line.quantity)) {
			error(400, `Enter an amount less than ${line.quantity}`);
		}
		const store = storeForStatusChange(householdId, line, storeId);
		db()
			.insert(groceryNeeds)
			.values({
				householdId,
				itemId: line.itemId,
				quantity: receivedQuantity,
				unit: line.unit,
				storeId: store,
				status: 'received',
				note: line.note,
				createdAt: now,
				orderedAt: line.orderedAt,
				receivedAt: now
			})
			.run();
		db()
			.update(groceryNeeds)
			.set({
				quantity: line.quantity - receivedQuantity,
				storeId: store,
				status: 'to_order',
				orderedAt: null
			})
			.where(eq(groceryNeeds.id, needId))
			.run();
		setDefaultStore(householdId, line.itemId, store);
	});
}

/** Undoes a mis-tap: a line received today goes back to Ordered or To Order (addition 2.2.3). */
export function undoReceived(
	householdId: number,
	needId: number,
	timeZone: string,
	now: number
): void {
	const line = getLine(householdId, needId);
	if (line.status !== 'received' || !receivedToday(line, timeZone, now)) {
		error(400, 'Only lines received today can be undone');
	}
	db()
		.update(groceryNeeds)
		.set({ status: line.orderedAt === null ? 'to_order' : 'ordered', receivedAt: null })
		.where(eq(groceryNeeds.id, needId))
		.run();
}

export function updateLine(
	householdId: number,
	needId: number,
	changes: { quantity: number; unit: string | null; storeId: number | null; note: string | null }
): void {
	const line = getLine(householdId, needId);
	if (line.status === 'received') error(400, 'Received lines can no longer be edited');
	if (changes.storeId === null && line.status === 'ordered') {
		error(400, 'An ordered line needs a store');
	}
	if (changes.storeId !== null && changes.storeId !== line.storeId) {
		requireActiveStore(householdId, changes.storeId);
	}
	db().update(groceryNeeds).set(changes).where(eq(groceryNeeds.id, needId)).run();
}

export function deleteLine(householdId: number, needId: number): void {
	const line = getLine(householdId, needId);
	if (line.status === 'received') error(400, 'Received lines are kept as history');
	db().delete(groceryNeeds).where(eq(groceryNeeds.id, needId)).run();
}
