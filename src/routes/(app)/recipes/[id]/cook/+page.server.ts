import { error } from '@sveltejs/kit';
import { parseRecipeId } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getDish } from '#lib/server/data/dishes.ts';

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	const dishId = parseRecipeId(params.id);
	if (dishId === null) error(404, 'Not found');
	return { dish: getDish(user.householdId, dishId) };
}
