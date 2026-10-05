import { describe, expect, it } from 'vitest';
import { exactAmount, formatExact, formatKitchen, kitchenAmount, parseAmount } from './amounts.ts';

describe('parseAmount', () => {
	it('reads the forms in design 6.5', () => {
		expect(parseAmount('2')).toBe(2);
		expect(parseAmount('1.5')).toBe(1.5);
		expect(parseAmount('1 1/2')).toBe(1.5);
		expect(parseAmount('1/2')).toBe(0.5);
		expect(parseAmount('½')).toBe(0.5);
	});

	it('reads decimals without a leading zero and fraction characters with a whole number', () => {
		expect(parseAmount('.5')).toBe(0.5);
		expect(parseAmount('1½')).toBe(1.5);
		expect(parseAmount('1 ½')).toBe(1.5);
		expect(parseAmount('2¾')).toBe(2.75);
	});

	it('reads every fraction character', () => {
		expect(['¼', '½', '¾', '⅓', '⅔', '⅛', '⅜', '⅝', '⅞'].map(parseAmount)).toEqual([
			1 / 4,
			1 / 2,
			3 / 4,
			1 / 3,
			2 / 3,
			1 / 8,
			3 / 8,
			5 / 8,
			7 / 8
		]);
	});

	it('allows extra spaces, a hyphen in a mixed number and the fraction slash', () => {
		expect(parseAmount('  1   1/2 ')).toBe(1.5);
		expect(parseAmount('1 / 3')).toBe(1 / 3);
		expect(parseAmount('1-1/2')).toBe(1.5);
		expect(parseAmount('1\u20442')).toBe(0.5);
		expect(parseAmount('3/2')).toBe(1.5);
		expect(parseAmount('10000')).toBe(10_000);
	});

	it('rejects blanks, zero, negatives and anything that is not an amount', () => {
		for (const text of [
			'',
			'  ',
			'0',
			'0.0',
			'0/4',
			'1/0',
			'-1',
			'+1',
			'abc',
			'1e3',
			'Infinity',
			'NaN',
			'1,5',
			'2 to 3',
			'2-3',
			'1/2/3',
			'½½',
			'1.5 1/2',
			'1 cup',
			'.'
		]) {
			expect(parseAmount(text), text).toBeNull();
		}
	});
});

describe('formatExact', () => {
	it('shows amounts as entered', () => {
		expect(formatExact(1.5)).toBe('1 1/2');
		expect(formatExact(1 / 3)).toBe('1/3');
		expect(formatExact(0.3)).toBe('0.3');
		expect(formatExact(2)).toBe('2');
	});

	it('uses halves, thirds, quarters, eighths and sixteenths in lowest terms', () => {
		expect(formatExact(0.5)).toBe('1/2');
		expect(formatExact(2 / 3)).toBe('2/3');
		expect(formatExact(2.25)).toBe('2 1/4');
		expect(formatExact(0.75)).toBe('3/4');
		expect(formatExact(0.375)).toBe('3/8');
		expect(formatExact(7 / 8)).toBe('7/8');
		expect(formatExact(1 / 16)).toBe('1/16');
		expect(formatExact(3 / 16)).toBe('3/16');
	});

	it('shows what parseAmount read', () => {
		const cases = [
			['2', '2'],
			['1 1/2', '1 1/2'],
			['1/3', '1/3'],
			['2 2/3', '2 2/3'],
			['⅛', '1/8'],
			['5/16', '5/16'],
			['0.3', '0.3'],
			['1.75', '1 3/4'],
			['4/8', '1/2'],
			['12', '12']
		];
		for (const [typed, shown] of cases) {
			expect(formatExact(parseAmount(typed!) ?? NaN), typed).toBe(shown);
		}
	});

	it('allows for floating point within 1e-6', () => {
		expect(formatExact(0.333333333)).toBe('1/3');
		expect(formatExact(1.9999999)).toBe('2');
		expect(formatExact(2.0000001)).toBe('2');
		expect(formatExact(0.3333)).toBe('0.333');
	});

	it('shows other amounts with up to 3 decimal places and no trailing zeros', () => {
		expect(formatExact(0.1)).toBe('0.1');
		expect(formatExact(0.05)).toBe('0.05');
		expect(formatExact(2.1)).toBe('2.1');
		expect(formatExact(1.23456)).toBe('1.235');
		expect(formatExact(0.2)).toBe('0.2');
	});

	it('never shows an amount above zero as 0', () => {
		expect(formatExact(0.0004)).toBe('0.001');
		expect(formatExact(1e-9)).toBe('0.001');
		expect(formatExact(0)).toBe('0');
	});
});

