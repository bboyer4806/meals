import { error, isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { formatExact } from '../../amounts.ts';
import {
	DINNER_LABEL_MAX,
	DINNER_NOTE_MAX,
	DINNER_RESTAURANT_MAX,
	DINNER_TYPE_LABELS,
	DINNER_TYPES,
	DISH_ROLE_LABELS,
	DISH_ROLES,
	isDate,
	type DinnerType,
	type DishRole
} from '../../menu.ts';
import { MAX_SERVINGS } from '../../recipe-view.ts';
import { formatQuantity, joinAnd, normalizeName } from '../../text.ts';
import {
	addDinnerDish,
	clearDinner,
	getDay,
	MAX_DISH_NAME,
	removeDinnerDish,
	saveDinner,
	setDinnerDishRole,
	type Dinner
} from '../data/dinners.ts';
import {
	createDish,
	findDishByName,
	getDish,
	setDishArchived,
	updateDish,
	type DishInput,
	type DishSaveResult
} from '../data/dishes.ts';
import { getHousehold, updateHousehold } from '../data/households.ts';
import { getItem, setItemArchived, updateItem, type ItemNameResult } from '../data/items.ts';
import { addNeed, deleteLine, getLine, updateLine, type GroceryLine } from '../data/needs.ts';
import { completeRequest, listRequests, removeRequest } from '../data/requests.ts';
import {
	createStore,
	getStore,
	renameStore,
	setStoreArchived,
	type StoreNameResult
} from '../data/stores.ts';
import { householdSettings, id, nameField, optionalText, quantity, sentName } from '../forms.ts';
import { readRows, recipeDetailFields, type RecipeRow } from '../recipe-form.ts';

// The changes an AI assistant can propose (design 6.17). Each is checked with the same rules as
// the form that makes it, and made only through the data layer's own functions, so it keeps every
// rule they keep. There's no other way to change anything.

/** A field of a record as the confirmation page shows it. */
export type Field = { name: string; value: string };

/** What the confirmation page shows of a change (design 6.17). */
export type ChangePreview = {
	/** What it does, such as "Change a grocery line". */
	title: string;
	householdId: number;
	householdName: string;
	/** The record it changes, such as "Grocery line 12"; null for a new one. */
	record: string | null;
	/** The record as it was when proposed, which approving checks it still is. Empty for a new one. */
	current: Field[];
	/** What the change saves. */
	proposed: Field[];
};

/** A change looked up in the database as it is now: what it shows, and how to make it. */
export type PlannedChange = ChangePreview & { apply: (now: number) => void };

const householdId = id.describe('The household, from list_households');

/** Text that may be empty, sent as null. */
function nullableText(max: number) {
	return optionalText(max).nullable();
}

/** A record the change names, or an error saying which one wasn't found. */
function lookUp<T>(what: string, find: () => T): T {
	try {
		return find();
	} catch (e) {
		if (isHttpError(e, 404)) error(404, `${what} wasn't found`);
		throw e;
	}
}

function inHousehold(householdId: number): Pick<ChangePreview, 'householdId' | 'householdName'> {
	const household = lookUp(`Household ${householdId}`, () => getHousehold(householdId));
	return { householdId, householdName: household.name };
}

function shown(value: string | number | null): string {
	return value === null || value === '' ? 'None' : String(value);
}

function status(archived: boolean): Field {
	return { name: 'Status', value: archived ? 'Archived' : 'Active' };
}

function nameTaken(
	what: 'store' | 'item',
	name: string,
	result: StoreNameResult | ItemNameResult
): void {
	if (result.kind === 'saved') return;
	const article = what === 'item' ? 'An' : 'A';
	error(
		400,
		result.archived
			? `An archived ${what} is already called ${name}. Restore it instead.`
			: `${article} ${what} is already called ${name}.`
	);
}

// Households

const updateHouseholdChange = z.object({
	operation: z.literal('update_household'),
	householdId,
	name: householdSettings.shape.name,
	defaultServings: householdSettings.shape.defaultServings,
	timeZone: householdSettings.shape.timeZone.describe('An IANA time zone, such as America/Chicago')
});

function planUpdateHousehold(change: z.output<typeof updateHouseholdChange>): PlannedChange {
	const household = lookUp(`Household ${change.householdId}`, () =>
		getHousehold(change.householdId)
	);
	const fields = (settings: { name: string; defaultServings: number; timeZone: string }) => [
		{ name: 'Name', value: settings.name },
		{ name: 'Usual servings', value: String(settings.defaultServings) },
		{ name: 'Time zone', value: settings.timeZone }
	];
	return {
		title: "Change the household's settings",
		householdId: household.id,
		householdName: household.name,
		record: `Household ${household.id}`,
		current: fields(household),
		proposed: fields(change),
		apply: () =>
			updateHousehold(change.householdId, {
				name: change.name,
				defaultServings: change.defaultServings,
				timeZone: change.timeZone
			})
	};
}

// Stores

const storeName = nameField(40, 'a store name');

const createStoreChange = z.object({
	operation: z.literal('create_store'),
	householdId,
	name: storeName
});

function planCreateStore(change: z.output<typeof createStoreChange>): PlannedChange {
	return {
		title: 'Add a store',
		...inHousehold(change.householdId),
		record: null,
		current: [],
		proposed: [{ name: 'Name', value: change.name }],
		apply: () => nameTaken('store', change.name, createStore(change.householdId, change.name))
	};
}

const storeId = id.describe('The store, from list_stores');

function storeFields(householdId: number, id: number) {
	const store = lookUp(`Store ${id}`, () => getStore(householdId, id));
	return {
		record: `Store ${id}`,
		current: [{ name: 'Name', value: store.name }, status(store.archivedAt !== null)]
	};
}

const renameStoreChange = z.object({
	operation: z.literal('rename_store'),
	householdId,
	storeId,
	name: storeName
});

function planRenameStore(change: z.output<typeof renameStoreChange>): PlannedChange {
	return {
		title: 'Rename a store',
		...inHousehold(change.householdId),
		...storeFields(change.householdId, change.storeId),
		proposed: [{ name: 'Name', value: change.name }],
		apply: () =>
			nameTaken('store', change.name, renameStore(change.householdId, change.storeId, change.name))
	};
}

const setStoreArchivedChange = z.object({
	operation: z.literal('set_store_archived'),
	householdId,
	storeId,
	archived: z.boolean().describe('true archives the store, false restores it')
});

function planSetStoreArchived(change: z.output<typeof setStoreArchivedChange>): PlannedChange {
	return {
		title: change.archived ? 'Archive a store' : 'Restore a store',
		...inHousehold(change.householdId),
		...storeFields(change.householdId, change.storeId),
		proposed: [status(change.archived)],
		apply: (now) => setStoreArchived(change.householdId, change.storeId, change.archived, now)
	};
}

// Items

const itemId = id.describe('The item, from list_items');

function itemFields(householdId: number, id: number) {
	const item = lookUp(`Item ${id}`, () => getItem(householdId, id));
	return {
		record: `Item ${id}`,
		current: [
			{ name: 'Name', value: item.name },
			{ name: 'Notes', value: shown(item.notes) },
			status(item.archivedAt !== null)
		]
	};
}

const updateItemChange = z.object({
	operation: z.literal('update_item'),
	householdId,
	itemId,
	name: nameField(80, 'a name'),
	notes: nullableText(200).describe('Such as a brand or size, or null for none')
});

function planUpdateItem(change: z.output<typeof updateItemChange>): PlannedChange {
	return {
		title: 'Change an item',
		...inHousehold(change.householdId),
		...itemFields(change.householdId, change.itemId),
		proposed: [
			{ name: 'Name', value: change.name },
			{ name: 'Notes', value: shown(change.notes) }
		],
		apply: () => {
			const changes = { name: change.name, notes: change.notes };
			nameTaken('item', change.name, updateItem(change.householdId, change.itemId, changes));
		}
	};
}

const setItemArchivedChange = z.object({
	operation: z.literal('set_item_archived'),
	householdId,
	itemId,
	archived: z.boolean().describe('true archives the item, false restores it')
});

function planSetItemArchived(change: z.output<typeof setItemArchivedChange>): PlannedChange {
	return {
		title: change.archived ? 'Archive an item' : 'Restore an item',
		...inHousehold(change.householdId),
		...itemFields(change.householdId, change.itemId),
		proposed: [status(change.archived)],
		apply: (now) => setItemArchived(change.householdId, change.itemId, change.archived, now)
	};
}

// Grocery lines

const STATUS_LABELS: Record<GroceryLine['status'], string> = {
	to_order: 'To order',
	ordered: 'Ordered',
	received: 'Received'
};

function amountText(quantity: number, unit: string | null): string {
	return unit === null ? formatQuantity(quantity) : `${formatQuantity(quantity)} ${unit}`;
}

function storeText(householdId: number, store: number | null): string {
	if (store === null) return 'None';
	return lookUp(`Store ${store}`, () => getStore(householdId, store)).name;
}

const lineId = id.describe('The grocery line, from get_grocery_list');
const unit = nullableText(20).describe('Such as gal, lb or bags, or null for none');

function lineFields(householdId: number, id: number) {
	const line = lookUp(`Grocery line ${id}`, () => getLine(householdId, id));
	return {
		record: `Grocery line ${id}`,
		current: [
			{ name: 'Item', value: line.itemName },
			{ name: 'Amount', value: amountText(line.quantity, line.unit) },
			{ name: 'Store', value: shown(line.storeName) },
			{ name: 'Status', value: STATUS_LABELS[line.status] },
			{ name: 'Note', value: shown(line.note) }
		]
	};
}

const addGroceryLineChange = z.object({
	operation: z.literal('add_grocery_line'),
	householdId,
	itemName: nameField(80, 'an item').describe("The item's name. A new name adds the item."),
	quantity,
	unit,
	store: z
		.union([z.literal('usual'), z.literal('none'), id])
		.describe("A store id, usual for the item's usual store, or none")
});

function planAddGroceryLine(change: z.output<typeof addGroceryLineChange>): PlannedChange {
	const household = inHousehold(change.householdId);
	const store =
		change.store === 'usual'
			? "The item's usual store"
			: storeText(change.householdId, change.store === 'none' ? null : change.store);
	return {
		title: 'Add to the grocery list',
		...household,
		record: null,
		current: [],
		proposed: [
			{ name: 'Item', value: change.itemName },
			{ name: 'Amount', value: amountText(change.quantity, change.unit) },
			{ name: 'Store', value: store }
		],
		apply: (now) => {
			const { itemName, quantity, unit, store } = change;
			const result = addNeed(
				change.householdId,
				{ itemName, quantity, unit, store, resolution: 'none' },
				now
			);
			if (result.kind === 'archived') {
				error(400, `${result.itemName} is archived. Restore it before adding it to the list.`);
			}
			if (result.kind === 'duplicate') {
				const at = result.storeName === null ? '' : ` at ${result.storeName}`;
				const line = `${amountText(result.quantity, result.unit)}${at}, ${STATUS_LABELS[result.status]}`;
				error(400, `${result.itemName} is already on the grocery list (${line}).`);
			}
		}
	};
}

const updateGroceryLineChange = z.object({
	operation: z.literal('update_grocery_line'),
	householdId,
	lineId,
	quantity,
	unit,
	storeId: id.nullable().describe('A store id, or null for none'),
	note: nullableText(200).describe('Or null for none')
});

function planUpdateGroceryLine(change: z.output<typeof updateGroceryLineChange>): PlannedChange {
	return {
		title: 'Change a grocery line',
		...inHousehold(change.householdId),
		...lineFields(change.householdId, change.lineId),
		proposed: [
			{ name: 'Amount', value: amountText(change.quantity, change.unit) },
			{ name: 'Store', value: storeText(change.householdId, change.storeId) },
			{ name: 'Note', value: shown(change.note) }
		],
		apply: () => {
			const { quantity, unit, storeId, note } = change;
			updateLine(change.householdId, change.lineId, { quantity, unit, storeId, note });
		}
	};
}

const deleteGroceryLineChange = z.object({
	operation: z.literal('delete_grocery_line'),
	householdId,
	lineId
});

function planDeleteGroceryLine(change: z.output<typeof deleteGroceryLineChange>): PlannedChange {
	return {
		title: 'Delete a grocery line',
		...inHousehold(change.householdId),
		...lineFields(change.householdId, change.lineId),
		proposed: [],
		apply: () => deleteLine(change.householdId, change.lineId)
	};
}

// Recipes

const ingredientInput = z.object({
	section: z.string().nullable().describe('A heading, such as For the sauce, or null for none'),
	amount: z.string().nullable().describe('Such as 2, 1 1/2 or 0.25, or null for none'),
	unit: z.string().nullable().describe('Such as cup, tbsp, oz, lb or clove, or null for none'),
	item: z.string().describe('Such as Flour. A new name adds the item.'),
	prepNote: z.string().nullable().describe('Such as diced, or null for none')
});

/**
 * The editor's rows for the ingredients: a section heading wherever the section changes, then
 * each ingredient, labeled as the editor labels them.
 */
function editorRows(ingredients: z.output<typeof ingredientInput>[]) {
	const rows: { row: RecipeRow; label: string }[] = [];
	let section = '';
	for (const [index, ingredient] of ingredients.entries()) {
		const heading = ingredient.section ?? '';
		if (heading !== section) {
			rows.push({ row: { kind: 'section', heading }, label: `Section of ingredient ${index + 1}` });
			section = heading;
		}
		rows.push({
			row: {
				kind: 'ingredient',
				amount: ingredient.amount ?? '',
				unit: ingredient.unit ?? '',
				item: ingredient.item,
				prepNote: ingredient.prepNote ?? ''
			},
			label: `Ingredient ${index + 1}`
		});
	}
	return rows;
}

function asText(value: string | number | null): string {
	return value === null ? '' : String(value);
}

// Every field, so a change to a recipe never empties one by leaving it out. Checked as the recipe
// editor checks what it sends (recipe-form.ts).
const recipeInput = z
	.object({
		name: z.string(),
		servings: z.number(),
		prepMinutes: z.number().nullable().describe('Whole minutes, or null'),
		cookMinutes: z.number().nullable().describe('Whole minutes, or null'),
		tags: z.array(z.string()),
		ingredients: z.array(ingredientInput),
		steps: z.string().nullable().describe('One step per line, or null'),
		notes: z.string().nullable(),
		source: z.string().nullable().describe('A link or a book, or null'),
		calories: z.number().nullable().describe('Per serving, or null'),
		proteinG: z.number().nullable().describe('Grams per serving, or null'),
		carbsG: z.number().nullable().describe('Grams per serving, or null'),
		fatG: z.number().nullable().describe('Grams per serving, or null')
	})
	.transform((recipe, context): DishInput => {
		const fields = recipeDetailFields.safeParse({
			name: recipe.name,
			servings: String(recipe.servings),
			prepMinutes: asText(recipe.prepMinutes),
			cookMinutes: asText(recipe.cookMinutes),
			tags: recipe.tags.join(','),
			steps: asText(recipe.steps),
			notes: asText(recipe.notes),
			source: asText(recipe.source),
			calories: asText(recipe.calories),
			proteinG: asText(recipe.proteinG),
			carbsG: asText(recipe.carbsG),
			fatG: asText(recipe.fatG)
		});
		const rows = readRows(editorRows(recipe.ingredients));
		if (!fields.success) {
			for (const { path, message } of fields.error.issues) {
				context.addIssue({ code: 'custom', path, message });
			}
		}
		if ('problems' in rows) {
			for (const { message } of rows.problems) {
				context.addIssue({ code: 'custom', path: ['ingredients'], message });
			}
		}
		if (!fields.success || 'problems' in rows) return z.NEVER;
		return { ...fields.data, ingredients: rows.ingredients };
	});

function minutes(value: number | null): string {
	return value === null ? 'None' : `${value} min`;
}

function ingredientLines(ingredients: DishInput['ingredients']): string {
	const lines: string[] = [];
	let section: string | null = null;
	for (const ingredient of ingredients) {
		if (ingredient.section !== section && ingredient.section !== null) {
			lines.push(`${ingredient.section}:`);
		}
		section = ingredient.section;
		const amount = ingredient.amount === null ? [] : [formatExact(ingredient.amount)];
		const parts = [...amount, ...(ingredient.unit === null ? [] : [ingredient.unit])];
		const prep = ingredient.prepNote === null ? '' : `, ${ingredient.prepNote}`;
		lines.push([...parts, ingredient.itemName].join(' ') + prep);
	}
	return lines.join('\n');
}

function recipeFields(recipe: DishInput): Field[] {
	return [
		{ name: 'Name', value: recipe.name },
		{ name: 'Servings', value: String(recipe.servings) },
		{ name: 'Prep', value: minutes(recipe.prepMinutes) },
		{ name: 'Cook', value: minutes(recipe.cookMinutes) },
		{ name: 'Tags', value: shown(recipe.tags.join(', ')) },
		{ name: 'Ingredients', value: shown(ingredientLines(recipe.ingredients)) },
		{ name: 'Steps', value: shown(recipe.steps) },
		{ name: 'Notes', value: shown(recipe.notes) },
		{ name: 'Source', value: shown(recipe.source) },
		{ name: 'Calories', value: shown(recipe.calories) },
		{ name: 'Protein (g)', value: shown(recipe.proteinG) },
		{ name: 'Carbs (g)', value: shown(recipe.carbsG) },
		{ name: 'Fat (g)', value: shown(recipe.fatG) }
	];
}

/** Refuses a save that a recipe's name or archived items stopped (design 6.10). */
function recipeSaved(name: string, result: DishSaveResult): void {
	if (result.kind === 'taken') {
		error(
			400,
			result.archived
				? `An archived recipe is already called ${name}. Restore it instead.`
				: `A recipe is already called ${name}.`
		);
	}
	if (result.kind === 'archived') {
		const names = joinAnd(result.items.map((item) => item.name));
		error(
			400,
			result.items.length === 1
				? `${names} is archived. Restore it before using it in a recipe.`
				: `${names} are archived. Restore them before using them in a recipe.`
		);
	}
}

const recipeId = id.describe('The recipe, from list_recipes');

function recipeRecord(householdId: number, id: number) {
	const recipe = lookUp(`Recipe ${id}`, () => getDish(householdId, id));
	return {
		record: `Recipe ${id}`,
		current: [...recipeFields(recipe), status(recipe.archivedAt !== null)]
	};
}

const createRecipeChange = z.object({
	operation: z.literal('create_recipe'),
	householdId,
	recipe: recipeInput
});

function planCreateRecipe(change: z.output<typeof createRecipeChange>): PlannedChange {
	return {
		title: 'Add a recipe',
		...inHousehold(change.householdId),
		record: null,
		current: [],
		proposed: recipeFields(change.recipe),
		apply: (now) =>
			recipeSaved(change.recipe.name, createDish(change.householdId, change.recipe, null, [], now))
	};
}

const updateRecipeChange = z.object({
	operation: z.literal('update_recipe'),
	householdId,
	recipeId,
	recipe: recipeInput
});

function planUpdateRecipe(change: z.output<typeof updateRecipeChange>): PlannedChange {
	return {
		title: 'Change a recipe',
		...inHousehold(change.householdId),
		...recipeRecord(change.householdId, change.recipeId),
		proposed: recipeFields(change.recipe),
		// Its photo stays as it is.
		apply: (now) =>
			recipeSaved(
				change.recipe.name,
				updateDish(change.householdId, change.recipeId, change.recipe, 'keep', [], now)
			)
	};
}

const setRecipeArchivedChange = z.object({
	operation: z.literal('set_recipe_archived'),
	householdId,
	recipeId,
	archived: z.boolean().describe('true archives the recipe, false restores it')
});

function planSetRecipeArchived(change: z.output<typeof setRecipeArchivedChange>): PlannedChange {
	const recipe = lookUp(`Recipe ${change.recipeId}`, () =>
		getDish(change.householdId, change.recipeId)
	);
	return {
		title: change.archived ? 'Archive a recipe' : 'Restore a recipe',
		...inHousehold(change.householdId),
		record: `Recipe ${change.recipeId}`,
		current: [{ name: 'Name', value: recipe.name }, status(recipe.archivedAt !== null)],
		proposed: [status(change.archived)],
		apply: (now) => setDishArchived(change.householdId, change.recipeId, change.archived, now)
	};
}

// Dinners

const DATE_LABEL = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});

