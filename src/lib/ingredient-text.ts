import { normalizeName } from './text.ts';
import { knownUnit, normalizeUnit } from './units.ts';

// Splitting an ingredient written as one line, such as "1 1/2 cups flour, sifted", into the
// recipe editor's amount, unit, item and prep note (design 6.5). The parts are text, checked
// and stored as if typed into the editor.

export type IngredientParts = { amount: string; unit: string; item: string; prepNote: string };

// Units that aren't known units (6.5) but often follow an amount, singular and plural.
const COMMON_UNITS = new Set(
	[
		'bottle',
		'bunch',
		'can',
		'clove',
		'dash',
		'g',
		'handful',
		'head',
		'jar',
		'kg',
		'ml',
		'package',
		'piece',
		'pinch',
		'slice',
		'sprig',
		'stick'
	].flatMap((unit) => [unit, /(?:ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`])
);

// One amount as parseAmount reads it: "1 1/2", "1-1/2", "1/2", "1½", "½", "1.5" or ".5".
const FRACTIONS = '¼½¾⅓⅔⅛⅜⅝⅞';
const SINGLE =
	`(?:\\d+\\s*[${FRACTIONS}]|[${FRACTIONS}]|\\d+(?:\\s+|\\s*-\\s*)\\d+\\s*[/⁄]\\s*\\d+|` +
	`\\d+\\s*[/⁄]\\s*\\d+|\\d+(?:\\.\\d*)?|\\.\\d+)`;
// The amount, then the rest after a space or a comma, or nothing.
const END = '(?=[\\s,]|$)';
const AMOUNT = new RegExp(`^(${SINGLE})${END}`);
// Two amounts joined like a range: "2-3", "2 to 3", "½ or 1", or with an en or em dash.
const RANGE = new RegExp(
	`^(${SINGLE})\\s*(?:-|–|—|to\\b|or\\b)\\s*(${SINGLE})${END}`,
	'i'
);

/** The unit the words start with, as many words as it takes, or null for none. */
function leadingUnit(words: string[]): { unit: string; length: number } | null {
	// "fl oz" and "fluid ounces" are two words.
	for (const length of [2, 1]) {
		if (words.length < length) continue;
		const text = words.slice(0, length).join(' ');
		const unit = normalizeUnit(text);
		if (unit !== null && (knownUnit(unit) || COMMON_UNITS.has(unit.toLowerCase()))) {
			return { unit: text, length };
		}
	}
	return null;
}

/**
 * An ingredient's parts. It starts with an amount, or a range whose first amount is the amount
 * and which goes in the prep note as "2 to 3" (design 2.3). A known unit or a common one (clove,
 * can, pinch, slice, stick and others) after an amount is the unit; any other word starts the
 * item. The item runs to the first comma, and the rest is the prep note.
 *
 * "1 1/2 cups flour, sifted" is 1 1/2, cups, flour and sifted. "3 eggs" has no unit, and
 * "Salt, to taste" has no amount or unit.
 */
export function splitIngredient(text: string): IngredientParts {
	let rest = normalizeName(text);
	let amount = '';
	let range = '';
	const single = AMOUNT.exec(rest);
	// "1-1/2" reads as both, and is one amount. "2 to 3" also starts with the amount 2.
	const ranged = RANGE.exec(rest);
	if (ranged && (!single || ranged[0].length > single[0].length)) {
		const [whole, first = '', last = ''] = ranged;
		amount = first;
		range = `${first} to ${last}`;
		rest = rest.slice(whole.length);
	} else if (single) {
		const [whole, first = ''] = single;
		amount = first;
		rest = rest.slice(whole.length);
	}
	rest = rest.trim();

	let unit = '';
	if (amount !== '') {
		const words = rest.split(' ');
		const found = leadingUnit(words);
		if (found) {
			unit = found.unit;
			rest = words.slice(found.length).join(' ');
		}
	}

	const comma = rest.indexOf(',');
	const item = (comma === -1 ? rest : rest.slice(0, comma)).trim();
	const note = comma === -1 ? '' : rest.slice(comma + 1).trim();
	const prepNote = [range, note].filter((part) => part !== '').join(', ');
	return { amount, unit, item, prepNote };
}
