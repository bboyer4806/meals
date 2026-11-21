import { isDate } from './menu.ts';

// Each time zone's formatter is built once and kept: building one takes far longer than using it,
// and pages that date every line they show, such as Items and History, reload often (Q11).
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = dateFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		dateFormatters.set(timeZone, formatter);
	}
	return formatter;
}

/** The calendar date, as YYYY-MM-DD, of an instant in a time zone. */
export function dateIn(ms: number, timeZone: string): string {
	const parts = dateFormatter(timeZone).formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) => {
		const value = parts.find((p) => p.type === type)?.value;
		if (!value) throw new Error(`No ${type} in formatted date`);
		return value;
	};
	return `${part('year')}-${part('month')}-${part('day')}`;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * When a YYYY-MM-DD date starts in a time zone, in milliseconds since 1970: the first instant
 * whose date there is `date` or later. Usually midnight, but 1 a.m. where daylight time begins at
 * midnight. Found by halving the two days around midnight UTC, since every time zone's date
 * starts within a day of it.
 */
export function startOfDate(date: string, timeZone: string): number {
	if (!isDate(date)) throw new Error(`Not a date: ${date}`);
	const midnightUtc = Date.parse(`${date}T00:00:00Z`);
	// The date hasn't started at `before`, and has at `after`.
	let before = midnightUtc - DAY;
	let after = midnightUtc + DAY;
	while (after - before > 1) {
		const middle = Math.floor((before + after) / 2);
		// YYYY-MM-DD dates compare as text.
		if (dateIn(middle, timeZone) < date) before = middle;
		else after = middle;
	}
	return after;
}

/**
 * A YYYY-MM-DD date as a short label, such as "Sat, Oct 3". Given today's date, it adds the year
 * when the date is in another one ("Fri, Oct 3, 2025"), so a date from last year doesn't read as
 * one still to come. A long weekday spells the day out ("Saturday, Oct 3").
 */
export function formatDateLabel(
	date: string,
	{ today, weekday = 'short' }: { today?: string; weekday?: 'short' | 'long' } = {}
): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday,
		month: 'short',
		day: 'numeric',
		year: today === undefined || date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric'
	}).format(new Date(`${date}T00:00:00Z`));
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}