function dateLabel(date: string): string {
	return DATE_LABEL.format(new Date(`${date}T00:00:00Z`));
}

const date = z.string().refine(isDate, 'Enter a date as YYYY-MM-DD').describe('YYYY-MM-DD');
const dinnerId = id.describe('The dinner, from get_menu');

type DinnerFields = {
	type: DinnerType;
	label: string | null;
	restaurantName: string | null;
	servings: number;
	note: string | null;
	dishes: { name: string; role: DishRole }[];
};

function dinnerFields(dinner: DinnerFields): Field[] {
	const dishes = dinner.dishes.map((dish) => `${dish.name} (${DISH_ROLE_LABELS[dish.role]})`);
	return [
		{ name: 'Type', value: DINNER_TYPE_LABELS[dinner.type] },
		{ name: 'Label', value: shown(dinner.label) },
		{ name: 'Restaurant', value: shown(dinner.restaurantName) },
		{ name: 'Servings', value: String(dinner.servings) },
		{ name: 'Note', value: shown(dinner.note) },
		{ name: 'Dishes', value: shown(dishes.join(', ')) }
	];
}

function findDinner(householdId: number, date: string, id: number): Dinner {
	const dinner = getDay(householdId, date).find((candidate) => candidate.id === id);
	if (!dinner) error(404, `Dinner ${id} isn't on ${date}`);
	return dinner;
}

