import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { combineAmounts, needNote } from '../../checklist.ts';
import type { DinnerType, DishRole } from '../../menu.ts';
import { db } from '../db/index.ts';
import { dinnerDishes, dinners, pantryChecklists, pantryMarks } from '../db/schema.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDish,
	makeHousehold,
	makeStore,
	recipe
} from '../testing.ts';
import { setDishArchived, updateDish } from './dishes.ts';
import { createItem, findItemByName, listCatalog, setDefaultStore, updateItem } from './items.ts';
import {
	addNeed,
	deleteLine,
	listActiveLines,
	markOrdered,
	markReceived,
	type AddInput
} from './needs.ts';
import {
	getChecklist,
	getChecklistSummary,
	markHave,
	markNeed,
	startMenuChecklist,
	startOver,
	startRecipeChecklist,
	undoMark,
	type PantryEntry
} from './pantry.ts';
import { setStoreArchived } from './stores.ts';

const TZ = 'America/Chicago';
// Sat 2026-10-03 12:00 in Chicago.
const NOW = Date.UTC(2026, 9, 3, 17, 0);
const NOTE = 'For Pound cake';

let householdId: number;
// Serves 4, and uses butter twice.
let cake: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold(TZ));
	cake = makeDish(
		householdId,
		recipe('Pound cake', {
			servings: 4,
			ingredients: [
				ingredient('Butter', 1, 'cup', { section: 'For the cake' }),
				ingredient('Sugar', 2, 'cup', { section: 'For the cake' }),
				ingredient('Eggs', 4, null, { section: 'For the cake' }),
				ingredient('Salt', null, null, { section: 'For the cake' }),
				ingredient('Butter', 2, 'tbsp', { section: 'For the glaze' })
			]
		})
	);
});

function itemId(name: string, household = householdId): number {
	const item = findItemByName(household, name);
	if (!item) throw new Error(`No item called ${name}`);
	return item.id;
}

function checklist() {
	const current = getChecklist(householdId);
	if (!current) throw new Error('No checklist');
	return current;
}

function stateOf(name: string) {
	return checklist().items.find((item) => item.itemName === name)?.state;
}

function lines() {
	return listActiveLines(householdId, TZ, NOW);
}

function lineFor(name: string) {
	const line = lines().find((candidate) => candidate.itemName === name);
	if (!line) throw new Error(`${name} isn't on the list`);
	return line;
}

function addToList(itemName: string, input: Partial<AddInput> = {}) {
	const result = addNeed(
		householdId,
		{ itemName, quantity: 1, unit: null, store: 'usual', resolution: 'none', ...input },
		NOW
	);
	expect(result).toEqual({ kind: 'added' });
}

function setAlwaysHave(name: string, alwaysHave: boolean) {
	expect(updateItem(householdId, itemId(name), { name, notes: null, alwaysHave })).toEqual({
		kind: 'saved'
	});
}

/**
 * Puts a dinner and its dishes on the menu straight into the database, the way the dinner page
 * would (dinners.ts). Returns the dinner's id.
 */
function planDinner(
	date: string,
	type: DinnerType,
	dishList: [dishId: number, role: DishRole][] = [],
	servings = 4,
	household = householdId
): number {
	const { id } = db()
		.insert(dinners)
		.values({
			householdId: household,
			date,
			type,
			note: null,
			servings,
			createdAt: NOW,
			updatedAt: NOW
		})
		.returning({ id: dinners.id })
		.get();
	for (const [dishId, role] of dishList) {
		db().insert(dinnerDishes).values({ householdId: household, dinnerId: id, dishId, role }).run();
	}
	return id;
}

/** The message a person sees when a change is refused. */
function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		if (isHttpError(e, 400)) return e.body.message;
		throw e;
	}
	throw new Error('Nothing was refused');
}

