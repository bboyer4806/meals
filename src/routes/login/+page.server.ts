import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { SIGN_IN_ERRORS, type SignInError } from '#lib/server/auth/sign-in.ts';

// What the page says when a sign-in sent someone back (6.1). A missing or unknown reason says
// nothing, so the page never shows text from the address.
const MESSAGES: Record<SignInError, string> = {
	cancelled: 'Sign-in was cancelled or expired. Please try again.',
	failed: 'Google sign-in failed. Please try again.',
	unverified: 'Google has not verified this email address.'
};

const errorSchema = z.enum(SIGN_IN_ERRORS).nullable().catch(null);

export function load({ locals, url }) {
	// Also after a sign-in that sent someone back, as Back to Google after signing in does (6.1).
	if (locals.user) redirect(303, '/');
	const error = errorSchema.parse(url.searchParams.get('error'));
	return { message: error === null ? null : MESSAGES[error] };
}
