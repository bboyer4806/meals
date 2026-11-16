import { describe, expect, it } from 'vitest';
import { DEFAULT_DISH_REVISIONS } from './default-dishes.ts';
import { nameField } from './server/forms.ts';
import { foldCase } from './text.ts';

describe('DEFAULT_DISH_REVISIONS', () => {
	const names = DEFAULT_DISH_REVISIONS.flat();

	it('starts with the 80 approved dishes (design 6.18)', () => {
		expect(DEFAULT_DISH_REVISIONS[0]).toHaveLength(80);
	});

	it('lists each dish once across the revisions, ignoring case', () => {
		expect(new Set(names.map(foldCase)).size).toBe(names.length);
	});

	it('writes each name as the recipe editor would save it', () => {
		// The recipe editor takes names of up to 80 characters (recipe-form.ts).
		const dishName = nameField(80, 'a recipe name');
		for (const name of names) expect(dishName.parse(name)).toBe(name);
	});
});
