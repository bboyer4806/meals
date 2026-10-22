import { z } from 'zod';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { DISH_SORTS, listDishes, listDishTags } from '#lib/server/data/dishes.ts';
import { normalizeName } from '#lib/text.ts';

// A missing or unknown sort shows the list by name (section 7, "Recipes").
const sortSchema = z.enum(DISH_SORTS).catch('name');

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const archived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();
	const tag = normalizeName(url.searchParams.get('tag') ?? '') || null;
	const sort = sortSchema.parse(url.searchParams.get('sort'));
	return {
		archived,
		search,
		tag,
		sort,
		tags: listDishTags(user.householdId),
		recipes: listDishes(user.householdId, { search, tag, archived, sort })
	};
}
