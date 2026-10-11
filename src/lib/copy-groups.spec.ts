import { describe, expect, it } from 'vitest';
import { filterCopyGroups } from './copy-groups.ts';

function group(lastMade: string, ...names: string[]) {
	return { dinnerId: 0, dishes: names.map((name) => ({ name })), timesMade: 1, lastMade };
}

// Most made first, as listCopyGroups gives them.
const tacos = group('2026-09-01', 'Tacos', 'Rice');
const roast = group('2026-10-04', 'Roast chicken', 'Rice', 'Éclairs');
const soup = group('2026-09-20', 'Tomato soup', 'Grilled cheese');
const groups = [tacos, roast, soup];

function lastMade(search: string): string[] {
	return filterCopyGroups(groups, search).map((found) => found.lastMade);
}

describe('filterCopyGroups', () => {
	it('gives the groups as they came when nothing is typed', () => {
		expect(filterCopyGroups(groups, '')).toBe(groups);
		expect(filterCopyGroups(groups, '   ')).toBe(groups);
	});

	it('keeps groups with a dish whose name contains the search, most recent first (6.9)', () => {
		expect(filterCopyGroups(groups, 'rice')).toEqual([roast, tacos]);
		expect(lastMade('Soup')).toEqual(['2026-09-20']);
		expect(lastMade('chicken')).toEqual(['2026-10-04']);
		expect(lastMade('pizza')).toEqual([]);
	});

	it('ignores case (accented letters too) and extra spaces', () => {
		expect(lastMade('RICE')).toEqual(['2026-10-04', '2026-09-01']);
		expect(lastMade('éCLAIRS')).toEqual(['2026-10-04']);
		expect(lastMade('  grilled   cheese ')).toEqual(['2026-09-20']);
		// Matches within one dish name, not across two.
		expect(lastMade('soup grilled')).toEqual([]);
	});

	it('keeps the given order for groups last made the same day', () => {
		const first = group('2026-10-01', 'Rice', 'Beans');
		const second = group('2026-10-01', 'Rice', 'Tofu');
		expect(filterCopyGroups([first, second], 'rice')).toEqual([first, second]);
		expect(filterCopyGroups([second, first], 'rice')).toEqual([second, first]);
	});

	it("doesn't change the list it was given", () => {
		const given = [...groups];
		filterCopyGroups(given, 'rice');
		expect(given).toEqual(groups);
	});

	it('keeps any other fields on the groups', () => {
		const found = filterCopyGroups([{ ...tacos, dinnerId: 12 }], 'taco');
		expect(found).toEqual([{ ...tacos, dinnerId: 12 }]);
		expect(found[0]?.dinnerId).toBe(12);
	});
});
