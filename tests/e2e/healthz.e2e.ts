import { expect, test } from './fixtures.ts';

// The commit playwright.config.ts builds the app with.
const COMMIT = 'e2e-commit';

test('answers with the commit the app was built from, for the deploy to check (design 4.2)', async ({
	request
}) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
	expect(await response.text()).toBe(COMMIT);
});
