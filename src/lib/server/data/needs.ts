import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { dateIn } from '../../dates.ts';
import { formatQuantity, normalizeName } from '../../text.ts';
import { conversionFactor, sameUnit } from '../../units.ts';
import { db, transaction } from '../db/index.ts';
import {
	groceryNeeds,
	items,
	partyAllocations,
	partyItems,
	stores,
	type NeedStatus
} from '../db/schema.ts';
import { createItem, findItemByName, setDefaultStore, type Item } from './items.ts';
import { getStore, requireActiveStore } from './stores.ts';

// The rules in this file are design sections 6.2 to 6.4, and how grocery lines keep the party
// list quantities that are part of them (6.15).

const DAY = 24 * 60 * 60 * 1000;

/**
 * How close two quantities must be to count as the same. Converting between units leaves floating
 * point noise, such as a teaspoon on a line in quarts (6.15).
 */
export const TOLERANCE = 1e-9;

/**
 * A quantity worked out from others, rounded to 9 decimal places to drop the floating point noise
 * adding and subtracting leaves: 1.1 + 2.2 is 3.3, not 3.3000000000000003 (6.5, MEA-92). That
 * moves it by at most half of TOLERANCE, so a line stays in step with its party quantities (6.15).
 */
function roundQuantity(quantity: number): number {
	return Math.round(quantity * 1e9) / 1e9;
}

/**
 * What a party item's quantity is multiplied by to give its share of a line. A party allocation's
 * unit always converts to its line's (6.15).
 */
export function shareFactor(partyUnit: string | null, lineUnit: string | null): number {
	const factor = conversionFactor(partyUnit, lineUnit);
	if (factor === undefined) {
		throw new Error(`A party quantity in ${partyUnit} can't be part of a line in ${lineUnit}`);
	}
	return factor;
}

type LineAllocation = {
	id: number;
	partyItemId: number;
	quantity: number;
	partyUnit: string | null;
};

/** The party allocations on a line, in the order they were added to Groceries (6.15). */
function allocationsOn(needId: number): LineAllocation[] {
	return db()
		.select({
			id: partyAllocations.id,
			partyItemId: partyAllocations.partyItemId,
			quantity: partyAllocations.quantity,
			partyUnit: partyItems.unit
		})
		.from(partyAllocations)
		.innerJoin(partyItems, eq(partyItems.id, partyAllocations.partyItemId))
		.where(eq(partyAllocations.needId, needId))
		.orderBy(asc(partyAllocations.id))
		.all();
}

/**
 * Keeps a line's party allocations within it once its quantity or unit is changed (6.15). One in a
 * unit the line's no longer converts to comes off it, and when they come to more than the line,
 * the oldest keep theirs and the newest give way.
 */
function fitAllocations(needId: number, quantity: number, unit: string | null): void {
	let room = quantity;
	for (const allocation of allocationsOn(needId)) {
		const factor = conversionFactor(allocation.partyUnit, unit);
		if (factor === undefined || room <= TOLERANCE) {
			db().delete(partyAllocations).where(eq(partyAllocations.id, allocation.id)).run();
		} else if (allocation.quantity * factor <= room + TOLERANCE) {
			room -= allocation.quantity * factor;
		} else {
			db()
				.update(partyAllocations)
				.set({ quantity: room / factor })
				.where(eq(partyAllocations.id, allocation.id))
				.run();
			room = 0;
		}
	}
}

/**
 * Moves the party allocations a Got fewer received onto its Received line (6.15). Party lists get
 * what arrived before the rest of the list, in the order their quantities were added to Groceries,
 * and an allocation that's only partly covered is split.
 */
