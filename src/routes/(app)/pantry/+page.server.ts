import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { combineAmounts, needNote } from '#lib/checklist.ts';
import { MAX_SERVINGS } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	getChecklist,
	markHave,
	markNeed,
	startOver,
	startRecipeChecklist,
	undoMark
} from '#lib/server/data/pantry.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';

// The pantry check (design 6.8). It's worked out from the recipe each time the page loads, so
// recipe changes show up.
export function load({ locals }) {
	const user = requireHousehold(locals);
	const checklist = getChecklist(user.householdId);
	if (!checklist) return { checklist: null };
	const { source, noIngredients, markedCount } = checklist;
	return {
		checklist: {
			source,
			noIngredients,
			markedCount,
			items: checklist.items.map(({ itemId, itemName, itemNotes, entries, state }) => ({
				itemId,
				itemName,
				itemNotes,
				state,
				amounts: combineAmounts(entries)
			}))
		}
	};
}

const startSchema = z.object({
	dishId: id,
	servings: z.coerce
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(MAX_SERVINGS, `Enter ${MAX_SERVINGS} servings or fewer`)
});

const itemSchema = z.object({ itemId: id });

export const actions = {
	// The recipe page's Check pantry button posts here.
	start: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(startSchema, await request.formData(), 'start');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, servings } = parsed.data;
		startRecipeChecklist(user.householdId, dishId, servings, Date.now());
		redirect(303, '/pantry');
	},

	have: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(itemSchema, await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		return attempt('item', () => markHave(user.householdId, parsed.data.itemId));
	},

	need: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(itemSchema, await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		const { itemId } = parsed.data;
		return attempt('item', () => {
			// The grocery line's note comes from the checklist as it is now, never from the request.
			const item = getChecklist(user.householdId)?.items.find(
				(candidate) => candidate.itemId === itemId
			);
			// markNeed refuses an item that isn't open on the current checklist, with the reason,
			// so this note is never saved.
			const note = item ? needNote(combineAmounts(item.entries)) : '';
			markNeed(user.householdId, itemId, note, Date.now());
		});
	},

	undo: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(itemSchema, await request.formData(), 'item');
		if ('failure' in parsed) return parsed.failure;
		return attempt('item', () => undoMark(user.householdId, parsed.data.itemId));
	},

	startOver: ({ locals }) => {
		const user = requireHousehold(locals);
		return attempt('checklist', () => startOver(user.householdId));
	}
};
