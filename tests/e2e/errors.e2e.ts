import { expect, open, test } from './fixtures.ts';

// An unexpected error's page shows the id the server's log has for it, and nothing about what went
// wrong. Errors Meals expects keep their pages, with no id (design 4.5, MEA-118).

const ERROR_ID = /^Error ID: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('shows an id for an unexpected error, and nothing about what went wrong', async ({
	page,
	db,
	person
}) => {
	await open(page, '/groceries');
	// A time zone Household never saves, so working out today's date fails on the server.
	db.prepare("update households set time_zone = 'Nowhere/Nothing' where id = ?").run(
		person.householdId
	);

	// From the tabs, the page's script gets Menu's data from the server.
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Menu' }).click();
	await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
	await expect(page.getByText(ERROR_ID)).toBeVisible();

	// Opened directly, the server sends the page.
	const response = await page.goto('/menu');
	expect(response?.status()).toBe(500);
	await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
	await expect(page.getByText('Internal Error', { exact: true })).toBeVisible();
	const errorId = page.getByText(ERROR_ID);
	await expect(errorId).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back to Meals' })).toBeVisible();
	// Nothing about the error, even in what the page sends for its script.
	const html = await response!.text();
	expect(html).not.toContain('RangeError');
	expect(html).not.toContain('Nowhere/Nothing');

	// Each error gets its own.
	const first = await errorId.textContent();
	await page.reload();
	await expect(errorId).toBeVisible();
	expect(await errorId.textContent()).not.toBe(first);
});

test('shows no id for errors Meals expects', async ({ page, request, person: _ }) => {
	// A 404 from Meals, for a recipe that isn't there, and from SvelteKit, for an address that
	// matches no page.
	for (const path of ['/recipes/999999', '/nope']) {
		expect((await page.goto(path))?.status(), path).toBe(404);
		await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
		await expect(page.getByText('Error ID')).toHaveCount(0);
	}

	// A 400, for an assistant's connection request that isn't valid (6.17).
	expect((await page.goto('/oauth/authorize'))?.status()).toBe(400);
	await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
	await expect(page.getByText(/^This connection request isn't valid\./)).toBeVisible();
	await expect(page.getByText('Error ID')).toHaveCount(0);

	// A 403, for a form from another site (4.5), as a page's script gets it.
	const refused = await request.post('/groceries?/add', {
		form: { name: 'Milk' },
		headers: { origin: 'https://evil.example', accept: 'application/json' }
	});
	expect(refused.status()).toBe(403);
	expect(await refused.json()).toEqual({
		status: 403,
		message: 'Cross-site POST form submissions are forbidden'
	});
});
