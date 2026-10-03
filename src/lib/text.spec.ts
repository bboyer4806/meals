import { describe, expect, it } from 'vitest';
import { formatQuantity, normalizeName } from './text.ts';

describe('normalizeName', () => {
	it('trims and collapses spaces', () => {
		expect(normalizeName('  Paper   towels ')).toBe('Paper towels');
	});
});

describe('formatQuantity', () => {
	it('drops trailing zeros', () => {
		expect(formatQuantity(2)).toBe('2');
		expect(formatQuantity(1.5)).toBe('1.5');
		expect(formatQuantity(1 / 3)).toBe('0.33');
	});
});
