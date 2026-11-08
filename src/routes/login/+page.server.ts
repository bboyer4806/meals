import { redirect } from '@sveltejs/kit';

// What the page says when a sign-in that failed sends someone back here (6.1). Any other
// `error` says nothing, so nobody can make the page say something else.
const MESSAGES = new Map([
	['cancelled', 'Sign-in was cancelled or expired. Please try again.'],
	['failed', 'Google sign-in failed. Please try again.'],
	['unverified', 'Google has not verified this email address.']
]);

export function load({ locals, url }) {
	if (locals.user) redirect(303, '/');
	return { message: MESSAGES.get(url.searchParams.get('error') ?? '') ?? null };
}
