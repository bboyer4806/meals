// Reading amounts as people type them, and showing them as kitchen fractions (design 6.5 and
// 6.6).

/** An amount as shown, and the number it shows, which decides between "cup" and "cups". */
export type ShownAmount = { text: string; value: number };

// The fraction characters people paste from recipe sites.
const GLYPHS: Record<string, string> = {
	'¼': '1/4',
	'½': '1/2',
	'¾': '3/4',
	'⅓': '1/3',
	'⅔': '2/3',
	'⅛': '1/8',
	'⅜': '3/8',
	'⅝': '5/8',
	'⅞': '7/8'
};
const GLYPH = new RegExp(`[${Object.keys(GLYPHS).join('')}]`, 'g');

const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
// "1/2", or a whole number and a fraction: "1 1/2" or "1-1/2".
const FRACTION = /^(?:(\d+)(?:\s+|\s*-\s*))?(\d+)\s*\/\s*(\d+)$/;

/**
 * "2", "1.5", ".5", "1 1/2", "1/2", "½", "1½" or "1 ½" as a number. Null unless it's a finite
 * number above 0.
 */
export function parseAmount(text: string): number | null {
	// "1½" reads as "1 1/2". Pasted text can also use the fraction slash, U+2044.
	const plain = text
		.replace(GLYPH, (glyph) => ` ${GLYPHS[glyph]}`)
		.replace(/\u2044/g, '/')
		.trim();
	const fraction = FRACTION.exec(plain);
	let value = NaN;
	if (DECIMAL.test(plain)) value = Number(plain);
	else if (fraction) value = Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
	return Number.isFinite(value) && value > 0 ? value : null;
}

// How close a number must be to a fraction to be shown as one: 1/3 is stored as 0.333...
const TOLERANCE = 1e-6;

function mixed(whole: number, num: number, den: number): ShownAmount {
	const value = whole + num / den;
	if (num === 0) return { text: String(whole), value };
	if (whole === 0) return { text: `${num}/${den}`, value };
	return { text: `${whole} ${num}/${den}`, value };
}

/** formatExact, with the number it shows. */
export function exactAmount(value: number): ShownAmount {
	// The smallest amount shown, so an amount above zero never reads as 0.
	if (value > 0 && value < 0.001) return { text: '0.001', value: 0.001 };
	const nearest = Math.round(value);
	if (Math.abs(value - nearest) <= TOLERANCE) return mixed(nearest, 0, 1);
	const whole = Math.floor(value);
	// Smallest denominator first, so 1/2 isn't shown as 2/4.
	for (const den of [2, 3, 4, 8, 16]) {
		const num = Math.round((value - whole) * den);
		if (Math.abs(value - whole - num / den) <= TOLERANCE) return mixed(whole, num, den);
	}
	const rounded = Number(value.toFixed(3));
	return { text: String(rounded), value: rounded };
}

/**
 * An amount as entered, for a recipe at its own servings: a whole number and a fraction in
 * halves, thirds, quarters, eighths or sixteenths when it's exactly that ("1 1/2", "1/3", "2"),
 * otherwise a decimal with up to 3 places ("0.3").
 */
export function formatExact(value: number): string {
	return exactAmount(value).text;
}

// The kitchen fractions (6.6), and 1 for rounding up into the next whole number.
const KITCHEN_FRACTIONS = [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];

/** formatKitchen, with the number it shows. */
export function kitchenAmount(value: number): ShownAmount {
	if (!(value > 0)) return mixed(0, 0, 1);
	const whole = Math.floor(value);
	const rest = value - whole;
	// The nearest fraction. A tie goes to the larger one, as in ordinary rounding, so 1 7/8
	// shows as 2. The allowance keeps floating point noise from deciding a tie.
	let nearest = 0;
	for (const fraction of KITCHEN_FRACTIONS) {
		if (Math.abs(rest - fraction) <= Math.abs(rest - nearest) + 1e-9) nearest = fraction;
	}
	// Anything above zero shows as at least 1/8.
	return exactAmount(Math.max(whole + nearest, 1 / 8));
}

/**
 * A scaled amount, rounded to the nearest whole number plus 1/8, 1/4, 1/3, 1/2, 2/3 or 3/4:
 * "1 1/8", "3/4", "2". Anything above zero shows as at least 1/8.
 */
export function formatKitchen(value: number): string {
	return kitchenAmount(value).text;
}
