import { describe, expect, it } from 'vitest';
import { parseAmount } from './amounts.ts';
import { scaleFactor, showAmount, showInBestUnit } from './scaling.ts';
import { normalizeUnit } from './units.ts';

describe('scaleFactor', () => {
	it('divides the target servings by the recipe servings', () => {
		expect(scaleFactor(6, 4)).toBe(1.5);
		expect(scaleFactor(2, 4)).toBe(0.5);
		expect(scaleFactor(12, 1)).toBe(12);
	});

	it('is exactly 1 at the recipe servings', () => {
		for (let servings = 1; servings <= 100; servings++) {
			expect(scaleFactor(servings, servings)).toBe(1);
		}
	});
});

describe('the table in design 6.6', () => {
	// The amount and unit as typed on the edit page, and servings that give the table's scale.
	const rows = [
		{ amount: '1/4', unit: 'cup', from: 4, to: 12, shown: '3/4 cup' }, // ×3
		{ amount: '1', unit: 'tsp', from: 1, to: 12, shown: '1/4 cup' }, // ×12
		{ amount: '1', unit: 'tbsp', from: 1, to: 16, shown: '1 cup' }, // ×16
		{ amount: '1/4', unit: 'cup', from: 4, to: 2, shown: '2 tbsp' }, // ×1/2
		{ amount: '1', unit: 'lb', from: 4, to: 2, shown: '8 oz' }, // ×1/2
		{ amount: '8', unit: 'oz', from: 4, to: 12, shown: '1 1/2 lb' }, // ×3
		{ amount: '1', unit: 'quart', from: 4, to: 8, shown: '8 cups' }, // ×2
		{ amount: '2', unit: 'cloves', from: 4, to: 6, shown: '3 cloves' }, // ×1 1/2
		{ amount: '1', unit: '', from: 4, to: 6, shown: '1 1/2' } // ×1 1/2, eggs (a count)
	];

	it.each(rows)('$amount $unit from $from to $to servings shows $shown', (row) => {
		const factor = scaleFactor(row.to, row.from);
		expect(showAmount(parseAmount(row.amount), normalizeUnit(row.unit), factor)).toBe(row.shown);
	});

	it('never scales an ingredient with no amount, such as salt', () => {
		for (const factor of [1, 0.5, 1.5, 3, 12]) expect(showAmount(null, null, factor)).toBeNull();
	});
});

describe('showAmount at the recipe servings', () => {
	it('shows amounts exactly as entered, without converting', () => {
		expect(showAmount(16, 'tbsp', 1)).toBe('16 tbsp');
		expect(showAmount(1, 'quart', 1)).toBe('1 quart');
		expect(showAmount(2, 'pint', 1)).toBe('2 pints');
		expect(showAmount(4, 'fl oz', 1)).toBe('4 fl oz');
		expect(showAmount(1 / 3, 'cup', 1)).toBe('1/3 cup');
		expect(showAmount(0.3, 'cup', 1)).toBe('0.3 cup');
		expect(showAmount(1.5, 'cup', 1)).toBe('1 1/2 cups');
		expect(showAmount(1 / 16, 'tsp', 1)).toBe('1/16 tsp');
		expect(showAmount(20, 'oz', 1)).toBe('20 oz');
		expect(showAmount(2, 'cloves', 1)).toBe('2 cloves');
		expect(showAmount(1, 'Large can', 1)).toBe('1 Large can');
		expect(showAmount(3, null, 1)).toBe('3');
		expect(showAmount(100, 'g', 1)).toBe('100 g');
	});

	it('follows the number shown for the plural', () => {
		expect(showAmount(1, 'cup', 1)).toBe('1 cup');
		expect(showAmount(1.0004, 'cup', 1)).toBe('1 cup');
		expect(showAmount(1.006, 'cup', 1)).toBe('1.006 cups');
		expect(showAmount(0.5, 'gallon', 1)).toBe('1/2 gallon');
	});
});

