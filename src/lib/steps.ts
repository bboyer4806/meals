// Steps are typed one per line (design 7). When a recipe is scaled, a step that mentions an
// amount gets a warning, since numbers in steps don't scale (6.7).

// A step number or bullet that people type or paste ("1.", "2)", "Step 3:", "-"). Steps are
// shown numbered, so it would show twice.
const LIST_MARKER = /^(?:step\s*\d+\s*[.):-]?|\d+\s*[.):]|[-*•])(?:\s+|$)/i;

/** One step per line: trimmed, without blank lines or a typed step number. */
export function splitSteps(text: string | null): string[] {
	if (text === null) return [];
	return text
		.split(/\r\n?|\n/)
		.map((line) => line.trim().replace(LIST_MARKER, '').trim())
		.filter((line) => line !== '');
}

const GLYPHS = '¼½¾⅓⅔⅛⅜⅝⅞';
// A number as written in a step: 1/2, 350, 1.5, 1 1/2, 1-1/2, 1½, 1 ½, .5 or ½.
const NUMBER = [
	String.raw`\d+\s*/\s*\d+`,
	String.raw`\d+(?:\.\d+)?(?:(?:\s+|-)\d+/\d+|\s*[${GLYPHS}])?`,
	String.raw`\.\d+`,
	`[${GLYPHS}]`
].join('|');
// What joins a range: "25 to 30", "25-30", "2–3" (an en dash), "between 25 and 30".
const RANGE_JOIN = String.raw`\s*[-\u2013\u2014]\s*|\s+(?:to|or|and)\s+`;
// It starts where a number starts, which also keeps a long run of digits from taking
// quadratic time.
const RANGE = `(?:\\b|(?=[${GLYPHS}]))(?:${NUMBER})(?:(?:${RANGE_JOIN})(?:${NUMBER}))?`;
// What makes a number a time or a temperature: the degree sign (or the look-alikes º and ˚
// that people type for it), or one of these words. F is for "350F". C for Celsius is left
// out, because it also means cups. A number joined to "day" by a hyphen is an age or a
// length ("a 3-day-old loaf", "a 2-day rise"), but "2 day-old baguettes" counts baguettes.
const TIME_WORDS = 'degrees?|minutes?|mins?|hours?|hrs?|seconds?|secs?|days?(?!-)|F';
// Times and temperatures don't scale and aren't amounts (change 2.1.3): "350°F",
// "350 degrees", "25 to 30 minutes", "a 10-minute rest", "5 more minutes".
const TIME_OR_TEMPERATURE = new RegExp(
	String.raw`${RANGE}(?:-days?\b|[\s-]*(?:more\s+)?(?:[°º˚]|(?:${TIME_WORDS})\b))`,
	'gi'
);
const DIGIT = new RegExp(`[\\d${GLYPHS}]`);

/** Whether a step has a number that scaling won't change, other than times and temperatures. */
export function stepHasUnscaledAmount(step: string): boolean {
	return DIGIT.test(step.trim().replace(LIST_MARKER, '').replace(TIME_OR_TEMPERATURE, ' '));
}
