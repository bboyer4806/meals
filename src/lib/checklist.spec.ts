import { describe, expect, it } from 'vitest';
import {
	combineAmounts,
	menuSource,
	needNote,
	rangeLabel,
	type ChecklistEntry
} from './checklist.ts';

function entry(
	amount: number | null,
	unit: string | null,
	source: string,
	factor = 1
): ChecklistEntry {
	return { amount, unit, factor, source };
}

describe('combineAmounts', () => {
	it('shows one total with the amount for each recipe under it (change 2.1.2)', () => {
		expect(
			combineAmounts([entry(1, 'cup', 'Pound cake, Tue'), entry(2, 'tbsp', 'Pan sauce, Thu')])
		).toEqual({
			totals: ['1 1/8 cups'],
			unmeasured: false,
			breakdown: [
				{ source: 'Pound cake, Tue', amount: '1 cup' },
				{ source: 'Pan sauce, Thu', amount: '2 tbsp' }
			]
		});
	});

	it('gives one total per kind: volume, weight, custom units as first seen, then counts', () => {
		const combined = combineAmounts([
			entry(2, null, 'Omelet'),
			entry(1, 'clove', 'Pan sauce'),
			entry(4, 'oz', 'Salad'),
			entry(1, 'can', 'Soup'),
			entry(1, 'tbsp', 'Dressing'),
			entry(1, null, 'Frittata')
		]);
		expect(combined.totals).toEqual(['1 tbsp', '4 oz', '1 clove', '1 can', '3']);
	});

	it('never converts volume and weight into each other (design 6.5)', () => {
		expect(combineAmounts([entry(1, 'cup', 'A'), entry(8, 'oz', 'B')]).totals).toEqual([
			'1 cup',
			'8 oz'
		]);
	});

	it('adds volumes and weights in any known unit', () => {
		expect(
			combineAmounts([entry(1, 'pint', 'A'), entry(1, 'cup', 'B'), entry(4, 'tbsp', 'C')]).totals
		).toEqual(['3 1/4 cups']);
		expect(combineAmounts([entry(12, 'oz', 'A'), entry(1 / 2, 'lb', 'B')]).totals).toEqual([
			'1 1/4 lb'
		]);
		expect(combineAmounts([entry(1, 'quart', 'A'), entry(3, 'quart', 'B')]).totals).toEqual([
			'1 gallon'
		]);
	});

	it('groups custom units that differ only in case, keeping the first spelling', () => {
		const combined = combineAmounts([
			entry(2, 'Cloves', 'A'),
			entry(1, 'g', 'B'),
			entry(1, 'cloves', 'C'),
			entry(50, 'G', 'D'),
			entry(1, 'CLOVES', 'E')
		]);
		expect(combined.totals).toEqual(['4 Cloves', '51 g']);
		expect(combined.breakdown.map((line) => line.amount)).toEqual([
			'2 Cloves',
			'1 g',
			'1 cloves',
			'50 G',
			'1 CLOVES'
		]);
	});

	it('scales each entry by its own factor', () => {
		const combined = combineAmounts([entry(1, 'cup', 'A', 2), entry(1, 'cup', 'B', 1 / 2)]);
		expect(combined.totals).toEqual(['2 1/2 cups']);
		expect(combined.breakdown).toEqual([
			{ source: 'A', amount: '2 cups' },
			{ source: 'B', amount: '1/2 cup' }
		]);
		expect(combineAmounts([entry(1, null, 'A', 1.5), entry(2, null, 'B')]).totals).toEqual([
			'3 1/2'
		]);
	});

	it('shows totals in the best unit and kitchen fractions, even at the recipe servings', () => {
		const combined = combineAmounts([entry(16, 'tbsp', 'A')]);
		expect(combined.totals).toEqual(['1 cup']);
		expect(combined.breakdown).toEqual([{ source: 'A', amount: '16 tbsp' }]);
		expect(combineAmounts([entry(1, 'quart', 'A')]).totals).toEqual(['4 cups']);
		expect(combineAmounts([entry(0.3, 'cup', 'A')]).totals).toEqual(['1/3 cup']);
		expect(combineAmounts([entry(1.3, 'can', 'A')]).totals).toEqual(['1 1/3 can']);
	});

	it('adds amounts before rounding', () => {
		// Each part shows as 1/8 pinch, but together they're 0.4, which is nearest 1/3.
		const pinches = [1, 2, 3, 4].map((n) => entry(1, 'pinch', `Batch ${n}`, 0.1));
		expect(combineAmounts(pinches).totals).toEqual(['1/3 pinch']);
		expect(combineAmounts(pinches).breakdown[0]?.amount).toBe('1/8 pinch');
		const thirds = [1, 2, 3].map((n) => entry(1 / 3, 'cup', `Batch ${n}`));
		expect(combineAmounts(thirds).totals).toEqual(['1 cup']);
	});

	it('marks entries with no amount and leaves them out of the totals', () => {
		const combined = combineAmounts([entry(1, 'tsp', 'Soup'), entry(null, null, 'Salad')]);
		expect(combined).toEqual({
			totals: ['1 tsp'],
			unmeasured: true,
			breakdown: [
				{ source: 'Soup', amount: '1 tsp' },
				{ source: 'Salad', amount: null }
			]
		});
		expect(combineAmounts([entry(null, null, 'Salad', 2)])).toEqual({
			totals: [],
			unmeasured: true,
			breakdown: [{ source: 'Salad', amount: null }]
		});
	});

	it('has nothing for no entries', () => {
		expect(combineAmounts([])).toEqual({ totals: [], unmeasured: false, breakdown: [] });
	});
});

