import { isRedirect } from '@sveltejs/kit';
import { expect, it } from 'vitest';
import { load } from './+page.server.ts';

// What the sign-in page says when a sign-in that failed sends someone back to it (design 6.1,
// MEA-94).

/** Loads /login with the query, signed out or as someone signed in, and what it threw. */
function open(query: string, signedIn = false) {
	const url = new URL(`http://localhost/login${query}`);
	const user = signedIn ? { id: 1, householdId: 1, email: 'a@example.com', name: 'A' } : null;
	try {
		return load({ locals: { user }, url } as unknown as Parameters<typeof load>[0]);
	} catch (e) {
		return e;
	}
}

it('says why a sign-in failed', () => {
	expect(open('?error=cancelled')).toEqual({
		message: 'Sign-in was cancelled or expired. Please try again.'
	});
	expect(open('?error=failed')).toEqual({ message: 'Google sign-in failed. Please try again.' });
	expect(open('?error=unverified')).toEqual({
		message: 'Google has not verified this email address.'
	});
});

it('says nothing otherwise, so nobody can make it say something else', () => {
	const queries = ['', '?error=', '?error=Your%20account%20is%20locked', '?error=constructor'];
	for (const query of queries) {
		expect(open(query), query).toEqual({ message: null });
	}
});

it('sends someone already signed in on to the app, whatever went wrong', () => {
	const thrown = open('?error=cancelled', true);
	expect(isRedirect(thrown) && thrown.location).toBe('/');
});
