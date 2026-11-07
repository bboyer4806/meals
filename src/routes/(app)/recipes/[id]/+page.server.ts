import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { parseRecipeId } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	getDish,
	getOwnRating,
	listDishRatings,
	rateDish,
	setDishArchived,
	setDishTried
} from '#lib/server/data/dishes.ts';
import { hasRequest, requestDish } from '#lib/server/data/requests.ts';
import { attempt, parseForm } from '#lib/server/forms.ts';

// A checked box sends "on"; an unchecked one sends nothing.
const triedSchema = z.object({
	tried: z
		.literal('on')
		.optional()
		.transform((value) => value !== undefined)
});

// 1 to 5 stars, or none, which clears them.
const rateSchema = z.object({
	stars: z.union([z.literal('').transform(() => null), z.coerce.number().int().min(1).max(5)])
});

function dishIdIn(params: { id: string }): number {
	const dishId = parseRecipeId(params.id);
	if (dishId === null) error(404, 'Not found');
	return dishId;
}

// The page reads ?servings= itself, so changing the servings loads nothing.
export function load({ locals, params }) {
	const user = requireHousehold(locals);
	const dishId = dishIdIn(params);
	return {
		dish: getDish(user.householdId, dishId),
		ownRating: getOwnRating(user.householdId, dishId, user.id),
		ratings: listDishRatings(user.householdId, dishId),
		requested: hasRequest(user.householdId, dishId)
	};
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
	},

	// Saved as soon as a star is tapped. Each star sends its stars, or none from the one shown as
	// the person's own, so a tap sent twice saves the same thing twice (section 7, "Recipe";
	// MEA-86).
	rate: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		const parsed = parseForm(rateSchema, await request.formData(), 'rate');
		if ('failure' in parsed) return parsed.failure;
		return attempt('rate', () => rateDish(user.householdId, dishId, user.id, parsed.data.stars));
	},

	// Saved as soon as it's tapped, asked by the signed-in person (6.12; section 7, "Recipe").
	request: ({ locals, params }) => {
		const user = requireHousehold(locals);
		const dishId = dishIdIn(params);
		return attempt('request', () => requestDish(user.householdId, user.id, dishId, Date.now()));
	}
};
