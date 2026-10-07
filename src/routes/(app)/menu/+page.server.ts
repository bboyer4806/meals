import { redirect } from '@sveltejs/kit';
import { dateIn } from '#lib/dates.ts';
import {
	DEFAULT_CHECK_DAYS,
	DISH_ROLES,
	addDays,
	isDate,
	weekDates,
	weekStart,
	type DishRole
} from '#lib/menu.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getDinners, type Dinner } from '#lib/server/data/dinners.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { getChecklistSummary } from '#lib/server/data/pantry.ts';

// The week view (design 7, Menu): Sunday to Saturday, one row per day. ?week= can be any date
// in the week, since the pantry check links to the week its dates start in.

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

	const dinners = new Map(getDinners(user.householdId, start, end).map((d) => [d.date, d]));
	return {
		today,
		label: weekLabel(start, end, today),
		isThisWeek: start === weekStart(today),
		previous: addDays(start, -7),
		next: addDays(start, 7),
		days: weekDates(start).map((date) => {
			const dinner = dinners.get(date);
			return {
				date,
				dinner: dinner
					? { type: dinner.type, note: dinner.note, roles: byRole(dinner.dishes) }
					: null
			};
		}),
		// Check pantry starts with the next 7 days (Q5), whichever week is showing.
		check: { startDate: today, endDate: addDays(today, DEFAULT_CHECK_DAYS - 1) },
		// A new pantry check replaces the current one, so the sheet asks first if it has marks.
		pantryMarked: getChecklistSummary(user.householdId)?.markedCount ?? 0
	};
}
