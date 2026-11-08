/**
 * The longest text normalizeName and foldCase take. Unicode normalization (NFC) takes time that
 * grows with the square of a run of combining marks: 10,000 of them take a few hundredths of a
 * second, and millions would hold up the server for every household for half an hour (MEA-64).
 * Text people send is checked before it's normalized: a name against its own limit (sentMax in
 * server/forms.ts), and longer text, such as an imported cell, against this one.
 */
export const NORMALIZE_MAX_LENGTH = 10_000;

/**
 * The most text one import normalizes in all: a file of recipes, or a page's recipe (design 4.5).
 * Each piece is checked against NORMALIZE_MAX_LENGTH, but the pieces add up: a 5 MB page of them
 * took about 20 seconds (MEA-234). This many take under a second however they're written, and
 * the longest recipe the editor takes holds about 30,000.
 */
export const IMPORT_MAX_LENGTH = 100_000;

/** Throws for text longer than NORMALIZE_MAX_LENGTH, which a check before this one missed. */
function requireNormalizable(text: string): void {
	if (text.length > NORMALIZE_MAX_LENGTH) {
		throw new Error(`Text of ${text.length} characters is too long to normalize`);
	}
}

/** Trims a name and collapses runs of spaces, so "  Paper   towels " becomes "Paper towels". */
export function normalizeName(name: string): string {
	requireNormalizable(name);
	return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Folds case for matching names, including non-ASCII letters: "Éclairs" matches "éclairs". */
export function foldCase(text: string): string {
	requireNormalizable(text);
	// Normalized again because lowercasing can undo NFC: a capital J with a caron has no
	// single-character form, but the lowercase one does.
	return text.normalize('NFC').toLowerCase().normalize('NFC');
}

/** Shows a quantity without trailing zeros: 2, 1.5, 0.33. */
export function formatQuantity(quantity: number): string {
	// The smallest amount shown, so an amount above zero never reads as 0 (6.5, MEA-92).
	if (quantity > 0 && quantity < 0.01) return '0.01';
	return String(Math.round(quantity * 100) / 100);
}

/** A list in words: "Salt", "Salt and Pepper", or "Salt, Pepper and Cumin". */
export function joinAnd(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