describe('starting a checklist', () => {
	it('lists each item once, in recipe order, scaled to the servings', () => {
		expect(getChecklist(householdId)).toBeNull();
		expect(getChecklistSummary(householdId)).toBeNull();
		startRecipeChecklist(householdId, cake, 8, false, NOW);
		const item = (name: string, ...entries: [number | null, string | null][]) => ({
			itemId: itemId(name),
			itemName: name,
			itemNotes: null,
			entries: entries.map(([amount, unit]) => ({ amount, unit, factor: 2, source: 'Pound cake' })),
			state: { kind: 'open' }
		});
		expect(getChecklist(householdId)).toEqual({
			source: { kind: 'recipe', dishId: cake, dishName: 'Pound cake', servings: 8 },
			items: [
				item('Butter', [1, 'cup'], [2, 'tbsp']),
				item('Sugar', [2, 'cup']),
				item('Eggs', [4, null]),
				item('Salt', [null, null])
			],
			noIngredients: [],
			dishCount: 1,
			markedCount: 0
		});
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it("scales by exactly 1 at the recipe's own servings", () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		const factors = checklist().items.flatMap((item) => item.entries.map((entry) => entry.factor));
		expect(factors).toEqual([1, 1, 1, 1, 1]);
		startRecipeChecklist(householdId, cake, 3, false, NOW);
		expect(checklist().items[0]?.entries[0]?.factor).toBe(0.75);
	});

	it("shows each item's notes", () => {
		updateItem(householdId, itemId('Butter'), { name: 'Butter', notes: 'Unsalted', alwaysHave: false });
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		expect(checklist().items[0]).toMatchObject({ itemName: 'Butter', itemNotes: 'Unsalted' });
	});

	it("lists a recipe with no ingredients so it isn't forgotten", () => {
		const rolls = makeDish(householdId, recipe('Rolls'));
		startRecipeChecklist(householdId, rolls, 4, false, NOW);
		expect(checklist()).toMatchObject({
			items: [],
			noIngredients: ['Rolls'],
			dishCount: 1,
			markedCount: 0
		});
	});

	it('works out the lines from the recipe as it is now (design 6.8)', () => {
		startRecipeChecklist(householdId, cake, 8, false, NOW);
		markHave(householdId, itemId('Sugar'));
		const changed = recipe('Pound cake', {
			servings: 8,
			ingredients: [ingredient('Flour', 3, 'cup'), ingredient('Sugar', 2, 'cup')]
		});
		expect(updateDish(householdId, cake, changed, NOW)).toMatchObject({ kind: 'saved' });
		expect(checklist().items.map((item) => [item.itemName, item.entries[0]?.factor])).toEqual([
			['Flour', 1],
			['Sugar', 1]
		]);
		// Marks are kept per item, so Sugar is still checked.
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
	});

	it('works from an archived recipe', () => {
		setDishArchived(householdId, cake, true, NOW);
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		expect(checklist().items).toHaveLength(4);
	});

	it('replaces the checklist and its marks, but not the lines Need added', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		const pie = makeDish(
			householdId,
			recipe('Apple pie', { ingredients: [ingredient('Sugar', 1, 'cup'), ingredient('Apples', 6)] })
		);
		expect(startRecipeChecklist(householdId, pie, 8, true, NOW)).toBe('started');
		expect(checklist()).toMatchObject({
			source: { kind: 'recipe', dishId: pie, dishName: 'Apple pie', servings: 8 },
			markedCount: 0
		});
		expect(stateOf('Sugar')).toEqual({ kind: 'open' });
		expect(db().select().from(pantryChecklists).all()).toHaveLength(1);
		expect(db().select().from(pantryMarks).all()).toHaveLength(0);
		expect(lines().map((line) => line.itemName)).toEqual(['Eggs']);
	});

	it('only replaces a checklist with checked items when the person was asked (6.8)', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		// Nothing is checked yet, so there was nothing to ask.
		expect(startRecipeChecklist(householdId, cake, 8, false, NOW)).toBe('started');
		markHave(householdId, itemId('Sugar'));
		const pie = makeDish(householdId, recipe('Apple pie', { ingredients: [ingredient('Apples')] }));
		expect(startRecipeChecklist(householdId, pie, 4, false, NOW)).toBe('checked');
		expect(checklist()).toMatchObject({ source: { dishId: cake, servings: 8 }, markedCount: 1 });
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
	});

	it('keeps the current checklist and its marks when a new one fails to start', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		// Servings below 1 break a database rule after the old checklist is deleted.
		expect(() => startRecipeChecklist(householdId, cake, 0, true, NOW)).toThrow(
			/CHECK constraint failed/
		);
		expect(checklist()).toMatchObject({ source: { servings: 4 }, markedCount: 1 });
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
	});
});

describe('Always have (addition 2.2.1)', () => {
	it('leaves out items marked Always have, and brings them back when it is turned off', () => {
		setAlwaysHave('Salt', true);
		expect(listCatalog(householdId, false, '').map((item) => [item.name, item.alwaysHave])).toEqual([
			['Butter', false],
			['Eggs', false],
			['Salt', true],
			['Sugar', false]
		]);
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		expect(checklist().items.map((item) => item.itemName)).toEqual(['Butter', 'Sugar', 'Eggs']);
		expectHttpError(() => markHave(householdId, itemId('Salt')), 400);
		expectHttpError(() => markNeed(householdId, itemId('Salt'), NOTE, NOW), 400);

		setAlwaysHave('Salt', false);
		expect(checklist().items.map((item) => item.itemName)).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt']);
	});

	it("doesn't count a mark on an item that became Always have", () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Salt'));
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 1 });
		setAlwaysHave('Salt', true);
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
		setAlwaysHave('Salt', false);
		expect(stateOf('Salt')).toEqual({ kind: 'have' });
	});

	it('still counts a recipe of only Always have items as having ingredients', () => {
		const ice = makeDish(householdId, recipe('Ice', { ingredients: [ingredient('Water', 2, 'cup')] }));
		setAlwaysHave('Water', true);
		startRecipeChecklist(householdId, ice, 4, false, NOW);
		expect(checklist()).toMatchObject({ items: [], noIngredients: [], dishCount: 1 });
	});
});

