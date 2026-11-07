import { z } from 'zod';
import { dateIn } from '#lib/dates.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import {
	DISH_SORTS,
	groupDishesByLastMade,
	listDishes,
	listDishTags
} from '#lib/server/data/dishes.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { foldCase, normalizeName } from '#lib/text.ts';

// A missing or unknown sort shows the list by name (section 7, "Recipes").
const sortSchema = z.enum(DISH_SORTS).catch('name');

// A missing or unknown view shows the list; Grouped groups recipes by when they were last on the
// Menu (section 7, "Recipes"; MEA-246).
const viewSchema = z.enum(['list', 'grouped']).catch('list');

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
	const shown = { archived, search, selectedTags, sort, tags: listDishTags(user.householdId) };
	// Archived recipes are only listed.
	if (archived || viewSchema.parse(url.searchParams.get('view')) === 'list') {
		const recipes = listDishes(user.householdId, { search, tags: selectedTags, archived, sort });
		return { ...shown, view: 'list' as const, recipes };
	}
	// The household's date, as the Menu's (2.3).
	const today = dateIn(Date.now(), getHousehold(user.householdId).timeZone);
	const groups = groupDishesByLastMade(user.householdId, { search, tags: selectedTags }, today);
	return { ...shown, view: 'grouped' as const, today, groups };
}
