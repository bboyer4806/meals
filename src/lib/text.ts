/** Trims a name and collapses runs of spaces, so "  Paper   towels " becomes "Paper towels". */
export function normalizeName(name: string): string {
	return name.trim().replace(/\s+/g, ' ');
}

/** Shows a quantity without trailing zeros: 2, 1.5, 0.33. */
export function formatQuantity(quantity: number): string {
	return String(Math.round(quantity * 100) / 100);
}
