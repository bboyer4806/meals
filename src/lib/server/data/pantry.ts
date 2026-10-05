import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, transaction } from '../db/index.ts';
import {
	dishes,
	dishIngredients,
	groceryNeeds,
	items,
	pantryChecklists,
	pantryMarks,
	type NeedStatus
} from '../db/schema.ts';
import { getItem } from './items.ts';
import { addToOrderLine, deleteLineIfToOrder } from './needs.ts';

// The pantry checklist (design 6.8). Phase 2 starts one from a single recipe; checklists for a
// range of menu dates come with the menu in Phase 3.

/**
 * One ingredient row: its amount, the factor that scales it to the checklist's servings, and
 * the dish it's for.
 */
export type PantryEntry = {
	amount: number | null;
	unit: string | null;
	factor: number;
	source: string;
};

export type PantryState =
	| { kind: 'open' }
	| { kind: 'have' }
	// Need made this line; status is the line's current one.
	| { kind: 'need'; needId: number; status: NeedStatus }
	// The item was already on the list, so there's nothing to do.
	| { kind: 'onList'; status: 'to_order' | 'ordered' };

export type PantryItem = {
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	entries: PantryEntry[];
	state: PantryState;
};

export type PantryChecklist = {
	source: { kind: 'recipe'; dishId: number; dishName: string; servings: number };
	/** In the recipe's ingredient order, one per item, without Always have items (2.2.1). */
	items: PantryItem[];
	/** Dishes with no ingredients, listed so they aren't forgotten. */
	noIngredients: string[];
	/** Items marked Have or Need. */
	markedCount: number;
};

function checklistRow(householdId: number) {
	return db()
		.select()
		.from(pantryChecklists)
		.where(eq(pantryChecklists.householdId, householdId))
		.get();
}

/** A mark wins; otherwise a To Order or Ordered line means the item is already on the list. */
function itemStates(
	householdId: number,
	checklistId: number,
	itemIds: number[]
): (itemId: number) => PantryState {
	const lines = db()
		.select({ itemId: groceryNeeds.itemId, status: groceryNeeds.status })
		.from(groceryNeeds)
		.where(
			and(
				eq(groceryNeeds.householdId, householdId),
				inArray(groceryNeeds.itemId, itemIds),
				inArray(groceryNeeds.status, ['to_order', 'ordered'])
			)
		)
		.all();
	const withStatus = (status: NeedStatus) =>
		new Set(lines.filter((line) => line.status === status).map((line) => line.itemId));
	const toOrder = withStatus('to_order');
	const ordered = withStatus('ordered');

	const marks = new Map<number, PantryState>();
	const markRows = db()
		.select({
			itemId: pantryMarks.itemId,
			state: pantryMarks.state,
			needId: pantryMarks.needId,
			status: groceryNeeds.status
		})
		.from(pantryMarks)
		.leftJoin(groceryNeeds, eq(groceryNeeds.id, pantryMarks.needId))
		.where(eq(pantryMarks.checklistId, checklistId))
		.all();
	for (const mark of markRows) {
		if (mark.state === 'have') {
			marks.set(mark.itemId, { kind: 'have' });
		} else if (mark.needId !== null && mark.status !== null) {
			// Always true for a Need: deleting its line deletes the mark.
			marks.set(mark.itemId, { kind: 'need', needId: mark.needId, status: mark.status });
		}
	}

	return (itemId) => {
		const mark = marks.get(itemId);
		if (mark) return mark;
		// A To Order line is still to be bought, whatever was ordered before.
		if (toOrder.has(itemId)) return { kind: 'onList', status: 'to_order' };
		if (ordered.has(itemId)) return { kind: 'onList', status: 'ordered' };
		return { kind: 'open' };
	};
}

