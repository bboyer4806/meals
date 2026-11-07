import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { normalizeName } from '../../text.ts';
import { conversionFactor } from '../../units.ts';
import { db, transaction } from '../db/index.ts';
import { groceryNeeds, items, partyAllocations, partyItems, partyLists } from '../db/schema.ts';
import { createItem, findItemByName, getItem, setDefaultStore } from './items.ts';
import {
	getLine,
	shareFactor,
	storeForNewLine,
	storeForStatusChange,
	TOLERANCE,
	type GroceryLine
} from './needs.ts';

// The rules in this file are design section 6.15. What a party item has bought on Groceries is
// worked out from its allocations each time, as an allocation is received when its line is, so
// checking off, Got fewer and undoing on the grocery list change party lists with nothing else to
// keep up to date.

type PartyItemRow = {
	id: number;
	partyListId: number;
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	itemPhotoKey: string | null;
	quantity: number;
	unit: string | null;
	boughtQuantity: number;
	/** What Groceries received for it, in its unit. */
	received: number;
	/** What's on Groceries for it and not received yet, in its unit. */
	onGroceries: number;
	needsStore: boolean;
};

export type PartyItem = {
	id: number;
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	itemPhotoKey: string | null;
	/** What the party needs, in its unit. */
	quantity: number;
	unit: string | null;
	/** How much has been bought, checked off on the list or received on Groceries. */
	bought: number;
	/** How much is on Groceries and not received yet. */
	onGroceries: number;
	/** How much is neither bought nor on Groceries, which Add to Groceries adds. */
	toAdd: number;
	/** Whether all it needs is bought. */
	done: boolean;
	/** Whether checking it off needs a store, for a grocery line it's on that has none. */
	needsStore: boolean;
};

function selectPartyItems() {
	const received = sql`${groceryNeeds.status} = 'received'`;
	return db()
		.select({
			id: partyItems.id,
			partyListId: partyItems.partyListId,
			itemId: partyItems.itemId,
			itemName: items.name,
			itemNotes: items.notes,
			itemPhotoKey: items.photoKey,
			quantity: partyItems.quantity,
			unit: partyItems.unit,
			boughtQuantity: partyItems.boughtQuantity,
			received: sql<number>`coalesce(sum(case when ${received}
				then ${partyAllocations.quantity} end), 0)`,
			onGroceries: sql<number>`coalesce(sum(case when not ${received}
				then ${partyAllocations.quantity} end), 0)`,
			needsStore: sql<boolean>`coalesce(max(not ${received}
				and ${groceryNeeds.storeId} is null), 0)`.mapWith(Boolean)
		})
		.from(partyItems)
		.innerJoin(items, eq(items.id, partyItems.itemId))
		.leftJoin(partyAllocations, eq(partyAllocations.partyItemId, partyItems.id))
		.leftJoin(groceryNeeds, eq(groceryNeeds.id, partyAllocations.needId))
		.groupBy(partyItems.id);
}

function partyItem(row: PartyItemRow): PartyItem {
	const bought = row.boughtQuantity + row.received;
	const toAdd = row.quantity - bought - row.onGroceries;
	return {
		id: row.id,
		itemId: row.itemId,
		itemName: row.itemName,
		itemNotes: row.itemNotes,
		itemPhotoKey: row.itemPhotoKey,
		quantity: row.quantity,
		unit: row.unit,
		bought,
		onGroceries: row.onGroceries,
		toAdd: toAdd > TOLERANCE ? toAdd : 0,
		done: bought >= row.quantity - TOLERANCE,
		needsStore: row.needsStore
	};
}

function getPartyItemRow(householdId: number, listId: number, partyItemId: number): PartyItemRow {
	const row = selectPartyItems()
		.where(
			and(
				eq(partyItems.id, partyItemId),
				eq(partyItems.householdId, householdId),
				eq(partyItems.partyListId, listId)
			)
		)
		.get();
	if (!row) error(404, 'Not found');
	return row;
}

