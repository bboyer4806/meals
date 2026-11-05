import { describe, expect, it } from 'vitest';
import { foldCase } from '../text.ts';
import { nameField } from './forms.ts';
import { STANDARD_ITEMS } from './standard-items.ts';

describe('STANDARD_ITEMS', () => {
	it('has the 288 approved items, each once, ignoring case (design 6.13)', () => {
		expect(STANDARD_ITEMS).toHaveLength(288);
		expect(new Set(STANDARD_ITEMS.map(foldCase)).size).toBe(288);
	});

	it('writes each name as Items would save it', () => {
		// Items takes names of up to 80 characters (item-form.ts).
		const itemName = nameField(80, 'a name');
		for (const name of STANDARD_ITEMS) expect(itemName.parse(name)).toBe(name);
	});
});