const saveDinnerChange = z.object({
	operation: z.literal('save_dinner'),
	householdId,
	date,
	dinnerId: dinnerId
		.nullable()
		.describe('The dinner to change, from get_menu, or null to plan a date that has none'),
	type: z
		.enum(DINNER_TYPES)
		.describe('cook: Cooking at home, eat_out: Eating out, going: Bringing a dish, leftovers'),
	servings: z
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(MAX_SERVINGS, `Enter ${MAX_SERVINGS} servings or fewer`),
	note: z
		.string()
		.transform((text) => text.replace(/\r\n?/g, '\n').trim())
		.pipe(z.string().max(DINNER_NOTE_MAX, `Keep the note under ${DINNER_NOTE_MAX} characters`))
		.transform((text) => (text === '' ? null : text))
		.nullable(),
	restaurantName: sentName(DINNER_RESTAURANT_MAX, 'the restaurant')
		.nullable()
		.describe('Only on eat_out, or null'),
	label: sentName(DINNER_LABEL_MAX, 'a label')
		.nullable()
		.describe('Needed only on a date with more than one dinner, or null'),
	dishes: z
		.array(
			z.object({ name: sentName(MAX_DISH_NAME, 'a dish name'), role: z.enum(DISH_ROLES) })
		)
		.max(20, 'Give a dinner up to 20 dishes')
		.describe(
			'Every dish the dinner has after the change, by recipe name; [] for none. A new name adds a recipe with no details.'
		)
});

