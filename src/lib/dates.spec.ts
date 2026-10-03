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
});

describe('isValidTimeZone', () => {
	it('accepts IANA names and rejects others', () => {
		expect(isValidTimeZone('America/Chicago')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus')).toBe(false);
	});
});
