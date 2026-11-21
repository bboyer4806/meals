import { addDays, isDate } from './menu.ts';

// The Reports page's shared rules (design 7, Reports; MEA-14): its periods, Forgotten Favorites
// and how a share is shown, for the page and the server alike. Dates are YYYY-MM-DD text in the
// household's time zone (design 5).

/** In the order the page offers them. */
export const REPORT_PERIODS = ['30d', '90d', '12m', 'all'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
	'30d': 'Last 30 days',
	'90d': 'Last 90 days',
	'12m': 'Last 12 months',
	all: 'All time'
};

/** The period the page opens with, and the one a missing or unknown period shows. */
export const DEFAULT_PERIOD: ReportPeriod = '90d';

export function parsePeriod(text: string | null): ReportPeriod {
	return REPORT_PERIODS.find((period) => period === text) ?? DEFAULT_PERIOD;
}

/**
 * The first date a period counts, through today, or null for All time: 30 or 90 days before
 * today, or the same date a year before for Last 12 months (Feb 28 for Feb 29), as the Recipes
 * page's 60 days count from 60 days before today (design 7, Recipes).
 */
export function periodStart(period: ReportPeriod, today: string): string | null {
	switch (period) {
		case '30d':
			return addDays(today, -30);
		case '90d':
			return addDays(today, -90);
		case '12m': {
			const sameDate = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
			return isDate(sameDate) ? sameDate : `${sameDate.slice(0, 4)}-02-28`;
		}
		case 'all':
			return null;
	}
}

/** A Forgotten Favorite is a dish planned at least this many times... */
export const FAVORITE_TIMES = 3;
/** ...and not from this many days before today on, the days Last 90 days counts, or later. */
export const FORGOTTEN_DAYS = 90;

/**
 * A share of a whole as a whole percent. One above none never shows as 0%, nor one below all as
 * 100%, so rounding never hides a dinner type that happened or shows one as every dinner.
 */
export function formatShare(count: number, total: number): string {
	if (total <= 0 || count < 0 || count > total) {
		throw new Error(`Not a share: ${count} of ${total}`);
	}
	const percent = Math.round((count / total) * 100);
	if (percent === 0 && count > 0) return '<1%';
	if (percent === 100 && count < total) return '>99%';
	return `${percent}%`;
}
