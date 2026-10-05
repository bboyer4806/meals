import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { pantryChecklists, pantryMarks } from '../db/schema.ts';
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
	startOver,
	startRecipeChecklist,
	undoMark
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
		startRecipeChecklist(householdId, cake, 8, NOW);
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
			markedCount: 0
		});
		expect(getChecklistSummary(householdId)).toEqual({ markedCount: 0 });
	});

	it("scales by exactly 1 at the recipe's own servings", () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
		const factors = checklist().items.flatMap((item) => item.entries.map((entry) => entry.factor));
		expect(factors).toEqual([1, 1, 1, 1, 1]);
		startRecipeChecklist(householdId, cake, 3, NOW);
		expect(checklist().items[0]?.entries[0]?.factor).toBe(0.75);
	});

	it("shows each item's notes", () => {
		updateItem(householdId, itemId('Butter'), { name: 'Butter', notes: 'Unsalted', alwaysHave: false });
		startRecipeChecklist(householdId, cake, 4, NOW);
		expect(checklist().items[0]).toMatchObject({ itemName: 'Butter', itemNotes: 'Unsalted' });
	});

	it("lists a recipe with no ingredients so it isn't forgotten", () => {
		const rolls = makeDish(householdId, recipe('Rolls'));
		startRecipeChecklist(householdId, rolls, 4, NOW);
		expect(checklist()).toMatchObject({ items: [], noIngredients: ['Rolls'], markedCount: 0 });
	});

	it('works out the lines from the recipe as it is now (design 6.8)', () => {
		startRecipeChecklist(householdId, cake, 8, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
		expect(checklist().items).toHaveLength(4);
	});

	it('replaces the checklist and its marks, but not the lines Need added', () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
		markHave(householdId, itemId('Sugar'));
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		const pie = makeDish(
			householdId,
			recipe('Apple pie', { ingredients: [ingredient('Sugar', 1, 'cup'), ingredient('Apples', 6)] })
		);
		startRecipeChecklist(householdId, pie, 8, NOW);
		expect(checklist()).toMatchObject({
			source: { kind: 'recipe', dishId: pie, dishName: 'Apple pie', servings: 8 },
			markedCount: 0
		});
		expect(stateOf('Sugar')).toEqual({ kind: 'open' });
		expect(db().select().from(pantryChecklists).all()).toHaveLength(1);
		expect(db().select().from(pantryMarks).all()).toHaveLength(0);
		expect(lines().map((line) => line.itemName)).toEqual(['Eggs']);
	});

	it('keeps the current checklist and its marks when a new one fails to start', () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
		markHave(householdId, itemId('Sugar'));
		// Servings below 1 break a database rule after the old checklist is deleted.
		expect(() => startRecipeChecklist(householdId, cake, 0, NOW)).toThrow(/CHECK constraint failed/);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
		expect(checklist().items.map((item) => item.itemName)).toEqual(['Butter', 'Sugar', 'Eggs']);
		expectHttpError(() => markHave(householdId, itemId('Salt')), 400);
		expectHttpError(() => markNeed(householdId, itemId('Salt'), NOTE, NOW), 400);

		setAlwaysHave('Salt', false);
		expect(checklist().items.map((item) => item.itemName)).toEqual(['Butter', 'Sugar', 'Eggs', 'Salt']);
	});

	it("doesn't count a mark on an item that became Always have", () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, ice, 4, NOW);
		expect(checklist()).toMatchObject({ items: [], noIngredients: [] });
	});
});

describe('Have and Need', () => {
	it('marks an item Have, and undoes it', () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, cake, 8, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
		markNeed(householdId, itemId('Sugar'), NOTE, NOW);
		markNeed(householdId, itemId('Eggs'), NOTE, NOW);
		expect(lineFor('Sugar').storeId).toBeNull();
		expect(lineFor('Eggs').storeId).toBeNull();
	});

	it("follows the line's status, and undoing Need deletes only a line still To Order", () => {
		const walmart = makeStore(householdId, 'Walmart');
		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
		expect(stateOf('Sugar')).toEqual({ kind: 'onList', status: 'to_order' });
	});

	it('lets a mark win over a line added later', () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
		markHave(householdId, itemId('Butter'));
		addToList('Butter');
		expect(stateOf('Butter')).toEqual({ kind: 'have' });
	});

	it('refuses to mark an item twice', () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
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

		startRecipeChecklist(householdId, cake, 4, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
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

describe('households', () => {
	it("keeps each household's checklist to itself", () => {
		startRecipeChecklist(householdId, cake, 4, NOW);
		markHave(householdId, itemId('Sugar'));
		const other = makeHousehold(TZ);
		expect(getChecklist(other.householdId)).toBeNull();
		expect(getChecklistSummary(other.householdId)).toBeNull();
		expectHttpError(() => startRecipeChecklist(other.householdId, cake, 4, NOW), 404);

		const theirs = makeDish(
			other.householdId,
			recipe('Pound cake', { ingredients: [ingredient('Butter', 1, 'cup')] })
		);
		startRecipeChecklist(other.householdId, theirs, 2, NOW);
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
		startRecipeChecklist(householdId, cake, 4, NOW);
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
