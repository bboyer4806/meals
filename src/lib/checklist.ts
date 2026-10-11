import { formatKitchen } from './amounts.ts';
import { formatDateLabel } from './dates.ts';
import { daysBetween } from './menu.ts';
import { showAmount, showInBestUnit } from './scaling.ts';
import { foldCase } from './text.ts';
import { knownUnit, toBase, type UnitKind } from './units.ts';

// One pantry checklist line combines an item's amounts from every recipe that uses it (design
// 6.8, Q32c).

/**
 * One recipe's amount of an item. factor scales it to the servings wanted (scaleFactor), and
 * source names the recipe, with the day when it comes from the menu.
 */
export type ChecklistEntry = {
	amount: number | null;
	unit: string | null;
	factor: number;
	source: string;
};

export type CombinedAmounts = {
	/**
	 * One total per kind of amount: volume, weight, each custom unit (in the order first seen),
	 * then counts. Volume and weight are shown in the unit whose range contains them (6.6), and
	 * every total is rounded to kitchen fractions, even at a recipe's own servings.
	 */
	totals: string[];
	/** Whether any entry has no amount. */
	unmeasured: boolean;
	/** Each entry's own amount, as its recipe shows it (6.6). */
	breakdown: { source: string; amount: string | null }[];
};

export function combineAmounts(entries: ChecklistEntry[]): CombinedAmounts {
	// Volume and weight are converted and added up, but never into each other (6.5).
	const measured: Partial<Record<UnitKind, number>> = {};
	// Custom units that differ only in case are added up, shown with the first spelling.
	const custom = new Map<string, { unit: string; total: number }>();
	let count: number | null = null;
	for (const { amount, unit, factor } of entries) {
		if (amount === null) continue;
		const scaled = amount * factor;
		const known = unit === null ? undefined : knownUnit(unit);
		if (known) {
			measured[known.kind] = (measured[known.kind] ?? 0) + toBase(scaled, known);
		} else if (unit !== null) {
			const key = foldCase(unit);
			const group = custom.get(key);
			if (group) group.total += scaled;
			else custom.set(key, { unit, total: scaled });
		} else {
			count = (count ?? 0) + scaled;
		}
	}

	const totals: string[] = [];
	for (const kind of ['volume', 'weight'] as const) {
		const base = measured[kind];
		if (base !== undefined) totals.push(showInBestUnit(kind, base));
	}
	for (const { unit, total } of custom.values()) totals.push(`${formatKitchen(total)} ${unit}`);
	if (count !== null) totals.push(formatKitchen(count));

	return {
		totals,
		unmeasured: entries.some((entry) => entry.amount === null),
		breakdown: entries.map(({ amount, unit, factor, source }) => ({
			source,
			amount: showAmount(amount, unit, factor)
		}))
	};
}

// The grocery line's note can be edited later, and the edit form allows 200 characters.
const NOTE_MAX = 200;

/**
 * The note on the grocery line that Need adds (Q4). Each recipe is named once:
 * - "1 1/8 cups for Pound cake"
 * - "1 cup + 2 cloves for Pound cake, Pan sauce"
 * - "1 cup + some for Pound cake, Pan sauce", when one of them has no amount
 * - "For Pound cake", when none has
 */
export function needNote(combined: CombinedAmounts): string {
	const sources = [...new Set(combined.breakdown.map((entry) => entry.source))].join(', ');
	const amounts = combined.totals.join(' + ');
	const some = combined.unmeasured ? ' + some' : '';
	const note = amounts === '' ? `For ${sources}` : `${amounts}${some} for ${sources}`;
	if (note.length <= NOTE_MAX) return note;
	let end = NOTE_MAX - '...'.length;
	// Don't cut a character that takes two code units, such as an emoji, in half.
	const last = note.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return `${note.slice(0, end).trimEnd()}...`;
}

// A pantry check from the menu names each dish with its day (6.8).

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

/**
 * Names a dish on a dinner in a pantry check from the menu, with its day: "Pound cake (Tue)".
 * Within a week each weekday is one date; a longer check uses the date instead, such as
 * "Pound cake (Oct 14)".
 */
export function menuSource(
	dishName: string,
	date: string,
	startDate: string,
	endDate: string
): string {
	const day = daysBetween(startDate, endDate) + 1 <= 7 ? WEEKDAY : MONTH_DAY;
	return `${dishName} (${day.format(new Date(`${date}T00:00:00Z`))})`;
}

/** The dates of a pantry check from the menu: "Tue, Oct 7 to Mon, Oct 13", or just the one. */
export function rangeLabel(startDate: string, endDate: string): string {
	const start = formatDateLabel(startDate);
	return startDate === endDate ? start : `${start} to ${formatDateLabel(endDate)}`;
}
