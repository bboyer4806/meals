import { describe, expect, it } from 'vitest';
import { dateIn } from './dates.ts';
import { RELEASES } from './whats-new.ts';

// Releases are written by hand when a sprint closes, so these guard each new one.
describe('RELEASES', () => {
	// Each a day or more after the one before, as the dot compares dates.
	it('lists releases newest first', () => {
		const dates = RELEASES.map((release) => release.released);
		expect(dates).toEqual([...new Set(dates)].sort().reverse());
	});

	it('has a unique version for each release', () => {
		const versions = RELEASES.map((release) => release.version);
		expect(new Set(versions).size).toBe(versions.length);
		for (const version of versions) expect(version).toMatch(/^\d+\.\d+$/);
	});

	it('has a valid date for each release', () => {
		for (const { released } of RELEASES) {
			expect(released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(dateIn(Date.parse(`${released}T12:00:00Z`), 'UTC')).toBe(released);
		}
	});

	it('has at least one line for each release, none saying "sprint"', () => {
		for (const { version, lines } of RELEASES) {
			expect(lines.length, version).toBeGreaterThan(0);
			for (const line of lines) {
				expect(line.trim(), version).not.toBe('');
				expect(line, version).not.toMatch(/sprint/i);
			}
		}
	});
});
