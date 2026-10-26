import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import {
	DISH_ROLES,
	REQUEST_NAME_MAX,
	REQUEST_NOTE_MAX,
	addDays,
	isDate,
	weekDates,
	weekStart,
	type DishRole
} from '#lib/menu.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	dishSuggestions,
	getDinners,
	moveDinners,
	type Dinner
} from '#lib/server/data/dinners.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import {
	addRequest,
	addRestaurantRequest,
	listRequests,
	removeRequest,
	restoreAndAddRequest
} from '#lib/server/data/requests.ts';
import { attempt, id, nameField, parseForm } from '#lib/server/forms.ts';

// The week view (design 7, Menu): Sunday to Saturday, one row per day with its dinners. ?week=
// can be any date in the week. Dragging a day onto another with a mouse swaps their dinners, like
// Move to another date (2.2.2). Under it, the household's requests for dishes and restaurants,
// the same on every week (6.12).

/** The Sunday that starts the week to show, or null when ?week= isn't a date it can show. */
function weekToShow(param: string | null, today: string): string | null {
	if (param === null) return weekStart(today);
	if (!isDate(param)) return null;
	const start = weekStart(param);
	// The last days of year 9999 can't be written as YYYY-MM-DD.
	return isDate(addDays(start, 6)) ? start : null;
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

/**
 * "Oct 4 to Oct 10", with the year when it isn't this year ("Mar 7 to Mar 13, 2027") or the
 * week crosses into a new one ("Dec 27, 2026 to Jan 2, 2027").
 */
function weekLabel(start: string, end: string, today: string): string {
	const day = (date: string) => MONTH_DAY.format(new Date(`${date}T00:00:00Z`));
	const year = (date: string) => date.slice(0, 4);
	if (year(start) !== year(end)) {
		return `${day(start)}, ${year(start)} to ${day(end)}, ${year(end)}`;
	}
	const range = `${day(start)} to ${day(end)}`;
	return year(end) === year(today) ? range : `${range}, ${year(end)}`;
}

/** Each role's dishes, Main, Side, Dessert, Other (6.9), in the order they were added. */
function byRole(dishes: Dinner['dishes']): { role: DishRole; names: string[] }[] {
	return DISH_ROLES.map((role) => ({
		role,
		names: dishes.filter((dish) => dish.role === role).map((dish) => dish.name)
	})).filter((group) => group.names.length > 0);
}

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const today = dateIn(Date.now(), getHousehold(user.householdId).timeZone);
	const start = weekToShow(url.searchParams.get('week'), today);
	if (start === null) redirect(303, '/menu');
	const end = addDays(start, 6);

	const dinners = getDinners(user.householdId, start, end);
	return {
		today,
		label: weekLabel(start, end, today),
		isThisWeek: start === weekStart(today),
		previous: addDays(start, -7),
		next: addDays(start, 7),
		// Each day's dinners in the order they were added (6.9).
		days: weekDates(start).map((date) => ({
			date,
			dinners: dinners
				.filter((dinner) => dinner.date === date)
				.map((dinner) => ({
					id: dinner.id,
					label: dinner.label,
					type: dinner.type,
					note: dinner.note,
					roles: byRole(dinner.dishes)
				}))
		})),
		requests: listRequests(user.householdId),
		dishes: dishSuggestions(user.householdId)
	};
}

// The asker is the signed-in person; the form sends only the name and note (6.12).
const requestSchema = z.object({
	name: nameField(REQUEST_NAME_MAX, 'a dish name'),
	note: z
		.string()
		.trim()
		.max(REQUEST_NOTE_MAX, `Keep the note under ${REQUEST_NOTE_MAX} characters`)
		.transform((text) => (text === '' ? null : text))
});

// The archived dish to restore, with the name and note again, since a request keeps its name as
// typed (6.10, 6.12).
const restoreRequestSchema = requestSchema.extend({ dishId: id });

// A restaurant is only its name as typed, with a dish name's limit (6.12).
const restaurantRequestSchema = requestSchema.extend({
	name: nameField(REQUEST_NAME_MAX, 'a restaurant name')
});

// The dragged day, the day it was dropped on, and a dinner the page showed on the dragged day, so
// the move doesn't take others someone put there instead.
const moveSchema = z.object({
	from: z.string().refine(isDate, 'Pick a date'),
	to: z.string().refine(isDate, 'Pick a date'),
	dinnerId: id
});

export const actions = {
	// Moves all of the dragged day's dinners, swapping with the other day's, and stays on the
	// week (2.2.2, 6.9).
	move: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(moveSchema, await request.formData(), 'move');
		if ('failure' in parsed) return parsed.failure;
		const { from, to, dinnerId } = parsed.data;
		return attempt('move', () => moveDinners(user.householdId, from, to, dinnerId, Date.now()));
	},

	request: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(requestSchema, await request.formData(), 'request');
		if ('failure' in parsed) return parsed.failure;
		const added = attempt('request', () =>
			addRequest(user.householdId, user.id, parsed.data, Date.now())
		);
		if (!('kind' in added)) return added;
		// Its name stays taken, so the page offers to restore it instead (6.10).
		if (added.kind === 'archived') {
			return { action: 'request', archived: { dishId: added.dishId, name: added.name } };
		}
		return { action: 'request', archived: null };
	},

	restoreRequest: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(restoreRequestSchema, await request.formData(), 'request');
		if ('failure' in parsed) return parsed.failure;
		const { dishId, ...fields } = parsed.data;
		return attempt('request', () =>
			restoreAndAddRequest(user.householdId, user.id, dishId, fields, Date.now())
		);
	},

	// Adds a request to eat out at a restaurant, linked to nothing (6.12).
	requestRestaurant: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(restaurantRequestSchema, await request.formData(), 'restaurant');
		if ('failure' in parsed) return parsed.failure;
		return attempt('restaurant', () =>
			addRestaurantRequest(user.householdId, user.id, parsed.data, Date.now())
		);
	},

	removeRequest: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const parsed = parseForm(z.object({ id }), await request.formData(), 'requests');
		if ('failure' in parsed) return parsed.failure;
		return attempt('requests', () => removeRequest(user.householdId, parsed.data.id));
	}
};
