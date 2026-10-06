import { normalizeName } from './text.ts';

// Known units and how much each holds (design 6.5), and the ranges that scaled amounts are
// shown in (6.6). Anything else is a custom unit, which scales but doesn't convert.

export type UnitKind = 'volume' | 'weight';
export type KnownUnitCode =
	| 'tsp'
	| 'tbsp'
	| 'fl oz'
	| 'cup'
	| 'pint'
	| 'quart'
	| 'gallon'
	| 'oz'
	| 'lb';
/** size is how many tsp (volume) or oz (weight) the unit holds. */
export type KnownUnit = { code: KnownUnitCode; kind: UnitKind; size: number; plural: string };

const TSP: KnownUnit = { code: 'tsp', kind: 'volume', size: 1, plural: 'tsp' };
const TBSP: KnownUnit = { code: 'tbsp', kind: 'volume', size: 3, plural: 'tbsp' };
const CUP: KnownUnit = { code: 'cup', kind: 'volume', size: 48, plural: 'cups' };
const GALLON: KnownUnit = { code: 'gallon', kind: 'volume', size: 768, plural: 'gallons' };
const OZ: KnownUnit = { code: 'oz', kind: 'weight', size: 1, plural: 'oz' };
const LB: KnownUnit = { code: 'lb', kind: 'weight', size: 16, plural: 'lb' };

/** In the order the unit picker offers them. */
export const KNOWN_UNITS: readonly KnownUnit[] = [
	TSP,
	TBSP,
	{ code: 'fl oz', kind: 'volume', size: 6, plural: 'fl oz' },
	CUP,
	{ code: 'pint', kind: 'volume', size: 96, plural: 'pints' },
	{ code: 'quart', kind: 'volume', size: 192, plural: 'quarts' },
	GALLON,
	OZ,
	LB
];

/** The known unit with exactly this code, as units are stored. */
export function knownUnit(unit: string): KnownUnit | undefined {
	return KNOWN_UNITS.find((known) => known.code === unit);
}

// What people type for each unit. Compared ignoring case, spaces and periods, so "Fl. Oz." and
// "floz" are both fl oz.
const SPELLINGS: Record<KnownUnitCode, string[]> = {
	tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
	tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons'],
	'fl oz': ['fl oz', 'fluid ounce', 'fluid ounces'],
	cup: ['c', 'cup', 'cups'],
	pint: ['pt', 'pts', 'pint', 'pints'],
	quart: ['qt', 'qts', 'quart', 'quarts'],
	gallon: ['gal', 'gals', 'gallon', 'gallons'],
	oz: ['oz', 'ounce', 'ounces'],
	lb: ['lb', 'lbs', 'pound', 'pounds']
};

function spellingKey(text: string): string {
	return text.toLowerCase().replace(/[\s.]/g, '');
}

const codesBySpelling = new Map(
	Object.entries(SPELLINGS).flatMap(([code, spellings]) =>
		spellings.map((spelling) => [spellingKey(spelling), code] as const)
	)
);

/**
 * A unit as typed, as it's stored: a known unit's code, anything else as a custom unit (trimmed,
 * spaces collapsed), or null when blank.
 */
export function normalizeUnit(text: string): string | null {
	const unit = normalizeName(text);
	if (unit === '') return null;
	// Recipe shorthand where case matters: t is a teaspoon and T a tablespoon.
	if (unit === 't') return 'tsp';
	if (unit === 'T') return 'tbsp';
	return codesBySpelling.get(spellingKey(unit)) ?? unit;
}

/**
 * A unit as shown after an amount: "cup" for 1 or less and "cups" above 1. tsp, tbsp, fl oz, oz
 * and lb never change, and custom units show as stored.
 */
export function unitLabel(unit: string, amount: number): string {
	const known = knownUnit(unit);
	if (!known) return unit;
	return amount > 1 ? known.plural : known.code;
}

/** An amount in tsp (volume) or oz (weight). */
export function toBase(amount: number, unit: KnownUnit): number {
	return amount * unit.size;
}

/**
 * The unit whose range contains an amount in tsp or oz (6.6). Volume: tsp below 1 tbsp, tbsp
 * below 1/4 cup, cups below 1 gallon, then gallons. Weight: oz below 1 lb, then lb. Pint, quart
 * and fl oz are never picked. To show an amount, use showInBestUnit from scaling.ts, which also
 * handles rounding up into the next range.
 */
export function bestUnit(kind: UnitKind, base: number): KnownUnit {
	if (kind === 'weight') return base < LB.size ? OZ : LB;
	if (base < TBSP.size) return TSP;
	if (base < CUP.size / 4) return TBSP;
	if (base < GALLON.size) return CUP;
	return GALLON;
}
