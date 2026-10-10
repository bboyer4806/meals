import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import {
	DINNER_NOTE_MAX,
	DINNER_TYPES,
	DINNER_TYPE_LABELS,
	DISH_ROLES,
	hasDishes,
	isDate
} from '#lib/menu.ts';
import { MAX_SERVINGS } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	addDinnerDish,
	clearDinner,
	copyDinner,
	dishSuggestions,
	getDinner,
	listCopyGroups,
	moveDinner,
	removeDinnerDish,
	restoreAndAddDinnerDish,
	saveDinner,
	setDinnerDishRole
} from '#lib/server/data/dinners.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';

// One dinner (design 7, Dinner; 6.9). Each form sends only what it changes and the rest stays
// as saved, so a page left open doesn't put back what someone else changed meanwhile (6.11).

function dinnerDate(params: { date: string }): string {
	if (!isDate(params.date)) error(404, 'Not found');
	return params.date;
}

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	const date = dinnerDate(params);
	const today = dateIn(Date.now(), getHousehold(user.householdId).timeZone);
	return {
		date,
		today,
		dinner: getDinner(user.householdId, date),
		// Dinners already made, so a plan for later in the week isn't offered (assumption 1).
		copyGroups: listCopyGroups(user.householdId, today),
		dishes: dishSuggestions(user.householdId)
	};
}

// Sent when the page asked before a change that takes dishes off the dinner (2.3).
const confirmed = z
	.literal('1')
	.optional()
	.transform((value) => value === '1');

const role = z.enum(DISH_ROLES, { error: 'Pick a role' });

const typeSchema = z.object({
	type: z.enum(DINNER_TYPES, { error: 'Pick a type' }),
	removeDishes: confirmed
});

// Eating out and Leftovers show no servings, so a missing field keeps what's saved.
const detailsSchema = z.object({
	servings: z.coerce
		.number()
		.int('Enter a whole number of servings')
		.min(1, 'Enter at least 1 serving')
		.max(MAX_SERVINGS, `Enter ${MAX_SERVINGS} servings or fewer`)
		.optional(),
	// Browsers send line breaks as \r\n; they're stored as \n, as a recipe's notes are.
	note: z
		.string()
		.transform((text) => text.replace(/\r\n?/g, '\n').trim())
		.pipe(z.string().max(DINNER_NOTE_MAX, `Keep the note under ${DINNER_NOTE_MAX} characters`))
		.transform((text) => (text === '' ? null : text))
		.optional()
});

// A suggestion or a new name alike; the data layer finds an existing dish by name.
const addDishSchema = z.object({ name: z.string({ error: 'Enter a dish name' }), role });

const dishSchema = z.object({ dishId: id });

const copySchema = z.object({ dinnerId: id, replaceDishes: confirmed });

const moveSchema = z.object({ to: z.string({ error: 'Pick a date' }).refine(isDate, 'Pick a date') });

const CHANGED_SINCE = 'Someone has added dishes to this dinner since you opened it.';

export const actions = {
	type: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(typeSchema, await request.formData(), 'type');
		if ('failure' in parsed) return parsed.failure;
		const { type, removeDishes } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		if (dinner && dinner.dishes.length > 0 && !hasDishes(type) && !removeDishes) {
			// The page didn't know about them, so it didn't ask. It shows them now and asks next time.
			return fail(400, {
				action: 'type',
				error: `${CHANGED_SINCE} To switch to ${DINNER_TYPE_LABELS[type]} and remove them, tap it again.`
			});
		}
		const fields = {
			type,
			note: dinner?.note ?? null,
			// A new dinner starts at the household's usual servings (Q28).
			servings: dinner?.servings ?? getHousehold(user.householdId).defaultServings
		};
		return attempt('type', () => saveDinner(user.householdId, date, fields, Date.now()));
	},

	details: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(detailsSchema, await request.formData(), 'details');
		if ('failure' in parsed) return parsed.failure;
		const { servings, note } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		if (!dinner) {
			return fail(400, {
				action: 'details',
				error: 'This dinner has been cleared. Pick a type to plan it again.'
			});
		}
		const fields = {
			type: dinner.type,
			note: note === undefined ? dinner.note : note,
			servings: servings ?? dinner.servings
		};
		return attempt('details', () => saveDinner(user.householdId, date, fields, Date.now()));
	},

	addDish: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(addDishSchema, await request.formData(), 'dish');
		if ('failure' in parsed) return parsed.failure;
		const { name, role } = parsed.data;
		const added = attempt('dish', () =>
			addDinnerDish(user.householdId, date, { name }, role, Date.now())
		);
		if (!('kind' in added)) return added;
		// Its name stays taken, so the page offers to restore it instead (6.10).
		if (added.kind === 'archived') {
			return { action: 'dish', archived: { dishId: added.dishId, name: added.name, role } };
		}
		return { action: 'dish', archived: null };
	},

	restoreDish: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(dishSchema.extend({ role }), await request.formData(), 'dish');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, role: chosen } = parsed.data;
		return attempt('dish', () =>
			restoreAndAddDinnerDish(user.householdId, date, dishId, chosen, Date.now())
		);
	},

	role: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(dishSchema.extend({ role }), await request.formData(), 'dishes');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, role: chosen } = parsed.data;
		return attempt('dishes', () =>
			setDinnerDishRole(user.householdId, date, dishId, chosen, Date.now())
		);
	},

	removeDish: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(dishSchema, await request.formData(), 'dishes');
		if ('failure' in parsed) return parsed.failure;
		const { dishId } = parsed.data;
		return attempt('dishes', () => removeDinnerDish(user.householdId, date, dishId, Date.now()));
	},

	copy: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(copySchema, await request.formData(), 'copy');
		if ('failure' in parsed) return parsed.failure;
		const { dinnerId, replaceDishes } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		// Copying replaces the dishes, so the page asks first when there are some (2.3).
		if (dinner && dinner.id !== dinnerId && dinner.dishes.length > 0 && !replaceDishes) {
			return fail(400, {
				action: 'copy',
				error: `${CHANGED_SINCE} To replace them, pick the dinner to copy again.`
			});
		}
		return attempt('copy', () => copyDinner(user.householdId, date, dinnerId, Date.now()));
	},

	// Lands on the new date, where the dinner is now (2.2.2).
	move: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(moveSchema, await request.formData(), 'move');
		if ('failure' in parsed) return parsed.failure;
		const { to } = parsed.data;
		if (to === date) return fail(400, { action: 'move', error: 'Pick a different date' });
		const moved = attempt('move', () => moveDinner(user.householdId, date, to, Date.now()));
		if (moved !== undefined) return moved;
		redirect(303, `/menu/${to}`);
	},

	clear: ({ locals, params }) => {
		const user = requireHousehold(locals);
		clearDinner(user.householdId, dinnerDate(params));
	}
};
