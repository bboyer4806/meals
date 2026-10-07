import { foldCase, normalizeName } from './text.ts';

// Searching the Copy a dinner picker (design 6.9). The groups arrive most made first; typing
// keeps those with a matching dish, most recently made first.

/**
 * With an empty search, the groups as given. Otherwise only groups with a dish whose name
 * contains the search ignoring case, most recently made first.
 */
export function filterCopyGroups<T extends { dishes: { name: string }[]; lastMade: string }>(
	groups: T[],
	search: string
): T[] {
	const query = foldCase(normalizeName(search));
	if (query === '') return groups;
	return (
		groups
			.filter((group) => group.dishes.some((dish) => foldCase(dish.name).includes(query)))
			// YYYY-MM-DD dates sort as text. Ties keep the order given.
			.sort((a, b) => b.lastMade.localeCompare(a.lastMade))
	);
}
