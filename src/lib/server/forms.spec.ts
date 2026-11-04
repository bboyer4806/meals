import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { NORMALIZE_MAX_LENGTH } from '../text.ts';
import { nameField, sentName } from './forms.ts';

/** The first problem with the value, or undefined when there's none. */
function problem(schema: z.ZodType, value: unknown): string | undefined {
	return schema.safeParse(value).error?.issues[0]?.message;
}

/** "Paper towels" with spaces between the words, `length` characters in all. */
function spaced(length: number): string {
	return `Paper${' '.repeat(length - 'Papertowels'.length)}towels`;
}

describe('nameField', () => {
	const name = nameField(80, 'a name');

	it('takes a name of up to its limit, normalized', () => {
		expect(name.parse('  Paper   towels ')).toBe('Paper towels');
		expect(problem(name, ' ')).toBe('Enter a name');
		expect(name.parse('a'.repeat(80))).toBe('a'.repeat(80));
		expect(problem(name, 'a'.repeat(81))).toBe('Keep a name under 80 characters');
	});

	it('refuses a name over 4 times its limit before normalizing it (MEA-64)', () => {
		// Normalizing shortens these to the limit or under: accents sent apart from their
		// letters, and runs of spaces.
		expect(name.parse('é'.repeat(80))).toBe('é'.repeat(80));
		expect(name.parse(spaced(320))).toBe('Paper towels');
		expect(problem(name, spaced(321))).toBe('Keep a name under 80 characters');
		// normalizeName would throw for this (text.ts).
		expect(problem(name, 'a'.repeat(NORMALIZE_MAX_LENGTH + 1))).toBe(
			'Keep a name under 80 characters'
		);
	});
});

describe('sentName', () => {
	it('takes text as sent, up to 4 times the limit, for checking after', () => {
		const label = sentName(30, 'a label');
		expect(label.parse(' Kids ')).toBe(' Kids ');
		expect(label.parse('x'.repeat(120))).toBe('x'.repeat(120));
		expect(problem(label, 'x'.repeat(121))).toBe('Keep a label under 30 characters');
	});

	it('says what a missing field needs', () => {
		const label = sentName(30, 'a label', { error: 'Enter a label for each dinner' });
		expect(problem(label, undefined)).toBe('Enter a label for each dinner');
	});
});