describe('Have and Need', () => {
	it('marks an item Have, and undoes it', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 1 });
		expect(lines()).toHaveLength(0);
		undoMark(householdId, itemId('Sugar'));
		expect(stateOf('Sugar')).toEqual({ kind: 'open' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it('puts a Need on the list with quantity 1, the usual store and the note (Q4)', () => {
		const walmart = makeStore(householdId, 'Walmart');
		setDefaultStore(householdId, itemId('Butter'), walmart);
		startRecipeChecklist(householdId, cake, 8, false, NOW);
		markNeed(householdId, itemId('Butter'), '2 1/4 cups for Pound cake', NOW);
		expect(lines()).toHaveLength(1);
		const line = lineFor('Butter');
		expect(line).toMatchObject({
			quantity: 1,
			unit: null,
			storeId: walmart,
			status: 'to_order',
			note: '2 1/4 cups for Pound cake',
			orderedAt: null,
			receivedAt: null
		});
		expect(stateOf('Butter')).toEqual({ kind: 'need', needId: line.id, status: 'to_order' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 1 });
	});

	it('leaves the store empty when the item has none, or its store is archived (design 6.3)', () => {
		const aldi = makeStore(householdId, 'Aldi');
		setDefaultStore(householdId, itemId('Sugar'), aldi);
		setStoreArchived(householdId, aldi, true, NOW);
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markNeed(householdId, itemId('Sugar'), NOTE, NOW);
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		expect(lineFor('Sugar').storeId).toBeNull();
		expect(lineFor('Eggs').storeId).toBeNull();
	});

	it("follows the line's status, and undoing Need deletes only a line still To Order", () => {
		const walmart = makeStore(householdId, 'Walmart');
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		for (const name of ['Butter', 'Sugar', 'Eggs']) markNeed(householdId, itemId(name), NOTE, NOW);
		markOrdered(householdId, lineFor('Sugar').id, walmart, NOW);
		markReceived(householdId, lineFor('Eggs').id, walmart, NOW);
		expect(stateOf('Sugar')).toEqual({ kind: 'need', needId: lineFor('Sugar').id, status: 'ordered' });
		expect(stateOf('Eggs')).toEqual({ kind: 'need', needId: lineFor('Eggs').id, status: 'received' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 3 });

		// Still To Order: the line goes with the mark.
		undoMark(householdId, itemId('Butter'));
		expect(lines().map((line) => line.itemName).sort()).toEqual(['Eggs', 'Sugar']);
		expect(stateOf('Butter')).toEqual({ kind: 'open' });
		// Ordered: the line stays, so the item is already on the list.
		undoMark(householdId, itemId('Sugar'));
		expect(lineFor('Sugar').status).toBe('ordered');
		expect(stateOf('Sugar')).toEqual({ kind: 'onList', status: 'ordered' });
		// Received: the line stays as history, and the item can be checked again.
		undoMark(householdId, itemId('Eggs'));
		expect(lineFor('Eggs').status).toBe('received');
		expect(stateOf('Eggs')).toEqual({ kind: 'open' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it('clears the mark when the line Need added is deleted', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markNeed(householdId, itemId('Butter'), NOTE, NOW);
		deleteLine(householdId, lineFor('Butter').id);
		expect(db().select().from(pantryMarks).all()).toHaveLength(0);
		expect(stateOf('Butter')).toEqual({ kind: 'open' });
	});

	it('shows items already on the list, with nothing to do (design 6.8)', () => {
		const walmart = makeStore(householdId, 'Walmart');
		addToList('Butter');
		addToList('Sugar', { store: walmart });
		markOrdered(householdId, lineFor('Sugar').id, undefined, NOW);
		addToList('Eggs', { store: walmart });
		markReceived(householdId, lineFor('Eggs').id, undefined, NOW);
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		expect(stateOf('Butter')).toEqual({ kind: 'onList', status: 'to_order' });
		expect(stateOf('Sugar')).toEqual({ kind: 'onList', status: 'ordered' });
		// A received line isn't on the list anymore.
		expect(stateOf('Eggs')).toEqual({ kind: 'open' });
		expectHttpError(() => markHave(householdId, itemId('Butter')), 400);
		expectHttpError(() => markNeed(householdId, itemId('Sugar'), NOTE, NOW), 400);
		expect(lines()).toHaveLength(3);
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it('shows To Order for an item that is also ordered', () => {
		const walmart = makeStore(householdId, 'Walmart');
		addToList('Sugar', { store: walmart });
		markOrdered(householdId, lineFor('Sugar').id, undefined, NOW);
		addToList('Sugar', { resolution: 'add' });
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		expect(stateOf('Sugar')).toEqual({ kind: 'onList', status: 'to_order' });
	});

	it('lets a mark win over a line added later', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Butter'));
		addToList('Butter');
		expect(stateOf('Butter')).toEqual({ kind: 'have' });
	});

	it('refuses to mark an item twice', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		expectHttpError(() => markHave(householdId, itemId('Sugar')), 400);
		expectHttpError(() => markNeed(householdId, itemId('Sugar'), NOTE, NOW), 400);
		expectHttpError(() => markNeed(householdId, itemId('Eggs'), NOTE, NOW), 400);
		expectHttpError(() => markHave(householdId, itemId('Eggs')), 400);
		expect(lines()).toHaveLength(1);
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
	});

	it("says why an item can't be marked", () => {
		expect(refusal(() => markHave(householdId, itemId('Sugar')))).toBe('Start a pantry check first');
		expect(refusal(() => markNeed(householdId, itemId('Sugar'), NOTE, NOW))).toBe(
			'Start a pantry check first'
		);
		expect(refusal(() => undoMark(householdId, itemId('Sugar')))).toBe('Start a pantry check first');
		expect(refusal(() => startOver(householdId))).toBe('Start a pantry check first');

		startRecipeChecklist(householdId, cake, 4, false, NOW);
		const milk = createItem(householdId, 'Milk', NOW).id;
		expect(refusal(() => markHave(householdId, milk))).toBe("Milk isn't in this pantry check");
		expect(refusal(() => undoMark(householdId, itemId('Sugar')))).toBe("Sugar isn't checked");
		markHave(householdId, itemId('Sugar'));
		expect(refusal(() => markNeed(householdId, itemId('Sugar'), NOTE, NOW))).toBe(
			'Sugar is already checked'
		);
		addToList('Eggs');
		expect(refusal(() => markHave(householdId, itemId('Eggs')))).toBe('Eggs is already on the list');
		expect(lines()).toHaveLength(1);
	});

	it('starts over by clearing every mark, keeping the lines on the list', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		startOver(householdId);
		expect(checklist()).toMatchObject({ source: { dishId: cake, servings: 4 }, markedCount: 0 });
		expect(stateOf('Sugar')).toEqual({ kind: 'open' });
		// The line Need added stays, so Eggs shows as already on the list.
		expect(stateOf('Eggs')).toEqual({ kind: 'onList', status: 'to_order' });
		expect(lines().map((line) => line.itemName)).toEqual(['Eggs']);
	});
});

// The week of Sun Oct 4 to Sat Oct 10, 2026.
const SUN = '2026-10-04';
const MON = '2026-10-05';
const TUE = '2026-10-06';
const WED = '2026-10-07';
const THU = '2026-10-08';
const FRI = '2026-10-09';
const SAT = '2026-10-10';

describe('a pantry check from the menu', () => {
	// Serves 2.
	let sauce: number;

	beforeEach(() => {
		sauce = makeDish(
			householdId,
			recipe('Pan sauce', {
				servings: 2,
				ingredients: [ingredient('Shallots', 1), ingredient('Butter', 2, 'tbsp')]
			})
		);
	});

	function startWeek(replaceChecked = false) {
		return startMenuChecklist(householdId, SUN, SAT, replaceChecked, NOW);
	}

	function entry(amount: number | null, unit: string | null, factor: number, source: string) {
		return { amount, unit, factor, source };
	}

	function entriesOf(name: string): PantryEntry[] {
		const item = checklist().items.find((candidate) => candidate.itemName === name);
		if (!item) throw new Error(`${name} isn't on the check`);
		return item.entries;
	}

	function names() {
		return checklist().items.map((item) => item.itemName);
	}

	it("combines each item across the dinners, scaled to each dinner's servings (Q28)", () => {
		expect(getChecklist(householdId)).toBeNull();
		// Pound cake serves 4 and Pan sauce 2.
		planDinner(TUE, 'cook', [[cake, 'dessert']], 8);
		planDinner(THU, 'going', [[sauce, 'main']], 3);
		expect(startWeek()).toBe('started');
		const item = (name: string, ...entries: PantryEntry[]) => ({
			itemId: itemId(name),
			itemName: name,
			itemNotes: null,
			entries,
			state: { kind: 'open' }
		});
		expect(getChecklist(householdId)).toEqual({
			source: { kind: 'range', startDate: SUN, endDate: SAT },
			items: [
				item(
					'Butter',
					entry(1, 'cup', 2, 'Pound cake (Tue)'),
					entry(2, 'tbsp', 2, 'Pound cake (Tue)'),
					entry(2, 'tbsp', 1.5, 'Pan sauce (Thu)')
				),
				item('Sugar', entry(2, 'cup', 2, 'Pound cake (Tue)')),
				item('Eggs', entry(4, null, 2, 'Pound cake (Tue)')),
				item('Salt', entry(null, null, 2, 'Pound cake (Tue)')),
				item('Shallots', entry(1, null, 1.5, 'Pan sauce (Thu)'))
			],
			noIngredients: [],
			dishCount: 2,
			markedCount: 0
		});
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });

		// 2 cups and 4 tbsp of butter for the cake, and 3 tbsp for the sauce.
		const butter = combineAmounts(entriesOf('Butter'));
		expect(butter.totals).toEqual(['2 1/2 cups']);
		expect(butter.breakdown).toEqual([
			{ source: 'Pound cake (Tue)', amount: '2 cups' },
			{ source: 'Pound cake (Tue)', amount: '1/4 cup' },
			{ source: 'Pan sauce (Thu)', amount: '3 tbsp' }
		]);
	});

	it('lists a dish once for each dinner it is on', () => {
		planDinner(TUE, 'cook', [[cake, 'main']]);
		planDinner(FRI, 'cook', [[cake, 'main']], 2);
		startWeek();
		expect(entriesOf('Sugar')).toEqual([
			entry(2, 'cup', 1, 'Pound cake (Tue)'),
			entry(2, 'cup', 0.5, 'Pound cake (Fri)')
		]);
		expect(checklist().dishCount).toBe(2);
		expect(needNote(combineAmounts(entriesOf('Sugar')))).toBe(
			'3 cups for Pound cake (Tue), Pound cake (Fri)'
		);
	});

	it('lists items as they first come up: dinners by date, dishes by role, then as added', () => {
		// Made in this order so that neither dish ids nor names give the order on the dinner.
		const corn = makeDish(
			householdId,
			recipe('Corn', { ingredients: [ingredient('Corn', 4), ingredient('Butter', 1, 'tbsp')] })
		);
		const salad = makeDish(
			householdId,
			recipe('Salad', { ingredients: [ingredient('Lettuce', 1), ingredient('Oil', 2, 'tbsp')] })
		);
		const steak = makeDish(
			householdId,
			recipe('Steak', { ingredients: [ingredient('Beef', 2, 'lb')] })
		);
		const brownies = makeDish(
			householdId,
			recipe('Brownies', {
				ingredients: [ingredient('Chocolate', 8, 'oz'), ingredient('Sugar', 1, 'cup')]
			})
		);
		const lemonade = makeDish(
			householdId,
			recipe('Lemonade', { ingredients: [ingredient('Lemons', 6), ingredient('Sugar', 1, 'cup')] })
		);
		const chips = makeDish(
			householdId,
			recipe('Chips', { ingredients: [ingredient('Potatoes', 3), ingredient('Oil', 1, 'cup')] })
		);
		// Friday's dinner is planned before Wednesday's.
		planDinner(FRI, 'cook', [
			[salad, 'side'],
			[brownies, 'dessert'],
			[steak, 'main'],
			[corn, 'side']
		]);
		planDinner(WED, 'going', [
			[chips, 'other'],
			[lemonade, 'side']
		]);
		startWeek();
		expect(names()).toEqual([
			// Wednesday: Lemonade (side), then Chips (other).
			'Lemons',
			'Sugar',
			'Potatoes',
			'Oil',
			// Friday: Steak (main), Salad and Corn (sides, as added), then Brownies (dessert).
			'Beef',
			'Lettuce',
			'Corn',
			'Butter',
			'Chocolate'
		]);
		expect(entriesOf('Oil').map((use) => use.source)).toEqual(['Chips (Wed)', 'Salad (Fri)']);
		expect(entriesOf('Sugar').map((use) => use.source)).toEqual([
			'Lemonade (Wed)',
			'Brownies (Fri)'
		]);
		expect(checklist().dishCount).toBe(6);
	});

	it('covers the dates from start to end, both included, and only dinners with dishes (6.8)', () => {
		const salad = makeDish(
			householdId,
			recipe('Salad', { ingredients: [ingredient('Lettuce', 1)] })
		);
		const soup = makeDish(householdId, recipe('Soup', { ingredients: [ingredient('Leeks', 2)] }));
		const pie = makeDish(householdId, recipe('Pie', { ingredients: [ingredient('Apples', 6)] }));
		// The days before and after the check.
		planDinner('2026-10-03', 'cook', [[cake, 'main']]);
		planDinner('2026-10-11', 'cook', [[sauce, 'main']]);
		// Its first and last days.
		planDinner(SUN, 'cook', [[salad, 'main']]);
		planDinner(SAT, 'going', [[soup, 'main']]);
		// The data layer never keeps dishes on these types, but they wouldn't count if it did.
		planDinner(MON, 'eat_out', [[pie, 'main']]);
		planDinner(TUE, 'leftovers', [[cake, 'main']]);
		planDinner(WED, 'eat_out');
		startWeek();
		expect(names()).toEqual(['Lettuce', 'Leeks']);
		expect(checklist()).toMatchObject({ noIngredients: [], dishCount: 2 });
	});

	it('counts archived dishes that are still on a dinner (6.10)', () => {
		planDinner(TUE, 'cook', [[cake, 'main']]);
		setDishArchived(householdId, cake, true, NOW);
		startWeek();
		expect(names()).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt']);
	});

	it("lists dishes with no ingredients with their day, so they aren't forgotten (6.8)", () => {
		const rolls = makeDish(householdId, recipe('Rolls'));
		const bread = makeDish(householdId, recipe('Garlic bread'));
		// Only Always have items, so there's nothing to check but it has ingredients.
		const ice = makeDish(
			householdId,
			recipe('Ice', { ingredients: [ingredient('Water', 2, 'cup')] })
		);
		setAlwaysHave('Water', true);
		planDinner(TUE, 'cook', [
			[rolls, 'side'],
			[cake, 'main'],
			[ice, 'other']
		]);
		planDinner(MON, 'going', [[bread, 'other']]);
		planDinner(THU, 'cook', [[rolls, 'main']]);
		startWeek();
		expect(checklist()).toMatchObject({
			noIngredients: ['Garlic bread (Mon)', 'Rolls (Tue)', 'Rolls (Thu)'],
			dishCount: 5
		});
		expect(names()).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt']);
	});

	it('leaves out Always have items (addition 2.2.1)', () => {
		setAlwaysHave('Salt', true);
		setAlwaysHave('Shallots', true);
		planDinner(TUE, 'cook', [[cake, 'main']]);
		planDinner(THU, 'cook', [[sauce, 'main']]);
		startWeek();
		expect(names()).toEqual(['Butter', 'Sugar', 'Eggs']);
		expect(checklist().noIngredients).toEqual([]);
	});

	it('names the date instead of the weekday in a check longer than a week (assumption 4)', () => {
		const rolls = makeDish(householdId, recipe('Rolls'));
		planDinner(TUE, 'cook', [[cake, 'main']]);
		planDinner('2026-10-13', 'cook', [
			[sauce, 'main'],
			[rolls, 'side']
		]);
		expect(startMenuChecklist(householdId, SUN, '2026-10-17', false, NOW)).toBe('started');
		expect(checklist().source).toEqual({ kind: 'range', startDate: SUN, endDate: '2026-10-17' });
		expect(entriesOf('Butter').map((use) => use.source)).toEqual([
			'Pound cake (Oct 6)',
			'Pound cake (Oct 6)',
			'Pan sauce (Oct 13)'
		]);
		expect(checklist().noIngredients).toEqual(['Rolls (Oct 13)']);
	});

	it('says when nothing with dishes is planned', () => {
		planDinner(MON, 'eat_out');
		planDinner(TUE, 'leftovers');
		// A dinner with no dishes yet.
		planDinner(WED, 'cook');
		planDinner('2026-10-11', 'cook', [[cake, 'main']]);
		expect(startWeek()).toBe('started');
		expect(getChecklist(householdId)).toEqual({
			source: { kind: 'range', startDate: SUN, endDate: SAT },
			items: [],
			noIngredients: [],
			dishCount: 0,
			markedCount: 0
		});
	});

	it('works out the lines from the menu as it is now, keeping marks per item (6.8)', () => {
		const tuesday = planDinner(TUE, 'cook', [[cake, 'main']]);
		startWeek();
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);

		// A dinner planned after the check started shows up.
		planDinner(THU, 'cook', [[sauce, 'main']]);
		expect(names()).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt', 'Shallots']);
		// So do new servings.
		db().update(dinners).set({ servings: 2 }).where(eq(dinners.id, tuesday)).run();
		expect(entriesOf('Sugar')).toEqual([entry(2, 'cup', 0.5, 'Pound cake (Tue)')]);
		// Taking the cake off leaves its items out, but their marks stay for when they're back.
		db().delete(dinnerDishes).where(eq(dinnerDishes.dinnerId, tuesday)).run();
		expect(names()).toEqual(['Shallots', 'Butter']);
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
		db()
			.insert(dinnerDishes)
			.values({ householdId, dinnerId: tuesday, dishId: cake, role: 'main' })
			.run();
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
		expect(stateOf('Eggs')).toMatchObject({ kind: 'need', status: 'to_order' });
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 2 });
		// A dinner that becomes Eating out adds nothing.
		db().update(dinners).set({ type: 'eat_out' }).where(eq(dinners.id, tuesday)).run();
		expect(names()).toEqual(['Shallots', 'Butter']);
	});

	it('marks Have and Need, with a note that names each dish and day (6.8)', () => {
		const walmart = makeStore(householdId, 'Walmart');
		setDefaultStore(householdId, itemId('Butter'), walmart);
		planDinner(TUE, 'cook', [[cake, 'main']]);
		planDinner(THU, 'cook', [[sauce, 'main']], 2);
		startWeek();
		markHave(householdId, itemId('Sugar'));
		const note = needNote(combineAmounts(entriesOf('Butter')));
		// 1 cup and 2 tbsp for the cake, and 2 tbsp for the sauce.
		expect(note).toBe('1 1/4 cups for Pound cake (Tue), Pan sauce (Thu)');
		markNeed(householdId, itemId('Butter'), note, NOW);
		expect(lineFor('Butter')).toMatchObject({
			quantity: 1,
			unit: null,
			storeId: walmart,
			status: 'to_order',
			note
		});
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
		expect(stateOf('Butter')).toEqual({
			kind: 'need',
			needId: lineFor('Butter').id,
			status: 'to_order'
		});
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 2 });

		undoMark(householdId, itemId('Butter'));
		expect(lines()).toHaveLength(0);
		const lemons = createItem(householdId, 'Lemons', NOW).id;
		expect(refusal(() => markHave(householdId, lemons))).toBe("Lemons isn't in this pantry check");
		startOver(householdId);
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it('replaces a check from a recipe or the menu by the same rule (6.8)', () => {
		planDinner(TUE, 'cook', [[sauce, 'main']]);
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);

		// Checked items are only replaced when the person was asked.
		expect(startWeek()).toBe('checked');
		expect(checklist()).toMatchObject({ source: { kind: 'recipe', dishId: cake }, markedCount: 2 });
		expect(startWeek(true)).toBe('started');
		expect(checklist()).toMatchObject({
			source: { kind: 'range', startDate: SUN, endDate: SAT },
			markedCount: 0
		});
		expect(db().select().from(pantryChecklists).all()).toHaveLength(1);
		expect(db().select().from(pantryMarks).all()).toHaveLength(0);
		// The line Need added stays.
		expect(lines().map((line) => line.itemName)).toEqual(['Eggs']);

		// Nothing is checked, so a new range starts without asking.
		expect(startMenuChecklist(householdId, MON, FRI, false, NOW)).toBe('started');
		expect(checklist().source).toEqual({ kind: 'range', startDate: MON, endDate: FRI });
		markHave(householdId, itemId('Butter'));
		expect(startMenuChecklist(householdId, SUN, SAT, false, NOW)).toBe('checked');
		expect(startRecipeChecklist(householdId, cake, 4, false, NOW)).toBe('checked');
		expect(checklist()).toMatchObject({ source: { startDate: MON, endDate: FRI }, markedCount: 1 });
		expect(startRecipeChecklist(householdId, cake, 4, true, NOW)).toBe('started');
		expect(checklist()).toMatchObject({ source: { kind: 'recipe', dishId: cake }, markedCount: 0 });
	});

	it('covers 1 to 14 days, and says why it refuses other ranges', () => {
		planDinner(TUE, 'cook', [[cake, 'main']]);
		expect(startMenuChecklist(householdId, TUE, TUE, false, NOW)).toBe('started');
		expect(names()).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt']);
		expect(checklist().source).toEqual({ kind: 'range', startDate: TUE, endDate: TUE });
		expect(startMenuChecklist(householdId, SUN, '2026-10-17', false, NOW)).toBe('started');
		markHave(householdId, itemId('Sugar'));

		const refused = (start: string, end: string) =>
			refusal(() => startMenuChecklist(householdId, start, end, true, NOW));
		expect(refused(TUE, MON)).toBe('Pick an end date on or after the start date');
		expect(refused(SUN, '2026-10-18')).toBe('Pick 14 days or fewer');
		expect(refused('2026-12-25', '2027-01-08')).toBe('Pick 14 days or fewer');
		expect(refused('', SAT)).toBe('Pick a start date');
		expect(refused('2026-02-29', SAT)).toBe('Pick a start date');
		expect(refused(SUN, '2026-10-7')).toBe('Pick an end date');
		// The current check and its marks are kept.
		expect(checklist()).toMatchObject({
			source: { kind: 'range', startDate: SUN, endDate: '2026-10-17' },
			markedCount: 1
		});
	});

	it('keeps the current checklist and its marks when a new one fails to start', () => {
		planDinner(TUE, 'cook', [[cake, 'main']]);
		startWeek();
		markHave(householdId, itemId('Sugar'));
		// Servings below 1 break a database rule after the old checklist is deleted.
		expect(() => startRecipeChecklist(householdId, cake, 0, true, NOW)).toThrow(
			/CHECK constraint failed/
		);
		expect(checklist()).toMatchObject({ source: { kind: 'range' }, markedCount: 1 });
	});
});

