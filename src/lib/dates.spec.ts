import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateIn, formatDateLabel, isValidTimeZone, startOfDate } from './dates.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('dateIn', () => {
	it('uses the time zone, not UTC', () => {
		// 2026-10-04 03:30 UTC is still Oct 3 in Chicago (UTC-5 during daylight time).
		const ms = Date.UTC(2026, 9, 4, 3, 30);
		expect(dateIn(ms, 'America/Chicago')).toBe('2026-10-03');
		expect(dateIn(ms, 'UTC')).toBe('2026-10-04');
	});

	it('builds one formatter for a time zone and reuses it', () => {
		const built = vi.spyOn(Intl, 'DateTimeFormat');
		// Tokyo is in no other test here, so its formatter isn't built yet. 2026-10-04 20:00 UTC is
		// already Oct 5 in Tokyo (UTC+9).
		const ms = Date.UTC(2026, 9, 4, 20);
		expect(dateIn(ms, 'Asia/Tokyo')).toBe('2026-10-05');
		expect(dateIn(ms + 24 * 60 * 60 * 1000, 'Asia/Tokyo')).toBe('2026-10-06');
		expect(built).toHaveBeenCalledOnce();
	});
});

describe('startOfDate', () => {
	it('is midnight in the time zone, in daylight and standard time', () => {
		expect(startOfDate('2026-10-03', 'America/Chicago')).toBe(Date.UTC(2026, 9, 3, 5));
		expect(startOfDate('2026-12-01', 'America/Chicago')).toBe(Date.UTC(2026, 11, 1, 6));
		// Daylight time begins at 2 a.m., after the day has started in standard time.
		expect(startOfDate('2026-03-08', 'America/Chicago')).toBe(Date.UTC(2026, 2, 8, 6));
		expect(startOfDate('2026-10-03', 'UTC')).toBe(Date.UTC(2026, 9, 3));
	});

	it('works for the time zones furthest from UTC, and for offsets that are not whole hours', () => {
		expect(startOfDate('2026-10-03', 'Pacific/Kiritimati')).toBe(Date.UTC(2026, 9, 2, 10));
		expect(startOfDate('2026-10-03', 'Pacific/Pago_Pago')).toBe(Date.UTC(2026, 9, 3, 11));
		expect(startOfDate('2026-10-03', 'Asia/Kathmandu')).toBe(Date.UTC(2026, 9, 2, 18, 15));
	});

	it('is 1 a.m. where daylight time begins at midnight, and the first midnight where it ends', () => {
		// Havana skips from 23:59 on Mar 7 to 1:00 on Mar 8, and repeats 0:00 to 0:59 on Nov 1.
		expect(startOfDate('2026-03-08', 'America/Havana')).toBe(Date.UTC(2026, 2, 8, 5));
		expect(startOfDate('2026-11-01', 'America/Havana')).toBe(Date.UTC(2026, 10, 1, 4));
	});

	it('refuses text that is not a date', () => {
		expect(() => startOfDate('yesterday', 'UTC')).toThrow('Not a date: yesterday');
		expect(() => startOfDate('2026-02-30', 'UTC')).toThrow('Not a date: 2026-02-30');
	});
});

describe('formatDateLabel', () => {
	it('formats a calendar date', () => {
		expect(formatDateLabel('2026-10-03')).toBe('Sat, Oct 3');
	});

	it("adds the year when it isn't today's year", () => {
		const today = '2026-10-10';
		expect(formatDateLabel('2026-01-01', { today })).toBe('Thu, Jan 1');
		expect(formatDateLabel('2025-11-27', { today })).toBe('Thu, Nov 27, 2025');
		expect(formatDateLabel('2027-01-04', { today })).toBe('Mon, Jan 4, 2027');
	});

	it('spells out the weekday', () => {
		expect(formatDateLabel('2026-10-07', { weekday: 'long' })).toBe('Wednesday, Oct 7');
		expect(formatDateLabel('2025-10-12', { today: '2026-10-10', weekday: 'long' })).toBe(
			'Sunday, Oct 12, 2025'
		);
	});
});

describe('isValidTimeZone', () => {
	it('accepts IANA names and rejects others', () => {
		expect(isValidTimeZone('America/Chicago')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus')).toBe(false);
	});
});
