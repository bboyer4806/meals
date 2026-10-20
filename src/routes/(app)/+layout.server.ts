import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import { isReleaseNew } from '#lib/server/data/whats-new.ts';
import { RELEASES } from '#lib/whats-new.ts';

export function load({ locals, depends }) {
	const user = requireHousehold(locals);
	const household = getHousehold(user.householdId);
	// What's new reloads this after recording that the person has seen it (design 7).
	depends('app:whats-new');
	return {
		user: { id: user.id, name: user.name, isAdmin: user.isAdmin },
		householdName: household.name,
		whatsNew: isReleaseNew(user.id, RELEASES[0].released, household.timeZone)
	};
}
