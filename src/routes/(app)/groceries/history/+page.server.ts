import { requireHousehold } from '#lib/server/auth/guards.ts';
import { dateIn } from '#lib/dates.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { listHistory, type GroceryLine } from '#lib/server/data/needs.ts';

const PAGE = 100;

export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const { timeZone } = getHousehold(user.householdId);
	const search = (url.searchParams.get('q') ?? '').trim();
	const requested = Number(url.searchParams.get('show'));
	const shown = Number.isSafeInteger(requested) && requested > PAGE ? requested : PAGE;

	// One more than shown tells us whether there are older lines.
	const lines = listHistory(user.householdId, search, shown + 1);
	const days: { date: string; lines: GroceryLine[] }[] = [];
	for (const line of lines.slice(0, shown)) {
		if (line.receivedAt === null) continue;
		const date = dateIn(line.receivedAt, timeZone);
		const day = days.at(-1);
		if (day?.date === date) day.lines.push(line);
		else days.push({ date, lines: [line] });
	}
	return { search, days, more: lines.length > shown ? shown + PAGE : null };
}
