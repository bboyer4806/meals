import { requireHousehold } from '#lib/server/auth/guards.ts';
import { listDishes, listDishTags } from '#lib/server/data/dishes.ts';
import { normalizeName } from '#lib/text.ts';

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const archived = url.searchParams.get('archived') === '1';
	const search = (url.searchParams.get('q') ?? '').trim();
	const tag = normalizeName(url.searchParams.get('tag') ?? '') || null;
	return {
		archived,
		search,
		tag,
		tags: listDishTags(user.householdId),
		recipes: listDishes(user.householdId, { search, tag, archived })
	};
}