function planSaveDinner(change: z.output<typeof saveDinnerChange>): PlannedChange {
	const household = inHousehold(change.householdId);
	const day = getDay(change.householdId, change.date);
	const dinner =
		change.dinnerId === null ? null : findDinner(change.householdId, change.date, change.dinnerId);
	if (dinner === null && day.length > 0) {
		error(400, `${change.date} already has a dinner. Send its dinnerId to change it.`);
	}
	return {
		title: dinner === null ? 'Plan a dinner' : 'Change a dinner',
		...household,
		record:
			dinner === null
				? `${dateLabel(change.date)}, not planned yet`
				: `Dinner ${dinner.id} on ${dateLabel(change.date)}`,
		current: dinner === null ? [] : dinnerFields(dinner),
		proposed: dinnerFields(change),
		apply: (now) => saveDinnerWithDishes(change, now)
	};
}

/**
 * Saves the dinner's fields as the dinner's page does, then makes its dishes exactly the ones
 * listed, as adding, removing and changing roles there would (6.9).
 */
function saveDinnerWithDishes(change: z.output<typeof saveDinnerChange>, now: number): void {
	const { householdId, date, type, label, restaurantName, note, servings } = change;
	const fields = { label, type, restaurantName, note, servings };
	const savedId = saveDinner(householdId, date, change.dinnerId, fields, now);
	const saved = findDinner(householdId, date, savedId);
	const wanted = change.dishes.map((dish) => ({
		...dish,
		found: findDishByName(householdId, normalizeName(dish.name))
	}));
	for (const dish of saved.dishes) {
		if (!wanted.some((other) => other.found?.id === dish.dishId)) {
			removeDinnerDish(householdId, date, savedId, dish.dishId, now);
		}
	}
	for (const dish of wanted) {
		const onDinner = saved.dishes.find((other) => other.dishId === dish.found?.id);
		if (onDinner) {
			if (onDinner.role !== dish.role) {
				setDinnerDishRole(householdId, date, savedId, onDinner.dishId, dish.role, now);
			}
			continue;
		}
		const added = addDinnerDish(householdId, date, savedId, { name: dish.name }, dish.role, now);
		if (added.kind === 'archived') {
			error(400, `${added.name} is archived. Restore it before adding it to a dinner.`);
		}
	}
}

