import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import {
	DINNER_NOTE_MAX,
	DINNER_TYPES,
	DINNER_TYPE_LABELS,
	DISH_ROLES,
	hasDishes,
	isDate,
	weekStart
} from '#lib/menu.ts';
import { MAX_SERVINGS } from '#lib/recipe-view.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	addDinner,
	addDinnerDish,
	clearDinner,
	copyDinner,
	dishSuggestions,
	getDay,
	listCopyGroups,
	moveDinners,
	removeDinnerDish,
	restoreAndAddDinnerDish,
	saveDinner,
	setDinnerDishRole,
	type Dinner
} from '#lib/server/data/dinners.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';

// A date's dinners (design 7, Dinner; 6.9). Each form sends only what it changes and the rest
// stays as saved, so a page left open doesn't put back what someone else changed meanwhile
// (6.11). Each form for a dinner also sends which one the page showed, and the data layer acts on
// that one, never on another dinner someone moved onto the date, or planned, since it opened.

function dinnerDate(params: { date: string }): string {
	if (!isDate(params.date)) error(404, 'Not found');
	return params.date;
}

export function load({ locals, params }) {
	const user = requireHousehold(locals);
	const date = dinnerDate(params);
	const household = getHousehold(user.householdId);
	const today = dateIn(Date.now(), household.timeZone);
	return {
		date,
		today,
		dinners: getDay(user.householdId, date),
		// A date with no dinner shows Cooking at home at these servings, unsaved (6.9, Q28).
		defaultServings: household.defaultServings,
		// Dinners already made, so a plan for later in the week isn't offered (assumption 1).
		copyGroups: listCopyGroups(user.householdId, today),
		dishes: dishSuggestions(user.householdId)
	};
}

// The dinner the page showed, or null from a page showing the date as not planned.
const shownDinner = id.optional().transform((value) => value ?? null);

/** The dinner the page showed, while it's still on the date. */
function shownOn(householdId: number, date: string, dinnerId: number | null): Dinner | null {
	return getDay(householdId, date).find((dinner) => dinner.id === dinnerId) ?? null;
}

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

