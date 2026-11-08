import { isRedirect } from '@sveltejs/kit';
import { expect, it } from 'vitest';
import { load } from './+page.server.ts';

const MEMBER = { id: 1, householdId: 1, email: 'pat@example.com', name: 'Pat', isAdmin: false };

/** Opens the sign-in page at `path`, signed in as `user` or as nobody. */
function open(path: string, user: App.Locals['user'] = null) {
	const event = { locals: { user }, url: new URL(path, 'http://localhost') };
	try {
		return load(event as unknown as Parameters<typeof load>[0]);
	} catch (e) {
		return isRedirect(e) ? { redirectedTo: e.location } : e;
	}
}

it("says why a sign-in sent someone back, in the page's own words (MEA-94)", () => {
	expect(open('/login?error=cancelled')).toEqual({
		message: 'Sign-in was cancelled or expired. Please try again.'
	});
	expect(open('/login?error=failed')).toEqual({
		message: 'Google sign-in failed. Please try again.'
	});
	expect(open('/login?error=unverified')).toEqual({
		message: 'Google has not verified this email address.'
	});
});

it("says nothing for a reason it doesn't know, so it never shows text from the address (MEA-94)", () => {
	expect(open('/login')).toEqual({ message: null });
	expect(open('/login?error=Your+account+is+locked.+Call+555-0100.')).toEqual({ message: null });
	expect(open('/login?error=toString')).toEqual({ message: null });
});

it('sends someone already signed in to Meals, even after a sign-in that sent them back (MEA-94)', () => {
	expect(open('/login?error=cancelled', MEMBER)).toEqual({ redirectedTo: '/' });
});
