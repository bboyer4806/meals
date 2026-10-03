import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import {
	addNeed,
	deleteLine,
	listActiveLines,
	markAllOrdered,
	markAllReceived,
	markDidntCome,
	markGotFewer,
	markOrdered,
	markReceived,
	undoReceived,
	updateLine,
	withLineChanges,
	type GroceryLine
} from '#lib/server/data/needs.ts';
import { listStores } from '#lib/server/data/stores.ts';
import { attempt, id, nameField, optionalText, parseForm, quantity } from '#lib/server/forms.ts';

type LineGroup = {
	key: string;
	storeId: number | null;
	name: string;
	toOrder: GroceryLine[];
	ordered: GroceryLine[];
	received: GroceryLine[];
};

function byItemName(a: GroceryLine, b: GroceryLine) {
	return a.itemName.localeCompare(b.itemName);
}

function group(key: string, storeId: number | null, name: string, lines: GroceryLine[]): LineGroup {
	const sorted = [...lines].sort(byItemName);
	return {
		key,
		storeId,
		name,
		toOrder: sorted.filter((line) => line.status === 'to_order'),
		ordered: sorted.filter((line) => line.status === 'ordered'),
		received: sorted.filter((line) => line.status === 'received')
	};
}

export function load({ locals }) {
	const user = requireHousehold(locals);
	const household = getHousehold(user.householdId);
	const stores = listStores(user.householdId);
	const lines = listActiveLines(user.householdId, household.timeZone, Date.now());

	// "No store" first, since those lines still need one; then each store by name.
	const groups: LineGroup[] = [];
	const noStore = lines.filter((line) => line.storeId === null);
	if (noStore.length > 0) groups.push(group('none', null, 'No store', noStore));
	for (const store of stores) {
		const storeLines = lines.filter((line) => line.storeId === store.id);
		if (storeLines.length > 0) groups.push(group(`store-${store.id}`, store.id, store.name, storeLines));
	}

	return {
		groups,
		stores,
		items: listPickerItems(user.householdId)
	};
}

const storeChoice = z.union([z.literal('usual'), z.literal('none'), id]);
// Checking off a line may name the store it was bought at; otherwise the line's own is used.
const statusStore = z
	.union([z.literal(''), z.literal('none'), id])
	.optional()
	.transform((value) => (typeof value === 'number' ? value : undefined));
const unit = optionalText(20);

const addSchema = z.object({
	itemName: nameField(80, 'an item'),
	quantity,
	unit,
	store: storeChoice,
	resolution: z.enum(['none', 'restore', 'update', 'add']).default('none')
});

// The edit sheet. Its status buttons submit the same fields, so they save the edits too.
const updateSchema = z.object({
	id,
	quantity,
	unit,
	store: z.union([z.literal('none'), id]),
	note: optionalText(200)
});

function sheetChanges(data: z.output<typeof updateSchema>) {
	const { quantity, unit, store, note } = data;
	return { quantity, unit, storeId: store === 'none' ? null : store, note };
}

export const actions = {
	add: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(addSchema, await request.formData(), 'add');
		if ('failure' in parsed) return parsed.failure;
		const input = parsed.data;
		return attempt('add', () => {
			const result = addNeed(user.householdId, input, Date.now());
			const asked = { itemName: input.itemName, unit: input.unit, store: String(input.store) };
			return result.kind === 'added' || result.kind === 'updated'
				? { action: 'add', done: true }
				: { action: 'add', prompt: { ...result, asked: { ...asked, quantity: input.quantity } } };
		});
	},

	receive: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id, store: statusStore }), await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		const { id: needId, store } = parsed.data;
		return attempt('line', () => markReceived(user.householdId, needId, store, Date.now()));
	},

	order: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(updateSchema, await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		const { id: needId } = parsed.data;
		return attempt('line', () =>
			withLineChanges(user.householdId, needId, sheetChanges(parsed.data), () =>
				markOrdered(user.householdId, needId, undefined, Date.now())
			)
		);
	},

	orderAll: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ storeId: id }), await request.formData(), 'group');
		if ('failure' in parsed) return parsed.failure;
		markAllOrdered(user.householdId, parsed.data.storeId, Date.now());
	},

	receiveAll: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ storeId: id }), await request.formData(), 'group');
		if ('failure' in parsed) return parsed.failure;
		markAllReceived(user.householdId, parsed.data.storeId, Date.now());
	},

	didntCome: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(updateSchema, await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		const { id: needId } = parsed.data;
		return attempt('line', () =>
			withLineChanges(user.householdId, needId, sheetChanges(parsed.data), () =>
				markDidntCome(user.householdId, needId)
			)
		);
	},

	gotFewer: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const schema = updateSchema.extend({ receivedQuantity: quantity });
		const parsed = parseForm(schema, await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		const { id: needId, receivedQuantity } = parsed.data;
		return attempt('line', () =>
			withLineChanges(user.householdId, needId, sheetChanges(parsed.data), () =>
				markGotFewer(user.householdId, needId, receivedQuantity, undefined, Date.now())
			)
		);
	},

	undoReceive: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		const { timeZone } = getHousehold(user.householdId);
		return attempt('line', () => undoReceived(user.householdId, parsed.data.id, timeZone, Date.now()));
	},

	update: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(updateSchema, await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		return attempt('line', () =>
			updateLine(user.householdId, parsed.data.id, sheetChanges(parsed.data))
		);
	},

	delete: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'line');
		if ('failure' in parsed) return parsed.failure;
		return attempt('line', () => deleteLine(user.householdId, parsed.data.id));
	}
};
