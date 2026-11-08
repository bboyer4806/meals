import { error, redirect } from '@sveltejs/kit';
import type { LinkValues } from '#lib/recipe-schema.ts';
import { parseRecipeId } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getDish, listDishTags } from '#lib/server/data/dishes.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { recipeValues, saveRecipe } from '#lib/server/recipe-form.ts';
import { IMPORT_ACTION, importLink } from '#lib/server/recipe-link.ts';

function dishIdIn(params: { id: string }): number {
	const dishId = parseRecipeId(params.id);
	if (dishId === null) error(404, 'Not found');
	return dishId;
}

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	// Not found for another household's recipe, as is saving over it.
	const dish = getDish(user.householdId, dishIdIn(params));
	return {
		dish: { id: dish.id, name: dish.name, photoKey: dish.photoKey },
		values: recipeValues(dish),
		tags: listDishTags(user.householdId),
		items: listPickerItems(user.householdId).map(({ id, name, timesAdded }) => ({
			id,
			name,
			timesAdded
		}))
	};
}

export const actions = {
	save: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		// Not found before anything is read or stored, whatever the form holds.
		getDish(user.householdId, dishId);
		const saved = await saveRecipe(user.householdId, dishId, await request.formData(), Date.now());
		if ('failure' in saved) return saved.failure;
		redirect(303, `/recipes/${saved.id}`);
	},

	// Import from a link (design 7; MEA-264) gives each field the page's recipe has, null for each
	// it has none of, with the link as its source, and what the page has more of than the editor
	// takes. It saves nothing: the page compares it with the editor and asks what to replace.
	import: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		// Not found for another household's recipe, before the page is fetched.
		getDish(user.householdId, dishIdIn(params));
		const imported = await importLink(await request.formData());
		if ('failure' in imported) return imported.failure;
		const { link, recipe } = imported;
		const values: LinkValues = { ...recipe.values, source: link };
		return { action: IMPORT_ACTION, values, leftOut: recipe.leftOut };
	}
};
