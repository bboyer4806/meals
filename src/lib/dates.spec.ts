import { describe, expect, it } from 'vitest';
import { dateIn, formatDateLabel, isValidTimeZone } from './dates.ts';

describe('dateIn', () => {
	it('uses the time zone, not UTC', () => {
		// 2026-10-04 03:30 UTC is still Oct 3 in Chicago (UTC-5 during daylight time).
		const ms = Date.UTC(2026, 9, 4, 3, 30);
		expect(dateIn(ms, 'America/Chicago')).toBe('2026-10-03');
		expect(dateIn(ms, 'UTC')).toBe('2026-10-04');
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