describe('households', () => {
	it("keeps each household's menu to itself", () => {
		const other = makeHousehold(TZ);
		const theirs = makeDish(
			other.householdId,
			recipe('Tacos', {
				ingredients: [ingredient('Tortillas', 8), ingredient('Butter', 1, 'tbsp')]
			})
		);
		planDinner(TUE, 'cook', [[cake, 'main']]);
		planDinner(TUE, 'cook', [[theirs, 'main']], 4, other.householdId);
		planDinner(THU, 'cook', [[theirs, 'main']], 4, other.householdId);

		startMenuChecklist(householdId, SUN, SAT, false, NOW);
		expect(checklist()).toMatchObject({ dishCount: 1 });
		expect(checklist().items.map((item) => item.itemName)).toEqual([
			'Butter',
			'Sugar',
			'Eggs',
			'Salt'
		]);
		expect(getChecklist(other.householdId)).toBeNull();

		startMenuChecklist(other.householdId, SUN, SAT, false, NOW);
		expect(getChecklist(other.householdId)).toMatchObject({
			dishCount: 2,
			items: [
				{ itemName: 'Tortillas', itemId: itemId('Tortillas', other.householdId) },
				{ itemName: 'Butter', itemId: itemId('Butter', other.householdId) }
			]
		});
		// Their dishes can't go on this household's dinners.
		const mine = db().select().from(dinners).where(eq(dinners.householdId, householdId)).get()!;
		expect(() =>
			db()
				.insert(dinnerDishes)
				.values({ householdId, dinnerId: mine.id, dishId: theirs, role: 'side' })
				.run()
		).toThrow(/FOREIGN KEY/);
		expect(checklist()).toMatchObject({ dishCount: 1 });
	});

	it("keeps each household's checklist to itself", () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		markHave(householdId, itemId('Sugar'));
		const other = makeHousehold(TZ);
		expect(getChecklist(other.householdId)).toBeNull();
		expect(getChecklistSummary(other.householdId)).toBeNull();
		expectHttpError(() => startRecipeChecklist(other.householdId, cake, 4, false, NOW), 404);

		const theirs = makeDish(
			other.householdId,
			recipe('Pound cake', { ingredients: [ingredient('Butter', 1, 'cup')] })
		);
		startRecipeChecklist(other.householdId, theirs, 2, false, NOW);
		// This household's items aren't theirs to mark, even ones with the same name.
		expectHttpError(() => markHave(other.householdId, itemId('Butter')), 404);
		expectHttpError(() => markNeed(other.householdId, itemId('Butter'), NOTE, NOW), 404);
		expectHttpError(() => undoMark(other.householdId, itemId('Sugar')), 404);
		markNeed(other.householdId, itemId('Butter', other.householdId), NOTE, NOW);
		startOver(other.householdId);

		expect(checklist()).toMatchObject({ source: { dishId: cake }, markedCount: 1 });
		expect(stateOf('Sugar')).toEqual({ kind: 'have' });
		expect(stateOf('Butter')).toEqual({ kind: 'open' });
		expect(lines()).toHaveLength(0);
	});

	it('rejects checklists and marks that point at another household in the database itself', () => {
		startRecipeChecklist(householdId, cake, 4, false, NOW);
		const mine = db().select().from(pantryChecklists).get()!;
		const other = makeHousehold(TZ);
		const apples = createItem(other.householdId, 'Apples', NOW).id;
		addNeed(
			other.householdId,
			{ itemName: 'Apples', quantity: 1, unit: null, store: 'usual', resolution: 'none' },
			NOW
		);
		const theirLine = listActiveLines(other.householdId, TZ, NOW)[0]!.id;

		// Their checklist for this household's recipe.
		expect(() =>
			db()
				.insert(pantryChecklists)
				.values({ householdId: other.householdId, dishId: cake, servings: 4, createdAt: NOW })
				.run()
		).toThrow(/FOREIGN KEY/);
		// A mark on this household's checklist for their item.
		expect(() =>
			db()
				.insert(pantryMarks)
				.values({ householdId, checklistId: mine.id, itemId: apples, state: 'have' })
				.run()
		).toThrow(/FOREIGN KEY/);
		// A Need on this household's checklist pointing at their grocery line.
		expect(() =>
			db()
				.insert(pantryMarks)
				.values({
					householdId,
					checklistId: mine.id,
					itemId: itemId('Butter'),
					state: 'need',
					needId: theirLine
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});
});
