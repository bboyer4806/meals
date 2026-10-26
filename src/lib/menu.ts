// The menu's shared rules (design 6.9 and 7, Menu and Dinner): dinner types, dish roles and
// weeks, for the pages and the server alike. Dates are YYYY-MM-DD text in the household's time
// zone (design 5), so the date math here works on calendar dates in UTC and never on instants.

export const DINNER_TYPES = ['cook', 'eat_out', 'going', 'leftovers'] as const;
export type DinnerType = (typeof DINNER_TYPES)[number];

export const DINNER_TYPE_LABELS: Record<DinnerType, string> = {
	cook: 'Cooking at home',
	eat_out: 'Eating out',
	going: 'Bringing a dish',
	leftovers: 'Leftovers'
};

/** Cooking at home and Bringing a dish have dishes and servings; the others only a note (Q26). */
export function hasDishes(type: DinnerType): boolean {
	return type === 'cook' || type === 'going';
}

/** Why a dish can't go on a dinner of the other types. */
export const NO_DISHES = 'Switch to Cooking at home or Bringing a dish to add dishes';

/** In the order a dinner lists its dishes (6.9). */
export const DISH_ROLES = ['main', 'side', 'dessert', 'other'] as const;
export type DishRole = (typeof DISH_ROLES)[number];

export const DISH_ROLE_LABELS: Record<DishRole, string> = {
	main: 'Main',
	side: 'Side',
	dessert: 'Dessert',
	other: 'Other'
};

/** A date can have this many dinners, such as one for the kids and one for the adults (6.9). */
export const MAX_DINNERS = 5;

/** A dinner's label, such as "Kids", on a date with more than one dinner (6.9). */
export const DINNER_LABEL_MAX = 30;

/** A dinner's note can hold a long plan, such as a whole evening's notes. */
export const DINNER_NOTE_MAX = 2500;

/**
 * A request's dish or restaurant name (the recipe editor's limit for a dish name) and note
 * (6.12).
 */
export const REQUEST_NAME_MAX = 80;
export const REQUEST_NOTE_MAX = 200;

/** A pantry check from the menu covers the next 7 days unless changed (Q5), and at most 14. */
export const DEFAULT_CHECK_DAYS = 7;
export const MAX_CHECK_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date: string): Date {
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) throw new Error(`Not a date: ${date}`);
	return day;
}

/** Whether text is a real calendar date written YYYY-MM-DD. */
export function isDate(text: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
	const day = new Date(`${text}T00:00:00Z`);
	// A day that doesn't exist, such as Feb 30, rolls over into the next month.
	return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

/** The date some days later, or earlier for a negative number. */
export function addDays(date: string, days: number): string {
	const day = utcDay(date);
	day.setUTCDate(day.getUTCDate() + days);
	return day.toISOString().slice(0, 10);
}

/** How many days from one date to another, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / DAY_MS);
}

/** The Sunday that starts a date's week (Q27b). */
export function weekStart(date: string): string {
	return addDays(date, -utcDay(date).getUTCDay());
}

/** The seven dates of the week that starts on `start`. */
export function weekDates(start: string): string[] {
	return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
