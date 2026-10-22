import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { parseRecipeId } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getDish, setDishArchived, setDishTried } from '#lib/server/data/dishes.ts';
import { attempt, parseForm } from '#lib/server/forms.ts';

// A checked box sends "on"; an unchecked one sends nothing.
const triedSchema = z.object({
	tried: z
		.literal('on')
		.optional()
		.transform((value) => value !== undefined)
});

function dishIdIn(params: { id: string }): number {
	const dishId = parseRecipeId(params.id);
	if (dishId === null) error(404, 'Not found');
	return dishId;
}

// The page reads ?servings= itself, so changing the servings loads nothing.
export function load({ locals, params }) {
	const user = requireHousehold(locals);
	return { dish: getDish(user.householdId, dishIdIn(params)) };
}

// Both go back to the recipe; the editor's "Restore it" button posts here too.
export const actions = {
	archive: ({ locals, params }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		setDishArchived(user.householdId, dishId, true, Date.now());
		redirect(303, `/recipes/${dishId}`);
	},

	restore: ({ locals, params }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		setDishArchived(user.householdId, dishId, false, Date.now());
		redirect(303, `/recipes/${dishId}`);
	},

	// Saved as soon as the box is tapped (section 7, "Recipe").
	tried: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		const parsed = parseForm(triedSchema, await request.formData(), 'tried');
		if ('failure' in parsed) return parsed.failure;
		return attempt('tried', () => setDishTried(user.householdId, dishId, parsed.data.tried));
	}
};
