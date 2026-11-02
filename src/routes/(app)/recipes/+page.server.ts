import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { DISH_SORTS, listDishes, listDishTags } from '#lib/server/data/dishes.ts';
import { foldCase, normalizeName } from '#lib/text.ts';

// A missing or unknown sort shows the list by name (section 7, "Recipes").
const sortSchema = z.enum(DISH_SORTS).catch('name');

/**
 * The tags the list is filtered by, one `tag` each in the address (section 7, "Recipes"). Each
 * is kept once ignoring case, in the address's order and first spelling, and blank ones are left
 * out.
 */
function tagsIn(url: URL): string[] {
	const tags = new Map<string, string>();
	for (const value of url.searchParams.getAll('tag')) {
		const tag = normalizeName(value);
		const key = foldCase(tag);
		if (tag !== '' && !tags.has(key)) tags.set(key, tag);
	}
	return [...tags.values()];
}

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const archived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();
	const selectedTags = tagsIn(url);
	const sort = sortSchema.parse(url.searchParams.get('sort'));
	return {
		archived,
		search,
		selectedTags,
		sort,
		tags: listDishTags(user.householdId),
		recipes: listDishes(user.householdId, { search, tags: selectedTags, archived, sort })
	};
}