describe('exactAmount', () => {
	it('gives the number shown', () => {
		expect(exactAmount(1.5)).toEqual({ text: '1 1/2', value: 1.5 });
		expect(exactAmount(1.0000004)).toEqual({ text: '1', value: 1 });
		expect(exactAmount(1.0004)).toEqual({ text: '1', value: 1 });
		expect(exactAmount(1.0006)).toEqual({ text: '1.001', value: 1.001 });
	});
});

describe('formatKitchen', () => {
	it('rounds to kitchen fractions', () => {
		expect(formatKitchen(1.125)).toBe('1 1/8');
		expect(formatKitchen(0.75)).toBe('3/4');
		expect(formatKitchen(2)).toBe('2');
		expect(formatKitchen(0.3)).toBe('1/3');
		expect(formatKitchen(0.27)).toBe('1/4');
		expect(formatKitchen(0.45)).toBe('1/2');
		expect(formatKitchen(1.7)).toBe('1 2/3');
		expect(formatKitchen(2.1)).toBe('2 1/8');
		expect(formatKitchen(1 / 3)).toBe('1/3');
	});

	it('rounds up into the next whole number', () => {
		expect(formatKitchen(2.95)).toBe('3');
		expect(formatKitchen(0.95)).toBe('1');
		expect(formatKitchen(15.9)).toBe('16');
		expect(formatKitchen(2.9999999999999996)).toBe('3');
	});

	it('rounds a tie up, so 7/8 shows as the next whole number', () => {
		expect(formatKitchen(0.875)).toBe('1');
		expect(formatKitchen(1.875)).toBe('2');
		expect(formatKitchen(1.87)).toBe('1 3/4');
		expect(formatKitchen(1.88)).toBe('2');
		expect(formatKitchen(0.0625)).toBe('1/8');
		expect(formatKitchen(5 / 12)).toBe('1/2');
	});

	it('rounds the eighths it does not show to the nearest fraction', () => {
		expect(formatKitchen(3 / 8)).toBe('1/3');
		expect(formatKitchen(5 / 8)).toBe('2/3');
		expect(formatKitchen(1 + 3 / 8)).toBe('1 1/3');
	});

	it('shows anything above zero as at least 1/8', () => {
		expect(formatKitchen(0.01)).toBe('1/8');
		expect(formatKitchen(0.0001)).toBe('1/8');
		expect(formatKitchen(0.06)).toBe('1/8');
	});

	it('shows zero as 0', () => {
		expect(formatKitchen(0)).toBe('0');
	});

	it('is not thrown off by floating point', () => {
		expect(formatKitchen((1 / 3) * 3)).toBe('1');
		expect(formatKitchen(0.1 + 0.2)).toBe('1/3');
		expect(formatKitchen((2 / 3) * 1.5)).toBe('1');
	});
});

describe('kitchenAmount', () => {
	it('gives the number shown', () => {
		expect(kitchenAmount(1.02)).toEqual({ text: '1', value: 1 });
		expect(kitchenAmount(2.95)).toEqual({ text: '3', value: 3 });
		expect(kitchenAmount(0.01)).toEqual({ text: '1/8', value: 1 / 8 });
		expect(kitchenAmount(1.3).value).toBeCloseTo(4 / 3, 12);
	});
});
