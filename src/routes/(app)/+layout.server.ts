import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';

export function load({ locals }) {
	const user = requireHousehold(locals);
	return {
		user: { id: user.id, name: user.name, isAdmin: user.isAdmin },
		householdName: getHousehold(user.householdId).name
	};
}