const clearDinnerChange = z.object({
	operation: z.literal('clear_dinner'),
	householdId,
	date,
	dinnerId
});

function planClearDinner(change: z.output<typeof clearDinnerChange>): PlannedChange {
	const household = inHousehold(change.householdId);
	const dinner = findDinner(change.householdId, change.date, change.dinnerId);
	return {
		title: 'Clear a dinner',
		...household,
		record: `Dinner ${dinner.id} on ${dateLabel(change.date)}`,
		current: dinnerFields(dinner),
		proposed: [],
		apply: (now) => clearDinner(change.householdId, change.date, change.dinnerId, now)
	};
}

// Requests

const requestId = id.describe('An active request, from list_requests');

function requestFields(householdId: number, id: number) {
	const request = listRequests(householdId).find((candidate) => candidate.id === id);
	if (!request) error(404, `Request ${id} isn't an active request`);
	return {
		record: `Request ${id}`,
		current: [
			{ name: request.kind === 'dish' ? 'Dish' : 'Restaurant', value: request.name },
			{ name: 'Note', value: shown(request.note) },
			{ name: 'Asked by', value: request.askedBy }
		]
	};
}

const completeRequestChange = z.object({
	operation: z.literal('complete_request'),
	householdId,
	requestId
});

function planCompleteRequest(change: z.output<typeof completeRequestChange>): PlannedChange {
	return {
		title: 'Complete a request',
		...inHousehold(change.householdId),
		...requestFields(change.householdId, change.requestId),
		proposed: [],
		apply: (now) => completeRequest(change.householdId, change.requestId, now)
	};
}

