import { adminId, expect, open, signInAs, test } from './fixtures.ts';

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
		.get(userId) as { id: number };
	expect(household).toMatchObject({ default_servings: 3, time_zone: 'America/Denver' });

	// Its catalog starts with the standard items, ready to pick, and the list is empty (6.13),
	// each with a copy of its image of its own (6.14).
	const items = db.prepare('select count(*) from items where household_id = ?').pluck();
	expect(items.get(household.id)).toBe(288);
	const images = db
		.prepare('select count(distinct photo_key) from items where household_id = ?')
		.pluck();
	expect(images.get(household.id)).toBe(288);
	// Past the first-time tour, which would cover the list, as the person fixture is.
	db.prepare('update users set tour_seen = 0 where id = ?').run(userId);
	await open(page, '/groceries');
	await expect(page.getByText('Nothing on the list. Add something above.')).toBeVisible();
	const add = page.getByRole('form', { name: 'Add to the list' });
	await add.getByRole('combobox', { name: 'Item' }).fill('bananas');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Bananas']);
	await page.getByRole('option', { name: 'Bananas' }).click();
	await add.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByRole('button', { name: /^Bananas/ })).toBeVisible();
	await page.goto('/groceries/items');
	const zucchini = page.getByRole('button', { name: /^Zucchini/ });
	await expect(zucchini).toBeVisible();
	await expect(zucchini.locator('img')).toHaveAttribute('src', /^\/photos\/[0-9a-f]{32}-thumb\.jpg$/);
	// Images load as they scroll into view, and Zucchini is last.
	await zucchini.scrollIntoViewIfNeeded();
	await expect
		.poll(() => zucchini.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBe(400);
});

test('manages stores and invites', async ({ page, person: _ }) => {
	await page.goto('/household');

	await page.getByLabel('Store name').fill('Costco');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('Costco', { exact: true })).toBeVisible();

	await page.getByLabel('Store name').fill('costco');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('You already have a store called costco.');

	const dialog = page.getByRole('dialog');
	// Edits abandoned with the close button don't come back.
	await page.getByRole('button', { name: 'Edit' }).click();
	await dialog.getByLabel('Name').fill('Sams Club');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: 'Edit' }).click();
	await expect(dialog.getByLabel('Name')).toHaveValue('Costco');

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

test('keeps the Household page for a member or invite that is already gone (6.1)', async ({
	page,
	db,
	person
}) => {
	const tag = `${test.info().workerIndex}-${Date.now()}`;
	const sam = `sam-${tag}@example.com`;
	const addMember = db.prepare(
		'insert into users (household_id, google_sub, email, name, created_at) values (?, ?, ?, ?, 0)'
	);
	const kim = addMember.run(person.householdId, `kim-${tag}`, `kim-${tag}@example.com`, 'Kim');
	db.prepare('insert into invites (email, household_id, created_at) values (?, ?, 0)').run(
		sam,
		person.householdId
	);
	await open(page, '/household');

	// Someone else removes Kim meanwhile.
	db.prepare('delete from users where id = ?').run(kim.lastInsertRowid);
	await page.getByRole('button', { name: 'Remove' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
	await expect(page.getByText('Kim', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

	// Sam signs in meanwhile, which uses the invite.
	addMember.run(person.householdId, `sam-${tag}`, sam, 'Sam');
	db.prepare('delete from invites where email = ?').run(sam);
	const invite = page.getByRole('listitem').filter({ hasText: sam });
	await invite.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText('Sam', { exact: true })).toBeVisible();
	await expect(page.getByText('Waiting for them to sign in:')).toHaveCount(0);
});

test('names members by first name, or whole name while another has it (6.1)', async ({
	page,
	db,
	person
}) => {
	const tag = `${test.info().workerIndex}-${Date.now()}`;
	const addMember = db.prepare(
		'insert into users (household_id, google_sub, email, name, created_at) values (?, ?, ?, ?, 0)'
	);
	addMember.run(person.householdId, `robin-${tag}`, `robin-${tag}@example.com`, 'Robin Lee');
	await open(page, '/household');
	await expect(page.getByText('Person', { exact: true })).toBeVisible();
	await expect(page.getByText('Robin', { exact: true })).toBeVisible();
	await expect(page.getByText('Robin Lee')).toHaveCount(0);

	// Someone else in the household is a Person, ignoring case.
	addMember.run(person.householdId, `park-${tag}`, `park-${tag}@example.com`, 'person Park');
	await open(page, '/household');
	await expect(page.getByText(/^Person \d+$/)).toBeVisible();
	await expect(page.getByText('Robin', { exact: true })).toBeVisible();
	const park = page.getByRole('listitem').filter({ hasText: 'person Park' });
	await park.getByRole('button', { name: 'Remove' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(
		"Remove person Park? They won't be able to sign in until someone invites them again."
	);
	await dialog.getByRole('button', { name: 'Remove' }).click();

	// Once they're gone, first names are enough again.
	await expect(page.getByText('Person', { exact: true })).toBeVisible();
	await expect(page.getByText('person Park')).toHaveCount(0);
	// Names are kept whole.
	const names = db.prepare('select name from users where household_id = ? order by id').pluck();
	expect(names.all(person.householdId)).toEqual([
		expect.stringMatching(/^Person \d+$/),
		'Robin Lee'
	]);
});

test('keeps the admin page from everyone but the admin', async ({ page, person: _ }) => {
	const response = await page.goto('/admin');
	expect(response?.status()).toBe(404);
});

test('lets the admin invite a household', async ({ page, db, context, baseURL }) => {
	const userId = adminId(db);
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

test('keeps the Admin page for an invite that is already gone (6.1)', async ({
	page,
	db,
	context,
	baseURL
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	const email = `gone-${test.info().workerIndex}-${Date.now()}@example.com`;
	db.prepare('insert into invites (email, created_at) values (?, 0)').run(email);
	await open(page, '/admin');

	// The admin cancels it in another tab meanwhile.
	db.prepare('delete from invites where email = ?').run(email);
	const invite = page.getByRole('listitem').filter({ hasText: email });
	await invite.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText(email, { exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
});

test('shows the privacy page to anyone, linked from the sign-in page', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('link', { name: 'Privacy' }).click();
	await expect(page).toHaveURL(/\/privacy$/);
	await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
});
