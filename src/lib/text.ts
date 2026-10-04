/** Trims a name and collapses runs of spaces, so "  Paper   towels " becomes "Paper towels". */
export function normalizeName(name: string): string {
	return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Folds case for matching names, including non-ASCII letters: "Éclairs" matches "éclairs". */
export function foldCase(text: string): string {
	// Normalized again because lowercasing can undo NFC: a capital J with a caron has no
	// single-character form, but the lowercase one does.
	return text.normalize('NFC').toLowerCase().normalize('NFC');
}

/** Shows a quantity without trailing zeros: 2, 1.5, 0.33. */
export function formatQuantity(quantity: number): string {
	return String(Math.round(quantity * 100) / 100);
}
