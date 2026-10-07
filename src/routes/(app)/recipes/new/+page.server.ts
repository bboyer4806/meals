import { redirect } from '@sveltejs/kit';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listDishTags } from '#lib/server/data/dishes.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { newRecipeValues, saveRecipe } from '#lib/server/recipe-form.ts';

export function load({ locals }) {
	const user = requireHousehold(locals);
	return {
		// A new recipe starts at the household's usual servings (design 7).
		values: newRecipeValues(getHousehold(user.householdId).defaultServings),
		tags: listDishTags(user.householdId),
		items: listPickerItems(user.householdId).map(({ id, name, timesAdded }) => ({
			id,
			name,
			timesAdded
		}))
	};
}

export const actions = {
	save: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const saved = await saveRecipe(user.householdId, null, await request.formData(), Date.now());
		if ('failure' in saved) return saved.failure;
		redirect(303, `/recipes/${saved.id}`);
	}
};
