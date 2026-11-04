import { describe, expect, it } from 'vitest';
import { foldCase, formatQuantity, joinAnd, NORMALIZE_MAX_LENGTH, normalizeName } from './text.ts';

// A run of combining marks of two classes, which normalizing reorders: slow to normalize when long.
const MARKS = 'a' + '\u0301\u0316'.repeat(NORMALIZE_MAX_LENGTH);

describe('normalizeName', () => {
	it('trims and collapses spaces', () => {
		expect(normalizeName('  Paper   towels ')).toBe('Paper towels');
	});

	it('refuses text too long to normalize quickly (MEA-64)', () => {
		expect(normalizeName('a'.repeat(NORMALIZE_MAX_LENGTH))).toHaveLength(NORMALIZE_MAX_LENGTH);
		expect(() => normalizeName('a'.repeat(NORMALIZE_MAX_LENGTH + 1))).toThrow(
			'Text of 10001 characters is too long to normalize'
		);
		expect(() => normalizeName(MARKS)).toThrow('too long to normalize');
	});
});

describe('foldCase', () => {
	// Escapes, so an editor can't quietly turn the accents into single characters.
	it('matches accented letters whichever way they were typed', () => {
		expect(foldCase('CAF\u00c9')).toBe(foldCase('Cafe\u0301'));
		expect(foldCase('J\u030cicama')).toBe(foldCase('\u01f0icama'));
	});

	it('refuses text too long to normalize quickly (MEA-64)', () => {
		expect(foldCase('A'.repeat(NORMALIZE_MAX_LENGTH))).toBe('a'.repeat(NORMALIZE_MAX_LENGTH));
		expect(() => foldCase('A'.repeat(NORMALIZE_MAX_LENGTH + 1))).toThrow(
			'Text of 10001 characters is too long to normalize'
		);
		expect(() => foldCase(MARKS)).toThrow('too long to normalize');
	});
});

describe('formatQuantity', () => {
	it('drops trailing zeros', () => {
		expect(formatQuantity(2)).toBe('2');
		expect(formatQuantity(1.5)).toBe('1.5');
		expect(formatQuantity(1 / 3)).toBe('0.33');
	});
});

describe('joinAnd', () => {
	it('lists one, two or more in words', () => {
		expect(joinAnd([])).toBe('');
		expect(joinAnd(['Salt'])).toBe('Salt');
		expect(joinAnd(['Salt', 'Pepper'])).toBe('Salt and Pepper');
		expect(joinAnd(['Salt', 'Pepper', 'Cumin'])).toBe('Salt, Pepper and Cumin');
	});
});