// Eating out and Leftovers show no servings, and a date with one dinner no label, so a missing
// field keeps what's saved. The type is the one the page shows, used only if the dinner is gone
// by the time this is saved. The data layer checks the label (6.9).
const detailsSchema = z.object({
	dinnerId: shownDinner,
	label: z.string().optional(),
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
const addDishSchema = z.object({
	name: z.string({ error: 'Enter a dish name' }),
	role,
	dinnerId: shownDinner
});

const restoreSchema = z.object({ dishId: id, role, dinnerId: shownDinner });

// A dish on a dinner the page shows.
const dishSchema = z.object({ dishId: id, dinnerId: id });

// The first dinner's label comes only with the date's second dinner (6.9).
const addDinnerSchema = z.object({
	firstLabel: z
		.string()
		.optional()
		.transform((value) => value ?? null),
	label: z.string({ error: 'Enter a label for each dinner' })
});

// The past dinner to copy, and the one on this date the page showed.
const copySchema = z.object({ sourceId: id, dinnerId: shownDinner, replaceDishes: confirmed });

const moveSchema = z.object({
	to: z.string({ error: 'Pick a date' }).refine(isDate, 'Pick a date'),
	dinnerId: shownDinner
});

const clearSchema = z.object({ dinnerId: shownDinner });

const CHANGED_SINCE = 'Someone has added dishes to this dinner since you opened it.';

export const actions = {
	type: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(typeSchema, await request.formData(), 'type');
		if ('failure' in parsed) return parsed.failure;
		const { type, removeDishes, dinnerId } = parsed.data;
		const dinner = shownOn(user.householdId, date, dinnerId);
		if (dinner && dinner.dishes.length > 0 && !hasDishes(type) && !removeDishes) {
			// The page didn't know about them, so it didn't ask. It shows them now and asks next time.
			return fail(400, {
				action: 'type',
				error: `${CHANGED_SINCE} To switch to ${DINNER_TYPE_LABELS[type]} and remove them, tap it again.`
			});
		}
		const fields = {
			label: dinner?.label ?? null,
			type,
			note: dinner?.note ?? null,
			// A new dinner starts at the household's usual servings (Q28).
			servings: dinner?.servings ?? getHousehold(user.householdId).defaultServings
		};
		return attempt('type', () => {
			saveDinner(user.householdId, date, dinnerId, fields, Date.now());
		});
	},

	// Saving the servings and note is usually the last thing done for a dinner, so it goes back to
	// the week, which says "Saved" on that dinner's line (design 7, Dinner).
	details: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(detailsSchema, await request.formData(), 'details');
		if ('failure' in parsed) return parsed.failure;
		const { dinnerId, label, type, servings, note } = parsed.data;
		const dinner = shownOn(user.householdId, date, dinnerId);
		// No dinner yet: the page showed a date with no dinner, and Save plans it as the type the
		// page showed. When the page showed a dinner, someone cleared or moved it since, and Save
		// plans the date again with what was sent, so nothing typed is lost; the last save wins
		// (6.11). The page then stays and says so.
		const fields = dinner
			? {
					label: label === undefined ? dinner.label : label,
					type: dinner.type,
					note: note === undefined ? dinner.note : note,
					servings: servings ?? dinner.servings
				}
			: {
					label: null,
					type: type ?? 'cook',
					note: note ?? null,
					servings: servings ?? getHousehold(user.householdId).defaultServings
				};
		const saved = attempt('details', () =>
			saveDinner(user.householdId, date, dinnerId, fields, Date.now())
		);
		if (typeof saved !== 'number') return saved;
		if (dinner === null && dinnerId !== null) return { action: 'details', replanned: true };
		redirect(303, `/menu?week=${weekStart(date)}&saved=${saved}`);
	},

	// Another dinner on a planned date, such as one for the kids and one for the adults (6.9).
	addDinner: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(addDinnerSchema, await request.formData(), 'addDinner');
		if ('failure' in parsed) return parsed.failure;
		const { firstLabel, label } = parsed.data;
		return attempt('addDinner', () => {
			addDinner(user.householdId, date, { first: firstLabel, added: label }, Date.now());
		});
	},

	addDish: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(addDishSchema, await request.formData(), 'dish');
		if ('failure' in parsed) return parsed.failure;
		const { name, role, dinnerId } = parsed.data;
		const added = attempt('dish', () =>
			addDinnerDish(user.householdId, date, dinnerId, { name }, role, Date.now())
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
		const parsed = parseForm(restoreSchema, await request.formData(), 'dish');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, role: chosen, dinnerId } = parsed.data;
		return attempt('dish', () =>
			restoreAndAddDinnerDish(user.householdId, date, dinnerId, dishId, chosen, Date.now())
		);
	},

	role: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(dishSchema.extend({ role }), await request.formData(), 'dishes');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, dinnerId, role: chosen } = parsed.data;
		return attempt('dishes', () =>
			setDinnerDishRole(user.householdId, date, dinnerId, dishId, chosen, Date.now())
		);
	},

	removeDish: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(dishSchema, await request.formData(), 'dishes');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, dinnerId } = parsed.data;
		return attempt('dishes', () =>
			removeDinnerDish(user.householdId, date, dinnerId, dishId, Date.now())
		);
	},

	copy: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(copySchema, await request.formData(), 'copy');
		if ('failure' in parsed) return parsed.failure;
		const { sourceId, dinnerId, replaceDishes } = parsed.data;
		const dinner = shownOn(user.householdId, date, dinnerId);
		// Copying replaces the dishes, so the page asks first when there are some (2.3).
		if (dinner && dinner.id !== sourceId && dinner.dishes.length > 0 && !replaceDishes) {
			return fail(400, {
				action: 'copy',
				error: `${CHANGED_SINCE} To replace them, pick the dinner to copy again.`
			});
		}
		return attempt('copy', () =>
			copyDinner(user.householdId, date, dinnerId, sourceId, Date.now())
		);
	},

	// Moves all of the date's dinners and lands on the new date, where they are now (2.2.2).
	move: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(moveSchema, await request.formData(), 'move');
		if ('failure' in parsed) return parsed.failure;
		const { to, dinnerId } = parsed.data;
		if (to === date) return fail(400, { action: 'move', error: 'Pick a different date' });
		const moved = attempt('move', () =>
			moveDinners(user.householdId, date, to, dinnerId, Date.now())
		);
		if (moved !== undefined) return moved;
		redirect(303, `/menu/${to}`);
	},

	clear: async ({ locals, params, request }) => {
		const user = requireHousehold(locals);
		const date = dinnerDate(params);
		const parsed = parseForm(clearSchema, await request.formData(), 'clear');
		if ('failure' in parsed) return parsed.failure;
		const { dinnerId } = parsed.data;
		return attempt('clear', () => clearDinner(user.householdId, date, dinnerId, Date.now()));
	}
};
