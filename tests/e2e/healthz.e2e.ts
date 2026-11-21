import { expect, test } from './fixtures.ts';

// The commit the app was built from: the image's when CI sets COMMIT, otherwise the one
// playwright.config.ts gives the build.
const COMMIT = process.env.COMMIT ?? 'e2e-commit';

test('answers with the commit the app was built from, for the deploy to check (design 4.2)', async ({
	request
}) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
	expect(await response.text()).toBe(COMMIT);
});
