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