const removeRequestChange = z.object({
	operation: z.literal('remove_request'),
	householdId,
	requestId
});

function planRemoveRequest(change: z.output<typeof removeRequestChange>): PlannedChange {
	return {
		title: 'Remove a request',
		...inHousehold(change.householdId),
		...requestFields(change.householdId, change.requestId),
		proposed: [],
		apply: () => removeRequest(change.householdId, change.requestId)
	};
}

/** Every change an assistant can propose, told apart by `operation`. */
export const changeSchema = z.discriminatedUnion('operation', [
	updateHouseholdChange,
	createStoreChange,
	renameStoreChange,
	setStoreArchivedChange,
	updateItemChange,
	setItemArchivedChange,
	addGroceryLineChange,
	updateGroceryLineChange,
	deleteGroceryLineChange,
	createRecipeChange,
	updateRecipeChange,
	setRecipeArchivedChange,
	saveDinnerChange,
	clearDinnerChange,
	completeRequestChange,
	removeRequestChange
]);

export type Change = z.output<typeof changeSchema>;

/**
 * Looks the change up in the database as it is now. Not found (404) when a record it names isn't
 * there, and refused (400) when it can't be made as asked.
 */
export function planChange(change: Change): PlannedChange {
	switch (change.operation) {
		case 'update_household':
			return planUpdateHousehold(change);
		case 'create_store':
			return planCreateStore(change);
		case 'rename_store':
			return planRenameStore(change);
		case 'set_store_archived':
			return planSetStoreArchived(change);
		case 'update_item':
			return planUpdateItem(change);
		case 'set_item_archived':
			return planSetItemArchived(change);
		case 'add_grocery_line':
			return planAddGroceryLine(change);
		case 'update_grocery_line':
			return planUpdateGroceryLine(change);
		case 'delete_grocery_line':
			return planDeleteGroceryLine(change);
		case 'create_recipe':
			return planCreateRecipe(change);
		case 'update_recipe':
			return planUpdateRecipe(change);
		case 'set_recipe_archived':
			return planSetRecipeArchived(change);
		case 'save_dinner':
			return planSaveDinner(change);
		case 'clear_dinner':
			return planClearDinner(change);
		case 'complete_request':
			return planCompleteRequest(change);
		case 'remove_request':
			return planRemoveRequest(change);
	}
}
