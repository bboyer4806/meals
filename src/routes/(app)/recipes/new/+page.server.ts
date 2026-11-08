import { redirect } from '@sveltejs/kit';
import { filledIn } from '#lib/recipe-schema.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listDishTags } from '#lib/server/data/dishes.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { newRecipeValues, saveRecipe } from '#lib/server/recipe-form.ts';
import { IMPORT_ACTION, importLink } from '#lib/server/recipe-link.ts';

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
	},

	// Import from a link (design 7) gives the editor's fields filled in from the page's recipe,
	// and what the page has more of than the editor takes, and saves nothing.
	import: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const imported = await importLink(await request.formData());
		if ('failure' in imported) return imported.failure;
		const { link, recipe } = imported;
		// What the page leaves out stays as a new recipe starts.
		const start = {
			...newRecipeValues(getHousehold(user.householdId).defaultServings),
			source: link
		};
		const values = filledIn(start, recipe.values);
		return { action: IMPORT_ACTION, values, leftOut: recipe.leftOut };
	}
};
