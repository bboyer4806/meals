import { foldCase } from './text.ts';

/** One of the household's current members: who they are, and their name as it's kept. */
export type Member = { id: number; name: string };

/** A name's first word: "Alex" for "Alex Smith". */
function firstWord(name: string): string {
	return name.trim().split(/\s/, 1)[0] ?? '';
}

/**
 * A person's name as the household sees it (design 6.1): the first word of their name as it's
 * kept, or the whole name when another of the household's current members has the same first
 * word, ignoring case. `memberId` is whose name it is, or null for someone removed from the
 * household, whose whole name shows when any current member has the same first word.
 */
export function formatMemberName(name: string, memberId: number | null, members: Member[]): string {
	const first = firstWord(name);
	const folded = foldCase(first);
	const shared = members.some(
		(member) => member.id !== memberId && foldCase(firstWord(member.name)) === folded
	);
	return shared ? name : first;
}
