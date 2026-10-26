import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { findRecipe, schemaRecipeValues } from '#lib/recipe-schema.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listDishTags } from '#lib/server/data/dishes.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { parseForm } from '#lib/server/forms.ts';
import { newRecipeValues, saveRecipe } from '#lib/server/recipe-form.ts';
import { fetchPage, jsonLdBlocks } from '#lib/server/recipe-page.ts';

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

// Import from a link (design 7). The link becomes the recipe's source, so it has the source's
// limit.
const importForm = z.object({
	link: z
		.string()
		.trim()
		.max(500, 'Keep the link under 500 characters')
		.pipe(
			z.url({ protocol: /^https?$/, error: 'Enter a link that starts with http:// or https://' })
		)
});

const ACTION = 'import';
const NOT_OPENED = "Couldn't open that page. Check the link and try again.";
const NO_RECIPE = "Couldn't find a recipe on that page.";

export const actions = {
	save: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const saved = await saveRecipe(user.householdId, null, await request.formData(), Date.now());
		if ('failure' in saved) return saved.failure;
		redirect(303, `/recipes/${saved.id}`);
	},

	// Gives the editor's fields filled in from the page's recipe, and saves nothing.
	import: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(importForm, await request.formData(), ACTION);
		if ('failure' in parsed) return parsed.failure;
		const { link } = parsed.data;
		let html: string;
		try {
			html = await fetchPage(new URL(link));
		} catch (e) {
			console.error(`Couldn't open ${link} to import it:`, e);
			return fail(400, { action: ACTION, error: NOT_OPENED });
		}
		const recipe = findRecipe(jsonLdBlocks(html));
		if (!recipe) return fail(400, { action: ACTION, error: NO_RECIPE });
		// What the page leaves out stays as a new recipe starts.
		const start = newRecipeValues(getHousehold(user.householdId).defaultServings);
		return { action: ACTION, values: schemaRecipeValues(recipe, { ...start, source: link }) };
	}
};
