/** The calendar date, as YYYY-MM-DD, of an instant in a time zone. */
export function dateIn(ms: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) => {
		const value = parts.find((p) => p.type === type)?.value;
		if (!value) throw new Error(`No ${type} in formatted date`);
		return value;
	};
	return `${part('year')}-${part('month')}-${part('day')}`;
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
