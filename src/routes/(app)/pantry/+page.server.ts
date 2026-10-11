import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { combineAmounts, needNote } from '#lib/checklist.ts';
import { isDate } from '#lib/menu.ts';
import { MAX_SERVINGS } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	getChecklist,
	markHave,
	markNeed,
	startMenuChecklist,
	startOver,
	startRecipeChecklist,
	undoMark
} from '#lib/server/data/pantry.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';

// The pantry check (design 6.8). It's worked out from the recipe or the menu each time the page
// loads, so changes to either show up.
export function load({ locals }) {
	const user = requireHousehold(locals);
	const checklist = getChecklist(user.householdId);
	if (!checklist) return { checklist: null };
	const { source, noIngredients, dishCount, markedCount } = checklist;
	return {
		checklist: {
			source,
			noIngredients,
			dishCount,
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

// Sent when the recipe or menu page asked before replacing a check with checked items.
const replaceChecked = z
	.literal('1')
	.optional()
	.transform((value) => value === '1');

const startSchema = z.object({
	dishId: id,
	servings: z.coerce
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(MAX_SERVINGS, `Enter ${MAX_SERVINGS} servings or fewer`),
	replaceChecked
});

function dateField(message: string) {
	return z.string({ error: message }).refine(isDate, message);
}

const startMenuSchema = z.object({
	startDate: dateField('Pick a start date'),
	endDate: dateField('Pick an end date'),
	replaceChecked
});

const itemSchema = z.object({ itemId: id });

export const actions = {
	// The recipe page's Check pantry button posts here.
	start: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(startSchema, await request.formData(), 'start');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, servings, replaceChecked } = parsed.data;
		const started = startRecipeChecklist(
			user.householdId,
			dishId,
			servings,
			replaceChecked,
			Date.now()
		);
		if (started === 'checked') {
			// Someone checked items after the recipe page loaded, so it didn't ask. This page shows
			// their check under the message.
			return fail(400, {
				action: 'start',
				error:
					'Someone has checked items on this pantry check since you opened the recipe. To replace it, go back to the recipe and tap Check pantry again.'
			});
		}
		redirect(303, '/pantry');
	},

	// The menu's Check pantry sheet posts here. The data layer refuses a range that's backwards
	// or too long, with the reason.
	startMenu: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(startMenuSchema, await request.formData(), 'start');
		if ('failure' in parsed) return parsed.failure;
		const { startDate, endDate, replaceChecked } = parsed.data;
		const started = attempt('start', () =>
			startMenuChecklist(user.householdId, startDate, endDate, replaceChecked, Date.now())
		);
		if (started === 'checked') {
			// As for a recipe: someone checked items after the menu loaded, so it didn't ask.
			return fail(400, {
				action: 'start',
				error:
					'Someone has checked items on this pantry check since you opened the menu. To replace it, go back to the menu and tap Check pantry again.'
			});
		}
		if (started !== 'started') return started;
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
