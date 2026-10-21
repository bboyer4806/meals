// One-time import of a list of dishes into one household, each with one tag. The production
// image has no src/, so run it from a checkout of the repository, from its root:
//   DATA_DIR=... node scripts/import-dishes.ts <list.md> <household name> <tag>
// The list has one dish per "- " line. Each becomes a dish with no recipe (Q2), named as written.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDish, listDishes } from '../src/lib/server/data/dishes.ts';
import { getHousehold, listHouseholds } from '../src/lib/server/data/households.ts';
import { openDb } from '../src/lib/server/db/index.ts';
import { foldCase, normalizeName } from '../src/lib/text.ts';

/** The dish names on the list's "- " lines. */
export function parseDishList(text: string): string[] {
	return text
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.map((line) => normalizeName(line.slice(2)));
}

/** The id of the one household with exactly this name. */
export function findHouseholdId(name: string): number {
	const matches = listHouseholds().filter((household) => household.name === name);
	if (matches.length !== 1) {
		throw new Error(`Expected one household named "${name}", found ${matches.length}`);
	}
	return matches[0]!.id;
}

/**
 * Adds every dish, or none if any name is already a dish in the household (active or archived),
 * repeats on the list, or doesn't fit.
 */
export function importDishes(householdId: number, names: string[], tag: string, now: number): void {
	const existing = new Set(
		[true, false]
			.flatMap((archived) => listDishes(householdId, { search: '', tag: null, archived }))
			.map((dish) => foldCase(dish.name))
	);
	if (tag.length > 30) throw new Error(`"${tag}" is over 30 characters`);
	const seen = new Set<string>();
	for (const name of names) {
		const key = foldCase(name);
		if (existing.has(key)) throw new Error(`"${name}" is already a dish in this household`);
		if (seen.has(key)) throw new Error(`"${name}" is on the list twice`);
		if (name.length > 80) throw new Error(`"${name}" is over 80 characters`);
		seen.add(key);
	}

	const { defaultServings } = getHousehold(householdId);
	for (const name of names) {
		const result = createDish(
			householdId,
			{
				name,
				servings: defaultServings,
				prepMinutes: null,
				cookMinutes: null,
				steps: null,
				notes: null,
				source: null,
				calories: null,
				proteinG: null,
				carbsG: null,
				fatG: null,
				tags: [tag],
				ingredients: []
			},
			[],
			now
		);
		if (result.kind !== 'saved') throw new Error(`"${name}" was not saved: ${result.kind}`);
	}
}

if (import.meta.main) {
	const [listPath, householdName, tag] = process.argv.slice(2);
	if (!listPath || !householdName || !tag) {
		throw new Error('Usage: node scripts/import-dishes.ts <list.md> <household name> <tag>');
	}
	const dataDir = process.env.DATA_DIR;
	if (!dataDir) throw new Error('DATA_DIR is not set');
	const database = join(dataDir, 'meals.db');
	if (!existsSync(database)) throw new Error(`${database} does not exist`);
	openDb(database);
	const names = parseDishList(readFileSync(listPath, 'utf8'));
	importDishes(findHouseholdId(householdName), names, tag, Date.now());
	console.log(`Added ${names.length} dishes tagged "${tag}" to ${householdName}`);
}
