import { describe, expect, it } from 'vitest';
import { formatShare, parsePeriod, periodStart, REPORT_PERIODS } from './reports.ts';

describe('parsePeriod', () => {
	it('reads each period, and shows Last 90 days for a missing or unknown one', () => {
		for (const period of REPORT_PERIODS) expect(parsePeriod(period)).toBe(period);
		for (const text of [null, '', '7d', '90D', 'all ']) {
			expect(parsePeriod(text), `${text}`).toBe('90d');
		}
	});
});

describe('periodStart', () => {
	it('counts days back from today, and a year back for Last 12 months', () => {
		expect(periodStart('30d', '2026-11-21')).toBe('2026-10-22');
		expect(periodStart('90d', '2026-11-21')).toBe('2026-08-23');
		expect(periodStart('12m', '2026-11-21')).toBe('2025-11-21');
		expect(periodStart('all', '2026-11-21')).toBeNull();
	});

	it('crosses years and leap days', () => {
		expect(periodStart('30d', '2026-01-10')).toBe('2025-12-11');
		expect(periodStart('90d', '2028-03-01')).toBe('2027-12-02');
		expect(periodStart('12m', '2028-02-29')).toBe('2027-02-28');
		expect(periodStart('12m', '2029-03-01')).toBe('2028-03-01');
	});
});

describe('formatShare', () => {
	it('shows a whole percent', () => {
		expect(formatShare(1, 4)).toBe('25%');
		expect(formatShare(2, 3)).toBe('67%');
		expect(formatShare(0, 3)).toBe('0%');
		expect(formatShare(3, 3)).toBe('100%');
	});

	it('never shows a share above none as 0%, or one below all as 100%', () => {
		expect(formatShare(1, 300)).toBe('<1%');
		expect(formatShare(299, 300)).toBe('>99%');
		expect(formatShare(1, 200)).toBe('1%');
	});

	it('refuses a count that is not part of the whole', () => {
		expect(() => formatShare(0, 0)).toThrow('Not a share: 0 of 0');
		expect(() => formatShare(4, 3)).toThrow('Not a share: 4 of 3');
		expect(() => formatShare(-1, 3)).toThrow('Not a share: -1 of 3');
	});
});