function receiveAllocations(
	householdId: number,
	line: GroceryLine,
	receivedId: number,
	received: number
): void {
	let left = received;
	for (const allocation of allocationsOn(line.id)) {
		if (left <= TOLERANCE) return;
		const factor = shareFactor(allocation.partyUnit, line.unit);
		const share = allocation.quantity * factor;
		if (share <= left + TOLERANCE) {
			db()
				.update(partyAllocations)
				.set({ needId: receivedId })
				.where(eq(partyAllocations.id, allocation.id))
				.run();
			left -= share;
		} else {
			const part = left / factor;
			db()
				.insert(partyAllocations)
				.values({ householdId, partyItemId: allocation.partyItemId, needId: receivedId, quantity: part })
				.run();
			db()
				.update(partyAllocations)
				.set({ quantity: allocation.quantity - part })
				.where(eq(partyAllocations.id, allocation.id))
				.run();
			left = 0;
		}
	}
}

export type GroceryLine = {
	id: number;
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	itemPhotoKey: string | null;
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
			itemPhotoKey: items.photoKey,
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

export function getLine(householdId: number, needId: number): GroceryLine {
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

/** The lines To Order, oldest first, for the grocery list email (6.16). */
export function listToOrderLines(householdId: number): GroceryLine[] {
	return selectLines()
		.where(and(eq(groceryNeeds.householdId, householdId), eq(groceryNeeds.status, 'to_order')))
		.orderBy(asc(groceryNeeds.id))
		.all();
}

/** Received lines, newest first, optionally filtered by item name. */
export function listHistory(householdId: number, search: string, limit: number): GroceryLine[] {
	return selectLines()
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				eq(groceryNeeds.status, 'received'),
				search === '' ? undefined : sql`instr(fold(${items.name}), fold(${search})) > 0`
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
			suggestedUnit: string | null;
	  };

export function storeForNewLine(householdId: number, item: Item, store: StoreChoice): number | null {
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
	return transaction(() => {
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
				fitAllocations(toOrder.id, input.quantity, input.unit);
				return { kind: 'updated' };
			}
			// The same unit, however it's spelled, suggests the sum in the line's unit (6.4, MEA-93).
			const same = sameUnit(toOrder.unit, input.unit);
			return {
				kind: 'duplicate',
				status: 'to_order',
				itemName: item.name,
				quantity: toOrder.quantity,
				unit: toOrder.unit,
				storeName: toOrder.storeName,
				suggestedQuantity: same ? roundQuantity(toOrder.quantity + input.quantity) : input.quantity,
				suggestedUnit: same ? toOrder.unit : input.unit
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
				suggestedQuantity: input.quantity,
				suggestedUnit: input.unit
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
 * own. A line with neither can't change status; the page asks for a store first. Only a newly
 * picked store must be active.
 */
export function storeForStatusChange(
	householdId: number,
	line: GroceryLine,
	storeId: number | undefined
): number {
	// The line's own store keeps working even if it was archived since (design 6.10).
	if (storeId !== undefined && storeId !== line.storeId) {
		return requireActiveStore(householdId, storeId).id;
	}
	if (line.storeId === null) error(400, 'Pick a store first');
	return line.storeId;
}

export function markOrdered(
	householdId: number,
	needId: number,
	storeId: number | undefined,
	now: number
): void {
	transaction(() => {
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
	transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status === 'received') error(400, 'This line was already received');
		const store = storeForStatusChange(householdId, line, storeId);
		db()
			.update(groceryNeeds)
			.set({ status: 'received', storeId: store, receivedAt: now })
			.where(eq(groceryNeeds.id, needId))
			.run();
		if (line.status === 'to_order') setDefaultStore(householdId, line.itemId, store);
	});
}

/**
 * Marks the To Order lines a store's confirmation counted as Ordered (6.2). The list doesn't
 * update itself (Q11), so a line added since isn't among them, and a counted line that's no
 * longer To Order at the store is left as it is. Returns how many changed.
 */
export function markAllOrdered(
	householdId: number,
	storeId: number,
	needIds: number[],
	now: number
): number {
	return transaction(() => {
		getStore(householdId, storeId);
		const lines = db()
			.update(groceryNeeds)
			.set({ status: 'ordered', orderedAt: now })
			.where(
				and(
					eq(groceryNeeds.householdId, householdId),
					eq(groceryNeeds.storeId, storeId),
					eq(groceryNeeds.status, 'to_order'),
					inArray(groceryNeeds.id, needIds)
				)
			)
			.returning({ itemId: groceryNeeds.itemId })
			.all();
		for (const line of lines) setDefaultStore(householdId, line.itemId, storeId);
		return lines.length;
	});
}

/**
 * Marks the Ordered lines a store's confirmation counted as Received, leaving a counted line
 * that's no longer Ordered at the store as it is (6.2, Q11). Returns how many changed.
 */
export function markAllReceived(
	householdId: number,
	storeId: number,
	needIds: number[],
	now: number
): number {
	return transaction(() => {
		getStore(householdId, storeId);
		const lines = db()
			.update(groceryNeeds)
			.set({ status: 'received', receivedAt: now })
			.where(
				and(
					eq(groceryNeeds.householdId, householdId),
					eq(groceryNeeds.storeId, storeId),
					eq(groceryNeeds.status, 'ordered'),
					inArray(groceryNeeds.id, needIds)
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
 * original stays To Order with the rest (Q20). Party lists get what arrived first (6.15). A rest
 * that rounds to nothing means all of it arrived, so the whole line is received (6.2, MEA-92).
 */
export function markGotFewer(
	householdId: number,
	needId: number,
	receivedQuantity: number,
	storeId: number | undefined,
	now: number
): void {
	transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status === 'received') error(400, 'This line was already received');
		if (!(receivedQuantity > 0 && receivedQuantity < line.quantity)) {
			error(400, `Enter an amount less than ${formatQuantity(line.quantity)}`);
		}
		const rest = roundQuantity(line.quantity - receivedQuantity);
		if (rest === 0) {
			markReceived(householdId, needId, storeId, now);
			return;
		}
		const store = storeForStatusChange(householdId, line, storeId);
		const received = db()
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
			.returning({ id: groceryNeeds.id })
			.get();
		receiveAllocations(householdId, line, received.id, receivedQuantity);
		db()
			.update(groceryNeeds)
			.set({
				quantity: rest,
				storeId: store,
				status: 'to_order',
				orderedAt: null
			})
			.where(eq(groceryNeeds.id, needId))
			.run();
		if (line.status === 'to_order') setDefaultStore(householdId, line.itemId, store);
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

export type LineChanges = {
	quantity: number;
	unit: string | null;
	storeId: number | null;
	note: string | null;
};

export function updateLine(householdId: number, needId: number, changes: LineChanges): void {
	transaction(() => {
		const line = getLine(householdId, needId);
		if (line.status === 'received') error(400, 'Received lines can no longer be edited');
		if (changes.storeId === null && line.status === 'ordered') {
			error(400, 'An ordered line needs a store');
		}
		if (changes.storeId !== null && changes.storeId !== line.storeId) {
			requireActiveStore(householdId, changes.storeId);
		}
		db().update(groceryNeeds).set(changes).where(eq(groceryNeeds.id, needId)).run();
		fitAllocations(needId, changes.quantity, changes.unit);
	});
}

/** Saves the edit sheet's changes, then applies a status change to the line, as one change. */
export function withLineChanges(
	householdId: number,
	needId: number,
	changes: LineChanges,
	statusChange: () => void
): void {
	transaction(() => {
		updateLine(householdId, needId, changes);
		statusChange();
	});
}

/** Deleting a line deletes its party allocations, so their party items need adding again (6.15). */
export function deleteLine(householdId: number, needId: number): void {
	const line = getLine(householdId, needId);
	if (line.status === 'received') error(400, 'Received lines are kept as history');
	db().delete(groceryNeeds).where(eq(groceryNeeds.id, needId)).run();
}
