import { error, redirect } from '@sveltejs/kit';
import { parseRecipeId } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getDish, setDishArchived } from '#lib/server/data/dishes.ts';

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
	}
};
