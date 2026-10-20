import { requireHousehold } from '#lib/server/auth/guards.ts';
import { recordReleaseSeen } from '#lib/server/data/whats-new.ts';
import { RELEASES } from '#lib/whats-new.ts';

// Opening the page clears the dot on every device (design 7). Its link in More doesn't preload,
// so hovering it doesn't count as opening it.
export function load({ locals }) {
	const user = requireHousehold(locals);
	recordReleaseSeen(user.id, RELEASES[0].released);
	return { releases: RELEASES };
}
