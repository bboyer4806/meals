import { expect, test } from './fixtures.ts';

// A sign-in that didn't finish goes back to the sign-in page, which says why (design 6.1).

test('a cancelled sign-in goes back to the sign-in page to say so (MEA-94)', async ({ page }) => {
	// Cancel on Google's consent screen sends no code.
	await page.goto('/login/google/callback?error=access_denied&state=state');
	await expect(page).toHaveURL(/\/login\?error=cancelled$/);
	const message = page.getByRole('alert');
	await expect(message).toHaveText('Sign-in was cancelled or expired. Please try again.');

	// Above Sign in with Google, to try again.
	const signIn = page.getByRole('link', { name: 'Sign in with Google' });
	const [messageBox, signInBox] = await Promise.all([message.boundingBox(), signIn.boundingBox()]);
	expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(signInBox!.y);
});

test('Back to Google after signing in, and choosing the account again, goes on to Meals (MEA-94)', async ({
	page,
	person: _
}) => {
	// The first sign-in used up the state cookie, so Google's second answer comes without one.
	await page.goto('/login/google/callback?code=code&state=state');
	await expect(page).toHaveURL(/\/groceries$/);
});
