import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { menuSource } from '../../checklist.ts';
import {
	daysBetween,
	DINNER_TYPES,
	DISH_ROLES,
	hasDishes,
	isDate,
	MAX_CHECK_DAYS
} from '../../menu.ts';
import { db, transaction } from '../db/index.ts';
import {
	dinnerDishes,
	dinners,
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

// The pantry checklist (design 6.8), started from one recipe or from a range of menu dates.

/**
 * One ingredient row: its amount, the factor that scales it to the servings wanted (the
 * checklist's for a recipe, the dinner's from the menu), and the dish it's for.
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
	source:
		| { kind: 'recipe'; dishId: number; dishName: string; servings: number }
		| { kind: 'range'; startDate: string; endDate: string };
	/**
	 * One per item, without Always have items (2.2.1), in the order they first come up: the
	 * recipe's ingredient order, or the menu's dinners by date and their dishes by role.
	 */
	items: PantryItem[];
	/** Dishes with no ingredients, listed so they aren't forgotten ("Rolls (Tue)" on the menu). */
	noIngredients: string[];
	/**
	 * How many dishes it covers, counting a dish once for each dinner it's on, so the page can
	 * tell a range with nothing planned from one where every ingredient is Always have.
	 */
	dishCount: number;
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

/** One dish on the checklist: what scales its amounts, and how its lines name it. */
type DishUse = { dishId: number; factor: number; source: string };

// Eating out and Leftovers dinners add nothing (6.8).
const TYPES_WITH_DISHES = DINNER_TYPES.filter(hasDishes);

/**
 * The dishes on the dinners from startDate to endDate: by date, then by role, then in the order
 * they were added. Archived dishes count, since they're still on the dinner (6.10).
 */
function menuDishes(householdId: number, startDate: string, endDate: string): DishUse[] {
	const rows = db()
		.select({
			date: dinners.date,
			dinnerServings: dinners.servings,
			role: dinnerDishes.role,
			added: dinnerDishes.id,
			dishId: dishes.id,
			dishName: dishes.name,
			dishServings: dishes.servings
		})
		.from(dinners)
		.innerJoin(dinnerDishes, eq(dinnerDishes.dinnerId, dinners.id))
		.innerJoin(dishes, eq(dishes.id, dinnerDishes.dishId))
		.where(
			and(
				eq(dinners.householdId, householdId),
				eq(dishes.householdId, householdId),
				gte(dinners.date, startDate),
				lte(dinners.date, endDate),
				inArray(dinners.type, TYPES_WITH_DISHES)
			)
		)
		.all();
	rows.sort(
		(a, b) =>
			(a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
			DISH_ROLES.indexOf(a.role) - DISH_ROLES.indexOf(b.role) ||
			a.added - b.added
	);
	return rows.map((row) => ({
		dishId: row.dishId,
		// Each dinner has its own servings, and its recipes scale to them (Q28).
		factor: row.dinnerServings / row.dishServings,
		source: menuSource(row.dishName, row.date, startDate, endDate)
	}));
}

/** The checklist's source and the dishes it covers. Null only for a row the schema rules out. */
function checklistDishes(
	householdId: number,
	row: typeof pantryChecklists.$inferSelect
): { source: PantryChecklist['source']; uses: DishUse[] } | null {
	if (row.dishId !== null && row.servings !== null) {
		const dish = db()
			.select({ id: dishes.id, name: dishes.name, servings: dishes.servings })
			.from(dishes)
			.where(and(eq(dishes.id, row.dishId), eq(dishes.householdId, householdId)))
			.get();
		if (!dish) return null;
		return {
			source: { kind: 'recipe', dishId: dish.id, dishName: dish.name, servings: row.servings },
			uses: [{ dishId: dish.id, factor: row.servings / dish.servings, source: dish.name }]
		};
	}
	if (row.startDate === null || row.endDate === null) return null;
	return {
		source: { kind: 'range', startDate: row.startDate, endDate: row.endDate },
		uses: menuDishes(householdId, row.startDate, row.endDate)
	};
}

type IngredientRow = {
	itemId: number;
	itemName: string;
	itemNotes: string | null;
	alwaysHave: boolean;
	amount: number | null;
	unit: string | null;
};

/** Each dish's ingredients by position. A dish with none isn't in the map. */
function ingredientsByDish(householdId: number, dishIds: number[]): Map<number, IngredientRow[]> {
	const rows = db()
		.select({
			dishId: dishIngredients.dishId,
			itemId: items.id,
			itemName: items.name,
			itemNotes: items.notes,
			alwaysHave: items.alwaysHave,
			amount: dishIngredients.amount,
			unit: dishIngredients.unit
		})
		.from(dishIngredients)
		.innerJoin(items, eq(items.id, dishIngredients.itemId))
		.where(
			and(eq(dishIngredients.householdId, householdId), inArray(dishIngredients.dishId, dishIds))
		)
		.orderBy(asc(dishIngredients.position))
		.all();
	const byDish = new Map<number, IngredientRow[]>();
	for (const { dishId, ...row } of rows) {
		const list = byDish.get(dishId);
		if (list) list.push(row);
		else byDish.set(dishId, [row]);
	}
	return byDish;
}

/**
 * The checklist worked out from the recipe or the menu as it is now, so changes to either show
 * up (6.8).
 */
function buildChecklist(householdId: number): { id: number; checklist: PantryChecklist } | null {
	const row = checklistRow(householdId);
	if (!row) return null;
	const covered = checklistDishes(householdId, row);
	if (!covered) return null;
	const { source, uses } = covered;
	const ingredients = ingredientsByDish(householdId, [...new Set(uses.map((use) => use.dishId))]);

	// One line per item, even when several dishes use it, or one dish uses it twice (6.8).
	const byItem = new Map<number, Omit<PantryItem, 'state'>>();
	const noIngredients: string[] = [];
	for (const use of uses) {
		const rows = ingredients.get(use.dishId);
		if (!rows) {
			noIngredients.push(use.source);
			continue;
		}
		for (const ingredient of rows) {
			if (ingredient.alwaysHave) continue;
			const entry = {
				amount: ingredient.amount,
				unit: ingredient.unit,
				factor: use.factor,
				source: use.source
			};
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
	}

	const stateOf = itemStates(householdId, row.id, [...byItem.keys()]);
	const checklistItems = [...byItem.values()].map((item) => ({
		...item,
		state: stateOf(item.itemId)
	}));
	return {
		id: row.id,
		checklist: {
			source,
			items: checklistItems,
			noIngredients,
			dishCount: uses.length,
			markedCount: checklistItems.filter(
				(item) => item.state.kind === 'have' || item.state.kind === 'need'
			).length
		}
	};
}

/**
 * Replaces the household's checklist and its marks, inside the caller's transaction. Lines that
 * Need added stay on the list. A checklist with checked items is only replaced when the person
 * was asked (`replaceChecked`); otherwise nothing changes and it says 'checked' (6.8).
 */
function replaceChecklist(
	householdId: number,
	source: { dishId: number; servings: number } | { startDate: string; endDate: string },
	replaceChecked: boolean,
	now: number
): 'started' | 'checked' {
	if (!replaceChecked && (getChecklistSummary(householdId)?.markedCount ?? 0) > 0) {
		return 'checked';
	}
	// Its marks go with it (on delete cascade).
	db().delete(pantryChecklists).where(eq(pantryChecklists.householdId, householdId)).run();
	db()
		.insert(pantryChecklists)
		.values({ householdId, ...source, createdAt: now })
		.run();
	return 'started';
}

/** A checklist for one recipe at some servings. It replaces the current one (replaceChecklist). */
export function startRecipeChecklist(
	householdId: number,
	dishId: number,
	servings: number,
	replaceChecked: boolean,
	now: number
): 'started' | 'checked' {
	return transaction(() => {
		const dish = db()
			.select({ id: dishes.id })
			.from(dishes)
			.where(and(eq(dishes.id, dishId), eq(dishes.householdId, householdId)))
			.get();
		if (!dish) error(404, 'Not found');
		return replaceChecklist(householdId, { dishId, servings }, replaceChecked, now);
	});
}

/**
 * A checklist for the dinners from startDate to endDate, both included: 1 to MAX_CHECK_DAYS
 * days. It replaces the current one (replaceChecklist).
 */
export function startMenuChecklist(
	householdId: number,
	startDate: string,
	endDate: string,
	replaceChecked: boolean,
	now: number
): 'started' | 'checked' {
	if (!isDate(startDate)) error(400, 'Pick a start date');
	if (!isDate(endDate)) error(400, 'Pick an end date');
	const days = daysBetween(startDate, endDate) + 1;
	if (days < 1) error(400, 'Pick an end date on or after the start date');
	if (days > MAX_CHECK_DAYS) error(400, `Pick ${MAX_CHECK_DAYS} days or fewer`);
	return transaction(() =>
		replaceChecklist(householdId, { startDate, endDate }, replaceChecked, now)
	);
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