describe('needNote', () => {
	it('gives the totals and the recipes (Q4)', () => {
		expect(
			needNote(combineAmounts([entry(1, 'cup', 'Pound cake'), entry(2, 'tbsp', 'Pound cake')]))
		).toBe('1 1/8 cups for Pound cake');
		expect(
			needNote(combineAmounts([entry(1, 'cup', 'Pound cake'), entry(2, 'cloves', 'Pan sauce')]))
		).toBe('1 cup + 2 cloves for Pound cake, Pan sauce');
	});

	it('matches the example in design 6.8', () => {
		const combined = combineAmounts([
			entry(1, 'cup', 'Pound cake (Tue)'),
			entry(2, 'tbsp', 'Pan sauce (Thu)')
		]);
		expect(needNote(combined)).toBe('1 1/8 cups for Pound cake (Tue), Pan sauce (Thu)');
	});

	it('names only the recipes when nothing is measured', () => {
		expect(needNote(combineAmounts([entry(null, null, 'Pound cake')]))).toBe('For Pound cake');
		expect(needNote(combineAmounts([entry(null, null, 'Soup'), entry(null, null, 'Salad')]))).toBe(
			'For Soup, Salad'
		);
	});

	it('adds "some" when only some recipes have an amount', () => {
		expect(needNote(combineAmounts([entry(1, 'tsp', 'Soup'), entry(null, null, 'Salad')]))).toBe(
			'1 tsp + some for Soup, Salad'
		);
	});

	it('names each recipe once, in order', () => {
		expect(
			needNote(
				combineAmounts([entry(1, 'cup', 'Soup'), entry(1, 'cup', 'Salad'), entry(1, 'cup', 'Soup')])
			)
		).toBe('3 cups for Soup, Salad');
	});

	it('keeps to 200 characters', () => {
		expect(needNote(combineAmounts([entry(1, 'cup', 'x'.repeat(190))]))).toBe(
			`1 cup for ${'x'.repeat(190)}`
		);
		const cut = needNote(combineAmounts([entry(1, 'cup', 'x'.repeat(191))]));
		expect(cut).toBe(`1 cup for ${'x'.repeat(187)}...`);
		expect(cut).toHaveLength(200);

		const names = Array.from({ length: 12 }, (_, i) => `Recipe with a long name ${i + 1}`);
		const many = needNote(combineAmounts(names.map((name) => entry(1, 'cup', name))));
		expect(many.length).toBeLessThanOrEqual(200);
		expect(many).toMatch(/^12 cups for Recipe with a long name 1, Recipe with a long name 2, /);
		expect(many).toMatch(/\S\.\.\.$/);
	});

	it('does not cut an emoji in half', () => {
		// Each emoji is two characters, and the cut at 197 falls inside the 97th.
		expect(needNote(combineAmounts([entry(null, null, '🍰'.repeat(100))]))).toBe(
			`For ${'🍰'.repeat(96)}...`
		);
		expect(needNote(combineAmounts([entry(null, null, `x${'🍰'.repeat(100)}`)]))).toBe(
			`For x${'🍰'.repeat(96)}...`
		);
	});
});

// Oct 4, 2026 is a Sunday.
describe('menuSource', () => {
	it('names the dish with its weekday in a check of a week or less (assumption 4)', () => {
		expect(menuSource('Pound cake', '2026-10-06', '2026-10-04', '2026-10-10')).toBe(
			'Pound cake (Tue)'
		);
		expect(menuSource('Pan sauce', '2026-10-08', '2026-10-04', '2026-10-10')).toBe(
			'Pan sauce (Thu)'
		);
		// Across a month and a year.
		expect(menuSource('Soup', '2027-01-01', '2026-12-29', '2027-01-04')).toBe('Soup (Fri)');
		expect(menuSource('Soup', '2026-10-07', '2026-10-07', '2026-10-07')).toBe('Soup (Wed)');
	});

	it('names the date instead in a longer check, where a weekday comes up twice', () => {
		// 8 days: Sunday to the next Sunday.
		expect(menuSource('Pound cake', '2026-10-04', '2026-10-04', '2026-10-11')).toBe(
			'Pound cake (Oct 4)'
		);
		expect(menuSource('Pound cake', '2026-10-11', '2026-10-04', '2026-10-11')).toBe(
			'Pound cake (Oct 11)'
		);
		expect(menuSource('Soup', '2027-01-02', '2026-12-27', '2027-01-09')).toBe('Soup (Jan 2)');
	});
});

describe('rangeLabel', () => {
	it('gives the first and last dates', () => {
		expect(rangeLabel('2026-10-07', '2026-10-13')).toBe('Wed, Oct 7 to Tue, Oct 13');
		expect(rangeLabel('2026-12-27', '2027-01-09')).toBe('Sun, Dec 27 to Sat, Jan 9');
	});

	it('gives one date for a one-day check', () => {
		expect(rangeLabel('2026-10-07', '2026-10-07')).toBe('Wed, Oct 7');
	});
});