/** The checklist worked out from the recipe as it is now, so recipe changes show up (6.8). */
function buildChecklist(householdId: number): { id: number; checklist: PantryChecklist } | null {
	const row = checklistRow(householdId);
	// A checklist for a range of menu dates can't exist until Phase 3.
	if (!row || row.dishId === null || row.servings === null) return null;
	const dish = db()
		.select({ id: dishes.id, name: dishes.name, servings: dishes.servings })
		.from(dishes)
		.where(and(eq(dishes.id, row.dishId), eq(dishes.householdId, householdId)))
		.get();
	if (!dish) return null;
	const factor = row.servings / dish.servings;

	const ingredients = db()
		.select({
			itemId: items.id,
			itemName: items.name,
			itemNotes: items.notes,
			alwaysHave: items.alwaysHave,
			amount: dishIngredients.amount,
			unit: dishIngredients.unit
		})
		.from(dishIngredients)
		.innerJoin(items, eq(items.id, dishIngredients.itemId))
		.where(and(eq(dishIngredients.householdId, householdId), eq(dishIngredients.dishId, dish.id)))
		.orderBy(asc(dishIngredients.position))
		.all();

	// One line per item, even when the recipe uses it twice (6.8).
	const byItem = new Map<number, Omit<PantryItem, 'state'>>();
	for (const ingredient of ingredients) {
		if (ingredient.alwaysHave) continue;
		const entry = { amount: ingredient.amount, unit: ingredient.unit, factor, source: dish.name };
		const item = byItem.get(ingredient.itemId);
		if (item) {
			item.entries.push(entry);
		} else {
			byItem.set(ingredient.itemId, {
				itemId: ingredient.itemId,
				itemName: ingredient.itemName,
				itemNotes: ingredient.itemNotes,
				entries: [entry]
			});
		}
	}

	const stateOf = itemStates(householdId, row.id, [...byItem.keys()]);
	const checklistItems = [...byItem.values()].map((item) => ({
		...item,
		state: stateOf(item.itemId)
	}));
	return {
		id: row.id,
		checklist: {
			source: { kind: 'recipe', dishId: dish.id, dishName: dish.name, servings: row.servings },
			items: checklistItems,
			noIngredients: ingredients.length === 0 ? [dish.name] : [],
			markedCount: checklistItems.filter(
				(item) => item.state.kind === 'have' || item.state.kind === 'need'
			).length
		}
	};
}

/** Replaces the household's checklist and its marks. Lines that Need added stay on the list. */
export function startRecipeChecklist(
	householdId: number,
	dishId: number,
	servings: number,
	now: number
): void {
	transaction(() => {
		const dish = db()
			.select({ id: dishes.id })
			.from(dishes)
			.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
			.get();
		if (!dish) error(404, 'Not found');
		// Its marks go with it (on delete cascade).
		db().delete(pantryChecklists).where(eq(pantryChecklists.householdId, householdId)).run();
		db().insert(pantryChecklists).values({ householdId, dishId, servings, createdAt: now }).run();
	});
}

export function getChecklist(householdId: number): PantryChecklist | null {
	return buildChecklist(householdId)?.checklist ?? null;
}

/** For asking before a new checklist replaces one with marks. */
export function getChecklistSummary(householdId: number): { markedCount: number } | null {
	const checklist = getChecklist(householdId);
	return checklist ? { markedCount: checklist.markedCount } : null;
}

/** Have and Need are for items on the current checklist that nobody has dealt with yet. */
function requireOpenItem(householdId: number, itemId: number): number {
	const { name } = getItem(householdId, itemId);
	const current = buildChecklist(householdId);
	if (!current) error(400, 'Start a pantry check first');
	const item = current.checklist.items.find((candidate) => candidate.itemId === itemId);
	if (!item) error(400, `${name} isn't in this pantry check`);
	if (item.state.kind === 'onList') error(400, `${name} is already on the list`);
	if (item.state.kind !== 'open') error(400, `${name} is already checked`);
	return current.id;
}

export function markHave(householdId: number, itemId: number): void {
	transaction(() => {
		const checklistId = requireOpenItem(householdId, itemId);
		db().insert(pantryMarks).values({ householdId, checklistId, itemId, state: 'have' }).run();
	});
}

/**
 * Puts the item on the list right away (Q4): quantity 1, no unit, its usual store unless that
 * store is archived, and the note (such as "1 1/8 cups for Pound cake"). Then marks it Need.
 */
export function markNeed(householdId: number, itemId: number, note: string, now: number): void {
	transaction(() => {
		const checklistId = requireOpenItem(householdId, itemId);
		const needId = addToOrderLine(householdId, itemId, { quantity: 1, unit: null, note }, now);
		db()
			.insert(pantryMarks)
			.values({ householdId, checklistId, itemId, state: 'need', needId })
			.run();
	});
}

/** Undoing Need deletes its line if it's still To Order (6.8). Either way the mark goes. */
export function undoMark(householdId: number, itemId: number): void {
	transaction(() => {
		const { name } = getItem(householdId, itemId);
		const checklist = checklistRow(householdId);
		if (!checklist) error(400, 'Start a pantry check first');
		const mark = db()
			.select({ id: pantryMarks.id, needId: pantryMarks.needId })
			.from(pantryMarks)
			.where(and(eq(pantryMarks.checklistId, checklist.id), eq(pantryMarks.itemId, itemId)))
			.get();
		if (!mark) error(400, `${name} isn't checked`);
		db().delete(pantryMarks).where(eq(pantryMarks.id, mark.id)).run();
		if (mark.needId !== null) deleteLineIfToOrder(householdId, mark.needId);
	});
}

/** "Start over" clears every mark. Lines that Need added stay on the list. */
export function startOver(householdId: number): void {
	const checklist = checklistRow(householdId);
	if (!checklist) error(400, 'Start a pantry check first');
	db().delete(pantryMarks).where(eq(pantryMarks.checklistId, checklist.id)).run();
}
