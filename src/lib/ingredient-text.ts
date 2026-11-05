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

// One amount as parseAmount reads it: "1 1/2", "1-1/2", "1/2", "1½", "½", "1.5" or ".5". Also
// a whole number and a fraction joined by "and", as in "1 and 1/2" or "1 and ½" (MEA-242).
const FRACTIONS = '¼½¾⅓⅔⅛⅜⅝⅞';
const SINGLE =
	`(?:\\d+(?:\\s+and\\s+|\\s*)[${FRACTIONS}]|[${FRACTIONS}]|` +
	`\\d+(?:\\s+and\\s+|\\s+|\\s*-\\s*)\\d+\\s*[/⁄]\\s*\\d+|` +
	`\\d+\\s*[/⁄]\\s*\\d+|\\d+(?:\\.\\d*)?|\\.\\d+)`;
// The "and" in "1 and 1/2", which parseAmount doesn't read (MEA-242).
const AND = /\s+and\s+/i;
// The amount, then the rest after a space or a comma, or nothing.
const END = '(?=[\\s,]|$)';
const AMOUNT = new RegExp(`^(${SINGLE})${END}`, 'i');
// What joins two amounts in a range: "2-3", "2 to 3", "½ or 1", or an en or em dash.
const JOIN = '\\s*(?:-|–|—|to\\b|or\\b)\\s*';
const RANGE = new RegExp(`^(${SINGLE})${JOIN}(${SINGLE})${END}`, 'i');
// An amount or a range with letters written onto it, as in "500g" or "1/2cup" (MEA-74).
const ATTACHED = new RegExp(`^${SINGLE}(?:${JOIN}${SINGLE})?(?=[a-z])`, 'i');
// Text in parentheses, such as the size in "1 (14 oz) can", and the space after it (MEA-74).
const PARENTHESES = /^\(([^()]*)\)\s*/;
// The "of" in "2 cloves of garlic", and the space after it (MEA-74).
const OF = /^of(?:\s|$)/i;

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
 * The text with a space after an amount that has its unit written onto it, so "500g flour" reads
 * as "500 g flour". Letters that aren't a unit stay on, so "7UP" doesn't start with an amount.
 */
function spaceOutUnit(text: string): string {
	const amount = ATTACHED.exec(text)?.[0];
	if (amount === undefined) return text;
	const rest = text.slice(amount.length);
	return leadingUnit(rest.split(' ')) ? `${amount} ${rest}` : text;
}

/** The amount as the editor reads it (design 6.5), so "1 and 1/2" is "1 1/2" (MEA-242). */
function withoutAnd(amount: string): string {
	return amount.replace(AND, ' ');
}

/** The text inside the parentheses the text starts with, or '', and the text after them. */
function leadingParentheses(text: string): [inside: string, rest: string] {
	const found = PARENTHESES.exec(text);
	if (!found) return ['', text];
	const [whole, inside = ''] = found;
	return [inside.trim(), text.slice(whole.length)];
}

/**
 * An ingredient's parts (design 7, Import recipes). It starts with an amount, or a range whose
 * first amount is the amount and which goes in the prep note as "2 to 3" (design 2.3). An "and"
 * between a whole number and a fraction is left out of an amount. A known unit or a common one
 * (clove, can, pinch, slice, stick and others) after an amount is the unit, also when it's
 * written onto the amount, as in "500g"; any other word starts the item. Text in parentheses
 * right after the amount or the unit, such as a size, goes in the prep note, and an "of" after
 * the unit is left out. The item runs to the first comma, and the rest is the prep note.
 *
 * "1 1/2 cups flour, sifted" is 1 1/2, cups, flour and sifted. "1 and 1/3 cup flour" is 1 1/3,
 * cup and flour. "1 (14 oz) can of tomatoes" is 1, can, tomatoes and 14 oz. "3 eggs" has no
 * unit, and "Salt, to taste" has no amount or unit.
 */
export function splitIngredient(text: string): IngredientParts {
	let rest = spaceOutUnit(normalizeName(text));
	let amount = '';
	let range = '';
	const single = AMOUNT.exec(rest);
	// "1-1/2" reads as both, and is one amount. "2 to 3" also starts with the amount 2.
	const ranged = RANGE.exec(rest);
	if (ranged && (!single || ranged[0].length > single[0].length)) {
		const [whole, first = '', last = ''] = ranged;
		amount = withoutAnd(first);
		range = `${amount} to ${withoutAnd(last)}`;
		rest = rest.slice(whole.length);
	} else if (single) {
		const [whole, first = ''] = single;
		amount = withoutAnd(first);
		rest = rest.slice(whole.length);
	}
	rest = rest.trim();

	let unit = '';
	// What's in parentheses after the amount, as in "1 (14 oz) can", and after the unit, as in
	// "1 cup (240 ml) milk".
	let afterAmount = '';
	let afterUnit = '';
	if (amount !== '') {
		[afterAmount, rest] = leadingParentheses(rest);
		const words = rest.split(' ');
		const found = leadingUnit(words);
		if (found) {
			unit = found.unit;
			[afterUnit, rest] = leadingParentheses(words.slice(found.length).join(' '));
			rest = rest.replace(OF, '');
		}
	}

	const comma = rest.indexOf(',');
	const item = (comma === -1 ? rest : rest.slice(0, comma)).trim();
	const note = comma === -1 ? '' : rest.slice(comma + 1).trim();
	const prepNote = [range, afterAmount, afterUnit, note].filter((part) => part !== '').join(', ');
	return { amount, unit, item, prepNote };
}
