import { expect, open, test } from './fixtures.ts';

// Temporary, dropped before the pull request: fails on purpose so the run's
// playwright-test-results artifact can be checked for its trace (MEA-122).
test('fails on purpose so CI keeps its trace (MEA-122)', async ({ page, person }) => {
	await open(page, '/groceries');
	await page.evaluate(() => console.log('MEA-122 trace check'));
	await expect(page.getByRole('heading', { name: 'No screen has this heading' })).toBeVisible({
		timeout: 2_000
	});
});
