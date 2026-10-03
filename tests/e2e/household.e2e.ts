import { expect, signInAs, test } from './fixtures.ts';

test('sends signed-out people to the sign-in page', async ({ page }) => {
	await page.goto('/groceries');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
});

test('sets up a household on first sign-in', async ({ page, db, context, baseURL }) => {
	const userId = Number(
		db
			.prepare(
				"insert into users (google_sub, email, name, created_at) values (?, ?, 'Robin', 0)"
			)
			.run(`setup-${Date.now()}`, `setup-${Date.now()}@example.com`).lastInsertRowid
	);
	await signInAs(db, context, baseURL, userId);

	await page.goto('/groceries');
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByLabel('Household name').fill('The Robins');
	await page.getByLabel('Usual number of servings').fill('3');
	await page.getByLabel('Time zone').selectOption('America/Denver');
	await page.getByRole('button', { name: 'Create household' }).click();

	await expect(page).toHaveURL(/\/groceries$/);
	await expect(page.getByRole('banner')).toContainText('The Robins');
	const household = db
		.prepare('select h.* from households h join users u on u.household_id = h.id where u.id = ?')
		.get(userId);
	expect(household).toMatchObject({ default_servings: 3, time_zone: 'America/Denver' });
});

test('manages stores and invites', async ({ page, person: _ }) => {
	await page.goto('/household');

	await page.getByLabel('Store name').fill('Costco');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('Costco', { exact: true })).toBeVisible();

	await page.getByLabel('Store name').fill('costco');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('You already have a store called costco.');

	await page.getByRole('button', { name: 'Edit' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Costco Wholesale');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Costco Wholesale', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
	await page.getByRole('dialog').last().getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible();
	await page.getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByRole('heading', { name: 'Archived' })).toHaveCount(0);

	// Invites are unique across the whole site, so each run uses its own address.
	const friend = `friend-${test.info().workerIndex}-${Date.now()}@example.com`;
	await page.getByLabel('Email').fill(friend.toUpperCase());
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('status')).toContainText(`Invited ${friend}`);
	await expect(page.getByText(friend, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText(friend, { exact: true })).toHaveCount(0);
});

test('keeps the admin page from everyone but the admin', async ({ page, person: _ }) => {
	const response = await page.goto('/admin');
	expect(response?.status()).toBe(404);
});

test('lets the admin invite a household', async ({ page, db, context, baseURL }) => {
	const existing = db.prepare("select id from users where email = 'admin@example.com'").get() as
		| { id: number }
		| undefined;
	const userId =
		existing?.id ??
		Number(
			db
				.prepare(
					"insert into households (name, default_servings, time_zone, created_at) values ('Admin home', 2, 'UTC', 0)"
				)
				.run().lastInsertRowid &&
				db
					.prepare(
						"insert into users (household_id, google_sub, email, name, created_at) values ((select max(id) from households), 'admin-sub', 'admin@example.com', 'Admin', 0)"
					)
					.run().lastInsertRowid
		);
	await signInAs(db, context, baseURL, userId);

	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
	await expect(page.getByText('No backups yet.')).toBeVisible();
	const email = `household-${Date.now()}@example.com`;
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('status')).toContainText(`Invited ${email} to start a household.`);
	expect(db.prepare('select household_id from invites where email = ?').get(email)).toEqual({
		household_id: null
	});
});

test('shows the privacy page to anyone, linked from the sign-in page', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('link', { name: 'Privacy' }).click();
	await expect(page).toHaveURL(/\/privacy$/);
	await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
});
