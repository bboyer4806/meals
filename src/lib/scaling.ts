import { exactAmount, kitchenAmount, type ShownAmount } from './amounts.ts';
import { bestUnit, knownUnit, toBase, unitLabel, type UnitKind } from './units.ts';

// Showing a recipe's amounts at other servings (design 6.6).

/** How much to scale a recipe by. Exactly 1 at its own servings (x / x is exactly 1). */
export function scaleFactor(targetServings: number, recipeServings: number): number {
	return targetServings / recipeServings;
}

/**
 * One ingredient's amount as shown, or null when it has no amount (never scaled, Q33). At the
 * recipe's own servings it's exactly as entered. Otherwise volumes and weights are converted to
 * the unit whose range contains them, and every amount is rounded to kitchen fractions. Custom
 * units and counts keep their unit.
 */
export function showAmount(
	amount: number | null,
	unit: string | null,
	factor: number
): string | null {
	if (amount === null) return null;
	if (factor === 1) return withUnit(exactAmount(amount), unit);
	const known = unit === null ? undefined : knownUnit(unit);
	if (known) return showInBestUnit(known.kind, toBase(amount * factor, known));
	return withUnit(kitchenAmount(amount * factor), unit);
}

/**
 * A volume in tsp or a weight in oz, in the unit whose range contains it (6.6) and rounded to
 * kitchen fractions: "1 1/8 cups". Checklist totals always use this.
 */
export function showInBestUnit(kind: UnitKind, base: number): string {
	let unit = bestUnit(kind, base);
	let shown = kitchenAmount(base / unit.size);
	// Rounding can reach the next unit's range: 2.95 tsp rounds to 3 tsp, which is 1 tbsp.
	const roundedUnit = bestUnit(kind, shown.value * unit.size);
	if (roundedUnit !== unit) {
		unit = roundedUnit;
		shown = kitchenAmount(base / unit.size);
	}
	return withUnit(shown, unit.code);
}

// The label follows the number shown, so 1.02 cups shows as "1 cup".
function withUnit(shown: ShownAmount, unit: string | null): string {
	return unit === null ? shown.text : `${shown.text} ${unitLabel(unit, shown.value)}`;
}
