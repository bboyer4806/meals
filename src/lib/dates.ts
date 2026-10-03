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

/** A YYYY-MM-DD date as a short label, such as "Sat, Oct 3". */
export function formatDateLabel(date: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'short',
		month: 'short',
		day: 'numeric'
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
