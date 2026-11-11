import { error, redirect } from '@sveltejs/kit';
import type { SessionUser } from './session.ts';

export type HouseholdUser = SessionUser & { householdId: number };

// Layout loads don't protect form actions, so every load and action calls one of these.

export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/login');
	return locals.user;
}

export function requireHousehold(locals: App.Locals): HouseholdUser {
	const user = requireUser(locals);
	if (user.householdId === null) redirect(303, '/setup');
	return { ...user, householdId: user.householdId };
}

export function requireAdmin(locals: App.Locals): HouseholdUser {
	const user = requireHousehold(locals);
	if (!user.isAdmin) error(404, 'Not found');
	return user;
}

/**
 * requireAdmin for a page the admin opens from an AI assistant (design 6.17): someone not signed
 * in signs in with Google and comes back to `url`, query and all.
 */
export function requireAdminAfterSignIn(locals: App.Locals, url: URL): HouseholdUser {
	if (!locals.user) {
		redirect(303, `/login/google?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	return requireAdmin(locals);
}
