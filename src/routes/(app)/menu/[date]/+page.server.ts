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
	setDinnerDishRole,
	type Dinner
} from '#lib/server/data/dinners.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';

// One dinner (design 7, Dinner; 6.9). Each form sends only what it changes and the rest stays
// as saved, so a page left open doesn't put back what someone else changed meanwhile (6.11).
// The forms that change or remove the dinner as a whole also send which one the page showed, so
// they don't act on another dinner someone moved onto the date, or planned, since it opened.

function dinnerDate(params: { date: string }): string {
	if (!isDate(params.date)) error(404, 'Not found');
	return params.date;
}

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	const date = dinnerDate(params);
	const today = dateIn(Date.now(), getHousehold(user.householdId).timeZone);
	const dinner = getDinner(user.householdId, date);
	return {
		date,
		today,
		dinner,
		// Dinners already made, so a plan for later in the week isn't offered (assumption 1).
		// Copying the group whose latest dinner is this one would change nothing, so it's left out.
		copyGroups: listCopyGroups(user.householdId, today).filter(
			(group) => group.dinnerId !== dinner?.id
		),
		dishes: dishSuggestions(user.householdId)
	};
}

// The dinner the page showed. A page showing the date as not planned sends none.
const shownDinner = id.optional();

// Sent when the page asked before a change that takes dishes off the dinner (2.3).
const confirmed = z
	.literal('1')
	.optional()
	.transform((value) => value === '1');

const role = z.enum(DISH_ROLES, { error: 'Pick a role' });

const typeSchema = z.object({
	type: z.enum(DINNER_TYPES, { error: 'Pick a type' }),
	removeDishes: confirmed,
	dinnerId: shownDinner
});

// Eating out and Leftovers show no servings, so a missing field keeps what's saved. The type is
// the one the page shows, used only if the dinner is gone by the time this is saved.
const detailsSchema = z.object({
	dinnerId: shownDinner,
	type: z.enum(DINNER_TYPES, { error: 'Pick a type' }).optional(),
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

// The past dinner to copy, and the one on this date the page showed.
const copySchema = z.object({ sourceId: id, dinnerId: shownDinner, replaceDishes: confirmed });

const moveSchema = z.object({
	to: z.string({ error: 'Pick a date' }).refine(isDate, 'Pick a date'),
	dinnerId: shownDinner
});

const clearSchema = z.object({ dinnerId: shownDinner });

const CHANGED_SINCE = 'Someone has added dishes to this dinner since you opened it.';

/**
 * Refuses a change meant for another dinner than the one now on the date: someone moved another
 * dinner onto it, or planned a date the page showed as not planned. The page then shows what's
 * there now. When the dinner the page showed is gone and nothing took its place, each action
 * goes on as it would for a date without one.
 */
function notShown(dinner: Dinner | null, shownId: number | undefined, action: string) {
	if (dinner === null || dinner.id === shownId) return null;
	return fail(400, { action, error: 'Someone changed this dinner since you opened it.' });
}

export const actions = {
	type: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(typeSchema, await request.formData(), 'type');
		if ('failure' in parsed) return parsed.failure;
		const { type, removeDishes, dinnerId } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		const refused = notShown(dinner, dinnerId, 'type');
		if (refused) return refused;
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
		const { dinnerId, type, servings, note } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		const refused = notShown(dinner, dinnerId, 'details');
		if (refused) return refused;
		// Someone cleared or moved the dinner since the page opened. Saving plans the date again,
		// as the type the page showed, with what was sent, so nothing typed is lost; the last save
		// wins (6.11). The page says so.
		const fields = dinner
			? {
					type: dinner.type,
					note: note === undefined ? dinner.note : note,
					servings: servings ?? dinner.servings
				}
			: {
					type: type ?? 'cook',
					note: note ?? null,
					servings: servings ?? getHousehold(user.householdId).defaultServings
				};
		return attempt('details', () => {
			saveDinner(user.householdId, date, fields, Date.now());
			return { action: 'details', replanned: dinner === null };
		});
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
		const { sourceId, dinnerId, replaceDishes } = parsed.data;
		const dinner = getDinner(user.householdId, date);
		const refused = notShown(dinner, dinnerId, 'copy');
		if (refused) return refused;
		// Copying replaces the dishes, so the page asks first when there are some (2.3).
		if (dinner && dinner.id !== sourceId && dinner.dishes.length > 0 && !replaceDishes) {
			return fail(400, {
				action: 'copy',
				error: `${CHANGED_SINCE} To replace them, pick the dinner to copy again.`
			});
		}
		return attempt('copy', () => copyDinner(user.householdId, date, sourceId, Date.now()));
	},

	// Lands on the new date, where the dinner is now (2.2.2).
	move: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(moveSchema, await request.formData(), 'move');
		if ('failure' in parsed) return parsed.failure;
		const { to, dinnerId } = parsed.data;
		if (to === date) return fail(400, { action: 'move', error: 'Pick a different date' });
		const refused = notShown(getDinner(user.householdId, date), dinnerId, 'move');
		if (refused) return refused;
		const moved = attempt('move', () => moveDinner(user.householdId, date, to, Date.now()));
		if (moved !== undefined) return moved;
		redirect(303, `/menu/${to}`);
	},

	clear: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(clearSchema, await request.formData(), 'clear');
		if ('failure' in parsed) return parsed.failure;
		const refused = notShown(getDinner(user.householdId, date), parsed.data.dinnerId, 'clear');
		if (refused) return refused;
		clearDinner(user.householdId, date);
	}
};
