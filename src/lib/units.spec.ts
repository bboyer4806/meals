import { describe, expect, it } from 'vitest';
import {
	bestUnit,
	KNOWN_UNITS,
	knownUnit,
	normalizeUnit,
	toBase,
	unitLabel,
	type KnownUnitCode
} from './units.ts';

function unit(code: KnownUnitCode) {
	const found = knownUnit(code);
	if (!found) throw new Error(`No unit ${code}`);
	return found;
}

describe('KNOWN_UNITS', () => {
	it('holds what the table in design 6.5 says, in the picker order', () => {
		expect(KNOWN_UNITS.map((u) => [u.code, u.kind, u.size])).toEqual([
			['tsp', 'volume', 1],
			['tbsp', 'volume', 3],
			['fl oz', 'volume', 6],
			['cup', 'volume', 48],
			['pint', 'volume', 96],
			['quart', 'volume', 192],
			['gallon', 'volume', 768],
			['oz', 'weight', 1],
			['lb', 'weight', 16]
		]);
	});
});

describe('knownUnit', () => {
	it('matches stored codes exactly', () => {
		expect(knownUnit('cup')?.size).toBe(48);
		expect(knownUnit('fl oz')?.size).toBe(6);
		expect(knownUnit('cups')).toBeUndefined();
		expect(knownUnit('Cup')).toBeUndefined();
		expect(knownUnit('cloves')).toBeUndefined();
	});
});

describe('normalizeUnit', () => {
	it('maps the spellings in design 6.5', () => {
		expect(normalizeUnit('teaspoons')).toBe('tsp');
		expect(normalizeUnit('Tbsp')).toBe('tbsp');
		expect(normalizeUnit('tablespoon')).toBe('tbsp');
		expect(normalizeUnit('c')).toBe('cup');
		expect(normalizeUnit('cups')).toBe('cup');
		expect(normalizeUnit('ounces')).toBe('oz');
		expect(normalizeUnit('lbs')).toBe('lb');
		expect(normalizeUnit('pounds')).toBe('lb');
	});

	it('maps every listed spelling, ignoring case', () => {
		const spellings: Record<KnownUnitCode, string[]> = {
			tsp: ['tsp', 'tsps', 'tsp.', 'teaspoon', 'teaspoons'],
			tbsp: ['tbsp', 'tbsps', 'tbsp.', 'tbs', 'tbl', 'tablespoon', 'tablespoons'],
			'fl oz': ['fl oz', 'fl. oz.', 'fl.oz.', 'floz', 'fluid ounce', 'fluid ounces'],
			cup: ['c', 'c.', 'cup', 'cups'],
			pint: ['pt', 'pt.', 'pint', 'pints'],
			quart: ['qt', 'qt.', 'quart', 'quarts'],
			gallon: ['gal', 'gal.', 'gallon', 'gallons'],
			oz: ['oz', 'oz.', 'ounce', 'ounces'],
			lb: ['lb', 'lb.', 'lbs', 'lbs.', 'pound', 'pounds']
		};
		for (const [code, list] of Object.entries(spellings)) {
			for (const spelling of list) {
				expect(normalizeUnit(spelling), spelling).toBe(code);
				expect(normalizeUnit(spelling.toUpperCase()), spelling.toUpperCase()).toBe(code);
			}
		}
		expect(normalizeUnit('Fl. Oz.')).toBe('fl oz');
		expect(normalizeUnit('C')).toBe('cup');
	});

	it('reads a lone t as a teaspoon and T as a tablespoon', () => {
		expect(normalizeUnit('t')).toBe('tsp');
		expect(normalizeUnit(' T ')).toBe('tbsp');
	});

	it('keeps anything else as a custom unit, trimmed with spaces collapsed', () => {
		expect(normalizeUnit('clove')).toBe('clove');
		expect(normalizeUnit('can')).toBe('can');
		expect(normalizeUnit('pinch')).toBe('pinch');
		expect(normalizeUnit('g')).toBe('g');
		expect(normalizeUnit('ml')).toBe('ml');
		expect(normalizeUnit('  Large   cans ')).toBe('Large cans');
		expect(normalizeUnit('sticks')).toBe('sticks');
	});

	it('returns null when blank', () => {
		expect(normalizeUnit('')).toBeNull();
		expect(normalizeUnit('   ')).toBeNull();
	});
});

describe('unitLabel', () => {
	it('uses the plural above 1', () => {
		expect(unitLabel('cup', 1 / 2)).toBe('cup');
		expect(unitLabel('cup', 1)).toBe('cup');
		expect(unitLabel('cup', 1.125)).toBe('cups');
		expect(unitLabel('cup', 8)).toBe('cups');
		expect(unitLabel('pint', 2)).toBe('pints');
		expect(unitLabel('quart', 1)).toBe('quart');
		expect(unitLabel('quart', 1.5)).toBe('quarts');
		expect(unitLabel('gallon', 3)).toBe('gallons');
	});

	it('never changes tsp, tbsp, fl oz, oz or lb', () => {
		for (const code of ['tsp', 'tbsp', 'fl oz', 'oz', 'lb']) {
			expect(unitLabel(code, 1)).toBe(code);
			expect(unitLabel(code, 2.5)).toBe(code);
		}
	});

	it('shows custom units as stored', () => {
		expect(unitLabel('cloves', 1)).toBe('cloves');
		expect(unitLabel('Can', 3)).toBe('Can');
	});
});

describe('toBase', () => {
	it('converts to tsp or oz', () => {
		expect(toBase(1, unit('cup'))).toBe(48);
		expect(toBase(2, unit('tbsp'))).toBe(6);
		expect(toBase(1 / 2, unit('gallon'))).toBe(384);
		expect(toBase(1.5, unit('lb'))).toBe(24);
	});
});

describe('bestUnit', () => {
	function code(kind: 'volume' | 'weight', base: number) {
		return bestUnit(kind, base).code;
	}

	it('picks the volume unit whose range contains the amount (design 6.6)', () => {
		expect(code('volume', 0.1)).toBe('tsp');
		expect(code('volume', 2.99)).toBe('tsp');
		expect(code('volume', 3)).toBe('tbsp');
		expect(code('volume', 11.99)).toBe('tbsp');
		expect(code('volume', 12)).toBe('cup');
		expect(code('volume', 767.9)).toBe('cup');
		expect(code('volume', 768)).toBe('gallon');
		expect(code('volume', 10_000)).toBe('gallon');
	});

	it('picks oz below 1 lb and lb from 1 lb', () => {
		expect(code('weight', 0.5)).toBe('oz');
		expect(code('weight', 15.99)).toBe('oz');
		expect(code('weight', 16)).toBe('lb');
		expect(code('weight', 100)).toBe('lb');
	});

	it('never picks pint, quart or fl oz', () => {
		const picked = new Set<string>();
		for (let base = 0.25; base < 2000; base += 0.25) picked.add(code('volume', base));
		expect([...picked]).toEqual(['tsp', 'tbsp', 'cup', 'gallon']);
	});
});