describe('showAmount when scaled', () => {
	it('converts volumes and weights to the unit whose range contains them', () => {
		expect(showAmount(1, 'tsp', 2)).toBe('2 tsp');
		expect(showAmount(1, 'tsp', 3)).toBe('1 tbsp');
		expect(showAmount(1, 'fl oz', 2)).toBe('1/4 cup');
		expect(showAmount(1, 'fl oz', 0.5)).toBe('1 tbsp');
		expect(showAmount(1, 'pint', 2)).toBe('4 cups');
		expect(showAmount(2, 'quart', 2)).toBe('1 gallon');
		expect(showAmount(1, 'gallon', 3)).toBe('3 gallons');
		expect(showAmount(1, 'lb', 1 / 3)).toBe('5 1/3 oz');
		expect(showAmount(3 / 4, 'lb', 2)).toBe('1 1/2 lb');
		expect(showAmount(4, 'oz', 2)).toBe('8 oz');
	});

	it('handles 1/3 cup times 3 and other thirds', () => {
		expect(showAmount(parseAmount('1/3'), 'cup', 3)).toBe('1 cup');
		expect(showAmount(parseAmount('1/3'), 'cup', 1.5)).toBe('1/2 cup');
		expect(showAmount(parseAmount('1/3'), 'cup', 6)).toBe('2 cups');
		expect(showAmount(parseAmount('2/3'), 'cup', scaleFactor(6, 4))).toBe('1 cup');
		expect(showAmount(parseAmount('1/3'), 'cup', 0.5)).toBe('2 2/3 tbsp');
	});

	it('follows the rounded number for the plural', () => {
		expect(showAmount(0.51, 'cup', 2)).toBe('1 cup');
		expect(showAmount(0.485, 'cup', 2)).toBe('1 cup');
		expect(showAmount(0.55, 'cup', 2)).toBe('1 1/8 cups');
		expect(showAmount(0.51, 'gallon', 2)).toBe('1 gallon');
		expect(showAmount(0.6, 'gallon', 2)).toBe('1 1/4 gallons');
	});

	it('moves to the next unit when rounding reaches it', () => {
		// 2.95 tsp rounds to 3 tsp, which is 1 tbsp.
		expect(showAmount(0.59, 'tsp', 5)).toBe('1 tbsp');
		// 3.97 tbsp rounds to 4 tbsp, which is 1/4 cup.
		expect(showAmount(1.985, 'tbsp', 2)).toBe('1/4 cup');
		// 15.95 cups rounds to 16 cups, which is 1 gallon.
		expect(showAmount(7.975, 'cup', 2)).toBe('1 gallon');
		// 15.9 oz rounds to 16 oz, which is 1 lb.
		expect(showAmount(7.95, 'oz', 2)).toBe('1 lb');
		// 2.87 tsp rounds to 2 3/4 tsp, so it stays in tsp.
		expect(showAmount(1.435, 'tsp', 2)).toBe('2 3/4 tsp');
	});

	it('shows anything above zero as at least 1/8', () => {
		expect(showAmount(1 / 8, 'tsp', 1 / 4)).toBe('1/8 tsp');
		expect(showAmount(1, 'pinch', 0.05)).toBe('1/8 pinch');
		expect(showAmount(1, null, 0.01)).toBe('1/8');
	});

	it('scales custom units and counts without converting, keeping the unit as typed', () => {
		expect(showAmount(100, 'g', 2)).toBe('200 g');
		expect(showAmount(2, 'cloves', 1.25)).toBe('2 1/2 cloves');
		expect(showAmount(1, 'Clove', 3)).toBe('3 Clove');
		expect(showAmount(3, null, 0.5)).toBe('1 1/2');
		expect(showAmount(1, null, 1 / 3)).toBe('1/3');
		expect(showAmount(2, null, 2)).toBe('4');
	});
});

describe('showInBestUnit', () => {
	it('shows a volume in tsp or a weight in oz in its best unit', () => {
		expect(showInBestUnit('volume', 54)).toBe('1 1/8 cups');
		expect(showInBestUnit('volume', 6)).toBe('2 tbsp');
		expect(showInBestUnit('volume', 1)).toBe('1 tsp');
		expect(showInBestUnit('volume', 1536)).toBe('2 gallons');
		expect(showInBestUnit('weight', 24)).toBe('1 1/2 lb');
		expect(showInBestUnit('weight', 15.9)).toBe('1 lb');
		expect(showInBestUnit('weight', 0.01)).toBe('1/8 oz');
	});
});