type PartyListRow = { id: number; name: string };

function requireList(householdId: number, listId: number): PartyListRow {
	const list = db()
		.select({ id: partyLists.id, name: partyLists.name })
		.from(partyLists)
		.where(and(eq(partyLists.id, listId), eq(partyLists.householdId, householdId)))
		.get();
	if (!list) error(404, 'Not found');
	return list;
}

export type PartyListSummary = PartyListRow & { itemCount: number; doneCount: number };

/**
 * The household's party lists, with how many things each has and how many of them are bought.
 * Sorted by name in code rather than in SQL, so "Été" sorts with the E's (MEA-88).
 */
export function listPartyLists(householdId: number): PartyListSummary[] {
	const rows = selectPartyItems().where(eq(partyItems.householdId, householdId)).all();
	return db()
		.select({ id: partyLists.id, name: partyLists.name })
		.from(partyLists)
		.where(eq(partyLists.householdId, householdId))
		.all()
		.map((list) => {
			const things = rows.filter((row) => row.partyListId === list.id).map(partyItem);
			return { ...list, itemCount: things.length, doneCount: things.filter((t) => t.done).length };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export type PartyList = PartyListRow & { items: PartyItem[] };

/** A party list with its things, by name. */
export function getPartyList(householdId: number, listId: number): PartyList {
	const list = requireList(householdId, listId);
	const things = selectPartyItems()
		.where(and(eq(partyItems.householdId, householdId), eq(partyItems.partyListId, listId)))
		.all()
		.map(partyItem)
		.sort((a, b) => a.itemName.localeCompare(b.itemName));
	return { ...list, items: things };
}

/** Names are unique per household, ignoring case, as item and store names are (2.3). */
function requireUnusedName(householdId: number, name: string, listId?: number): void {
	const existing = db()
		.select({ id: partyLists.id })
		.from(partyLists)
		.where(and(eq(partyLists.householdId, householdId), sql`fold(${partyLists.name}) = fold(${name})`))
		.get();
	if (existing && existing.id !== listId) {
		error(400, `You already have a party list called ${name}.`);
	}
}

/** Returns the new list's id. */
export function createPartyList(householdId: number, name: string, now: number): number {
	return transaction(() => {
		requireUnusedName(householdId, name);
		return db()
			.insert(partyLists)
			.values({ householdId, name, createdAt: now })
			.returning({ id: partyLists.id })
			.get().id;
	});
}

export function renamePartyList(householdId: number, listId: number, name: string): void {
	transaction(() => {
		requireList(householdId, listId);
		requireUnusedName(householdId, name, listId);
		db().update(partyLists).set({ name }).where(eq(partyLists.id, listId)).run();
	});
}

export type PartyItemInput = { itemName: string; quantity: number; unit: string | null };

/** Adds something to a party list, adding the item to the household's items if the name is new. */
export function addPartyItem(
	householdId: number,
	listId: number,
	input: PartyItemInput,
	now: number
): void {
	transaction(() => {
		requireList(householdId, listId);
		const name = normalizeName(input.itemName);
		const existing = findItemByName(householdId, name);
		if (existing && existing.archivedAt !== null) {
			error(400, `${existing.name} is archived. Restore it on Items first.`);
		}
		const item = existing ?? createItem(householdId, name, now);
		const onList = db()
			.select({ id: partyItems.id })
			.from(partyItems)
			.where(and(eq(partyItems.partyListId, listId), eq(partyItems.itemId, item.id)))
			.get();
		if (onList) error(400, `${item.name} is already on this list.`);
		db()
			.insert(partyItems)
			.values({
				householdId,
				partyListId: listId,
				itemId: item.id,
				quantity: input.quantity,
				unit: input.unit,
				createdAt: now
			})
			.run();
	});
}

type Allocation = {
	id: number;
	needId: number;
	/** In the party item's unit. */
	quantity: number;
	partyUnit: string | null;
	lineQuantity: number;
	lineUnit: string | null;
};

/**
 * The party allocations that `where` picks, on lines that are received or on ones that aren't yet,
 * in the order they were added to Groceries.
 */
function allocations(householdId: number, where: SQL, received: boolean): Allocation[] {
	return db()
		.select({
			id: partyAllocations.id,
			needId: partyAllocations.needId,
			quantity: partyAllocations.quantity,
			partyUnit: partyItems.unit,
			lineQuantity: groceryNeeds.quantity,
			lineUnit: groceryNeeds.unit
		})
		.from(partyAllocations)
		.innerJoin(partyItems, eq(partyItems.id, partyAllocations.partyItemId))
		.innerJoin(groceryNeeds, eq(groceryNeeds.id, partyAllocations.needId))
		.where(
			and(
				eq(partyAllocations.householdId, householdId),
				where,
				received ? eq(groceryNeeds.status, 'received') : ne(groceryNeeds.status, 'received')
			)
		)
		.orderBy(asc(partyAllocations.id))
		.all();
}

/** An allocation's share of its line, in the line's unit. */
function shareOf(allocation: Allocation): number {
	return allocation.quantity * shareFactor(allocation.partyUnit, allocation.lineUnit);
}

/**
 * Puts some of a party item on Groceries: onto the oldest To Order line for its item in a unit that
 * its own converts to, or else onto a new line at the item's usual store (6.3, 6.15). Ordered lines
 * aren't changed, as an order was placed (2.3).
 */
function allocate(
	householdId: number,
	thing: { id: number; itemId: number; unit: string | null },
	quantity: number,
	now: number
): void {
	const line = db()
		.select({ id: groceryNeeds.id, quantity: groceryNeeds.quantity, unit: groceryNeeds.unit })
		.from(groceryNeeds)
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				eq(groceryNeeds.itemId, thing.itemId),
				eq(groceryNeeds.status, 'to_order')
			)
		)
		.orderBy(asc(groceryNeeds.id))
		.all()
		.find((candidate) => conversionFactor(thing.unit, candidate.unit) !== undefined);
	let needId: number;
	if (line) {
		db()
			.update(groceryNeeds)
			.set({ quantity: line.quantity + quantity * shareFactor(thing.unit, line.unit) })
			.where(eq(groceryNeeds.id, line.id))
			.run();
		needId = line.id;
	} else {
		const item = getItem(householdId, thing.itemId);
		needId = db()
			.insert(groceryNeeds)
			.values({
				householdId,
				itemId: thing.itemId,
				quantity,
				unit: thing.unit,
				storeId: storeForNewLine(householdId, item, 'usual'),
				status: 'to_order',
				createdAt: now
			})
			.returning({ id: groceryNeeds.id })
			.get().id;
	}
	db().insert(partyAllocations).values({ householdId, partyItemId: thing.id, needId, quantity }).run();
}

/**
 * Takes parts of open allocations, in the party item's unit, off their lines: a line is deleted
 * once nothing's left of it, and an allocation once nothing's left of it (6.15).
 */
function release(parts: [allocation: Allocation, part: number][]): void {
	const left = new Map<number, number>();
	for (const [allocation, part] of parts) {
		const quantity = left.get(allocation.needId) ?? allocation.lineQuantity;
		const share = part * shareFactor(allocation.partyUnit, allocation.lineUnit);
		left.set(allocation.needId, quantity - share);
		if (allocation.quantity - part <= TOLERANCE) {
			db().delete(partyAllocations).where(eq(partyAllocations.id, allocation.id)).run();
		} else {
			db()
				.update(partyAllocations)
				.set({ quantity: allocation.quantity - part })
				.where(eq(partyAllocations.id, allocation.id))
				.run();
		}
	}
	for (const [needId, quantity] of left) {
		if (quantity <= TOLERANCE) db().delete(groceryNeeds).where(eq(groceryNeeds.id, needId)).run();
		else db().update(groceryNeeds).set({ quantity }).where(eq(groceryNeeds.id, needId)).run();
	}
}

/**
 * Changes what a party needs of something (6.15). What's on Groceries for it changes by as much,
 * never past what it still needs, and newest first when it goes down; nothing changes there when
 * none of it is on Groceries. What was bought stays bought.
 */
export function setPartyItemQuantity(
	householdId: number,
	listId: number,
	partyItemId: number,
	quantity: number,
	now: number
): void {
	transaction(() => {
		const row = getPartyItemRow(householdId, listId, partyItemId);
		const thing = partyItem(row);
		db().update(partyItems).set({ quantity }).where(eq(partyItems.id, partyItemId)).run();
		if (thing.onGroceries <= TOLERANCE) return;
		const target = Math.min(
			Math.max(thing.onGroceries + quantity - thing.quantity, 0),
			Math.max(quantity - thing.bought, 0)
		);
		if (target > thing.onGroceries + TOLERANCE) {
			allocate(householdId, row, target - thing.onGroceries, now);
		} else if (target < thing.onGroceries - TOLERANCE) {
			const open = allocations(householdId, eq(partyAllocations.partyItemId, partyItemId), false);
			let excess = thing.onGroceries - target;
			const parts: [Allocation, number][] = [];
			for (const allocation of open.reverse()) {
				if (excess <= TOLERANCE) break;
				const part = Math.min(excess, allocation.quantity);
				parts.push([allocation, part]);
				excess -= part;
			}
			release(parts);
		}
	});
}

/** Takes what's on Groceries for these party items off Groceries. What was received stays. */
function releaseAll(householdId: number, where: SQL): void {
	const open = allocations(householdId, where, false);
	release(open.map((allocation) => [allocation, allocation.quantity]));
}

/** Takes something off its party list, and what's on Groceries for it off Groceries (6.15). */
export function removePartyItem(householdId: number, listId: number, partyItemId: number): void {
	transaction(() => {
		getPartyItemRow(householdId, listId, partyItemId);
		releaseAll(householdId, eq(partyAllocations.partyItemId, partyItemId));
		db().delete(partyItems).where(eq(partyItems.id, partyItemId)).run();
	});
}

/** Deletes a party list and its things, taking what's on Groceries for them off Groceries (6.15). */
export function deletePartyList(householdId: number, listId: number): void {
	transaction(() => {
		requireList(householdId, listId);
		releaseAll(householdId, eq(partyItems.partyListId, listId));
		db().delete(partyLists).where(eq(partyLists.id, listId)).run();
	});
}

/**
 * Puts what party items still need on Groceries, leaving out what's already there or bought (6.15).
 * Returns how many had something added. One that's no longer on the list is left out, as the page
 * that sent it may be out of date (6.11).
 */
export function addToGroceries(
	householdId: number,
	listId: number,
	partyItemIds: number[],
	now: number
): number {
	return transaction(() => {
		requireList(householdId, listId);
		const rows = selectPartyItems()
			.where(
				and(
					eq(partyItems.householdId, householdId),
					eq(partyItems.partyListId, listId),
					inArray(partyItems.id, partyItemIds)
				)
			)
			.all();
		let added = 0;
		for (const row of rows) {
			const { toAdd } = partyItem(row);
			if (toAdd === 0) continue;
			allocate(householdId, row, toAdd, now);
			added += 1;
		}
		return added;
	});
}

/**
 * Receives a party item's part of a line, as checking it off on its list does (6.15): the whole
 * line when that's all of it, or else a Received line split off for its part, leaving the rest of
 * the line as it was. A line without a store takes the one picked.
 */
function receivePart(
	householdId: number,
	line: GroceryLine,
	parts: Allocation[],
	storeId: number | undefined,
	now: number
): void {
	const store = storeForStatusChange(householdId, line, line.storeId === null ? storeId : undefined);
	const part = parts.reduce((sum, allocation) => sum + shareOf(allocation), 0);
	if (part >= line.quantity - TOLERANCE) {
		db()
			.update(groceryNeeds)
			.set({ status: 'received', storeId: store, receivedAt: now })
			.where(eq(groceryNeeds.id, line.id))
			.run();
	} else {
		const received = db()
			.insert(groceryNeeds)
			.values({
				householdId,
				itemId: line.itemId,
				quantity: part,
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
		db().update(groceryNeeds).set({ quantity: line.quantity - part }).where(eq(groceryNeeds.id, line.id)).run();
		db()
			.update(partyAllocations)
			.set({ needId: received.id })
			.where(inArray(partyAllocations.id, parts.map((allocation) => allocation.id)))
			.run();
	}
	if (line.status === 'to_order') setDefaultStore(householdId, line.itemId, store);
}

/**
 * Checks off a party item on its list (6.15). What's on Groceries for it is received there, and
 * whatever else it needs counts as bought on the list.
 */
export function markBought(
	householdId: number,
	listId: number,
	partyItemId: number,
	storeId: number | undefined,
	now: number
): void {
	transaction(() => {
		const row = getPartyItemRow(householdId, listId, partyItemId);
		const thing = partyItem(row);
		if (thing.done) error(400, `${thing.itemName} is already bought`);
		const open = allocations(householdId, eq(partyAllocations.partyItemId, partyItemId), false);
		for (const [needId, parts] of Map.groupBy(open, (allocation) => allocation.needId)) {
			receivePart(householdId, getLine(householdId, needId), parts, storeId, now);
		}
		db()
			.update(partyItems)
			.set({ boughtQuantity: row.boughtQuantity + thing.toAdd })
			.where(eq(partyItems.id, partyItemId))
			.run();
	});
}

/**
 * Puts a party item's part of a received line back as it was before, Ordered if it had been
 * ordered and otherwise To Order: the whole line when that's all of it, or else a line split off for
 * its part, leaving the rest of the line received (6.15).
 */
function unreceivePart(householdId: number, line: GroceryLine, parts: Allocation[], now: number): void {
	const status = line.orderedAt === null ? 'to_order' : 'ordered';
	const part = parts.reduce((sum, allocation) => sum + shareOf(allocation), 0);
	if (part >= line.quantity - TOLERANCE) {
		db()
			.update(groceryNeeds)
			.set({ status, receivedAt: null })
			.where(eq(groceryNeeds.id, line.id))
			.run();
		return;
	}
	const back = db()
		.insert(groceryNeeds)
		.values({
			householdId,
			itemId: line.itemId,
			quantity: part,
			unit: line.unit,
			storeId: line.storeId,
			status,
			note: line.note,
			createdAt: now,
			orderedAt: line.orderedAt
		})
		.returning({ id: groceryNeeds.id })
		.get();
	db().update(groceryNeeds).set({ quantity: line.quantity - part }).where(eq(groceryNeeds.id, line.id)).run();
	db()
		.update(partyAllocations)
		.set({ needId: back.id })
		.where(inArray(partyAllocations.id, parts.map((allocation) => allocation.id)))
		.run();
}

/**
 * Unchecks a bought party item (6.15). What Groceries received for it goes back on the list as it
 * was before, and nothing counts as bought on the list anymore.
 */
export function unmarkBought(
	householdId: number,
	listId: number,
	partyItemId: number,
	now: number
): void {
	transaction(() => {
		const thing = partyItem(getPartyItemRow(householdId, listId, partyItemId));
		if (!thing.done) error(400, `${thing.itemName} isn't bought yet`);
		const received = allocations(householdId, eq(partyAllocations.partyItemId, partyItemId), true);
		for (const [needId, parts] of Map.groupBy(received, (allocation) => allocation.needId)) {
			unreceivePart(householdId, getLine(householdId, needId), parts, now);
		}
		db().update(partyItems).set({ boughtQuantity: 0 }).where(eq(partyItems.id, partyItemId)).run();
	});
}
