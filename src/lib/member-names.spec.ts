import { describe, expect, it } from 'vitest';
import { formatMemberName, type Member } from './member-names.ts';

/** Each member's name as the household sees it. */
function names(members: Member[]): string[] {
	return members.map((member) => formatMemberName(member.name, member.id, members));
}

describe('formatMemberName', () => {
	it("shows each member's first word, or the one word they have", () => {
		expect(
			names([
				{ id: 1, name: 'Alex Smith' },
				{ id: 2, name: 'Robin' }
			])
		).toEqual(['Alex', 'Robin']);
		expect(names([{ id: 1, name: '  Mary   Ann Lee ' }])).toEqual(['Mary']);
	});

	it('shows whole names when members share a first word, ignoring case', () => {
		const members = [
			{ id: 1, name: 'Alex Smith' },
			{ id: 2, name: 'alex Jones' },
			{ id: 3, name: 'Alexandra Lee' },
			{ id: 4, name: 'Sam Park' },
			{ id: 5, name: 'Sam Park' }
		];
		expect(names(members)).toEqual([
			'Alex Smith',
			'alex Jones',
			'Alexandra',
			'Sam Park',
			'Sam Park'
		]);
	});

	// Escapes, so an editor can't quietly turn the accents into single characters.
	it('matches accented first words whichever way they were typed', () => {
		const members = [
			{ id: 1, name: 'Émile Roy' },
			{ id: 2, name: 'émile Dubois' }
		];
		expect(names(members)).toEqual(['Émile Roy', 'émile Dubois']);
	});

	it('goes back to first words when the other member is gone', () => {
		const alex = { id: 1, name: 'Alex Smith' };
		expect(names([alex, { id: 2, name: 'Alex Jones' }])).toEqual(['Alex Smith', 'Alex Jones']);
		expect(names([alex])).toEqual(['Alex']);
	});

	it("shows a removed member's whole name only when a current member has the same first word", () => {
		const members = [{ id: 1, name: 'alex Jones' }];
		expect(formatMemberName('Alex Smith', null, members)).toBe('Alex Smith');
		expect(formatMemberName('Sam Lee', null, members)).toBe('Sam');
	});

	it('names a member by the name given, as a request completed before a new name keeps', () => {
		const members = [
			{ id: 1, name: 'Samantha Lee' },
			{ id: 2, name: 'Sam Park' }
		];
		expect(formatMemberName('Sam Lee', 1, members)).toBe('Sam Lee');
		expect(formatMemberName('Samantha Lee', 1, members)).toBe('Samantha');
	});
});
