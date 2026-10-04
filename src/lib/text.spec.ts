import { describe, expect, it } from 'vitest';
import { foldCase, formatQuantity, normalizeName } from './text.ts';

describe('normalizeName', () => {
	it('trims and collapses spaces', () => {
		expect(normalizeName('  Paper   towels ')).toBe('Paper towels');
	});
});

describe('foldCase', () => {
	// Escapes, so an editor can't quietly turn the accents into single characters.
	it('matches accented letters whichever way they were typed', () => {
		expect(foldCase('CAF\u00c9')).toBe(foldCase('Cafe\u0301'));
		expect(foldCase('J\u030cicama')).toBe(foldCase('\u01f0icama'));
	});
});

describe('formatQuantity', () => {
	it('drops trailing zeros', () => {
		expect(formatQuantity(2)).toBe('2');
		expect(formatQuantity(1.5)).toBe('1.5');
		expect(formatQuantity(1 / 3)).toBe('0.33');
	});
});
