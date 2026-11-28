import type { Page } from '@playwright/test';
import {
	UNREACHABLE,
	addInvite,
	addNewcomer,
	addPerson,
	addStore,
	adminId,
	answerAction,
	dropActions,
	expect,
	open,
	signInAs,
	test
} from './fixtures.ts';

/** Coming back to the tab or app, which reloads the page's data (Q11). */
async function comeBack(page: Page) {
	const reloaded = page.waitForResponse((response) => response.url().includes('/__data.json'));
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await reloaded;
}

test('sends signed-out people to the sign-in page', async ({ page }) => {
	await page.goto('/groceries');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
});

test('sets up a household on first sign-in', async ({ page, db, context, baseURL }) => {
	const { userId } = addNewcomer(db, { startInvite: true });
	await signInAs(db, context, baseURL, userId);

	await open(page, '/groceries');
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

	// Its Recipes start with the default dishes (6.18), each but Sloppy Joes with a copy of its photo
	// of its own (6.19), shown like any recipe's photo.
	const photos = db
		.prepare('select count(distinct photo_key) from dishes where household_id = ?')
		.pluck();
	expect(photos.get(household.id)).toBe(79);
	await page.goto('/recipes');
	const pie = page.getByRole('link', { name: /^Apple Pie/ });
	await expect(pie.locator('img')).toHaveAttribute('src', /^\/photos\/[0-9a-f]{32}-thumb\.jpg$/);
	await expect
		.poll(() => pie.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBe(400);
});

test('asks someone invited by more than one household which to join (MEA-112)', async ({
	page,
	db,
	context,
	baseURL
}) => {
	const tag = `${test.info().workerIndex}-${Date.now()}`;
	const rename = db.prepare('update households set name = ? where id = ?');
	const smiths = addPerson(db).householdId;
	const joneses = addPerson(db).householdId;
	rename.run(`Smiths ${tag}`, smiths);
	rename.run(`Joneses ${tag}`, joneses);
	// Signing in with invites from both gave them an account without a household (6.1).
	const { userId, email } = addNewcomer(db, { startInvite: false });
	const invite = db.prepare('insert into invites (email, household_id, created_at) values (?, ?, 0)');
	invite.run(email, smiths);
	invite.run(email, joneses);
	db.prepare('update users set tour_seen = 0 where id = ?').run(userId);
	await signInAs(db, context, baseURL, userId);

	await open(page, '/groceries');
	await expect(page).toHaveURL(/\/setup$/);
	await expect(page.getByText('These households invited you.', { exact: false })).toBeVisible();
	const choice = (name: string) => page.getByRole('listitem').filter({ hasText: name });
	await expect(choice(`Smiths ${tag}`)).toBeVisible();
	// Only the admin, or someone invited to start a household, can set one up.
	await expect(page.getByLabel('Household name')).toHaveCount(0);

	// The Smiths cancel their invite meanwhile, so it can't be used, and it leaves the list.
	db.prepare('delete from invites where email = ? and household_id = ?').run(email, smiths);
	await choice(`Smiths ${tag}`).getByRole('button', { name: 'Join' }).click();
	await expect(page.getByRole('alert')).toHaveText('That invite was cancelled.');
	await expect(choice(`Smiths ${tag}`)).toHaveCount(0);
	await expect(page.getByText('This household invited you to join it.')).toBeVisible();

	await choice(`Joneses ${tag}`).getByRole('button', { name: 'Join' }).click();
	await expect(page).toHaveURL(/\/groceries$/);
	await expect(page.getByRole('banner')).toContainText(`Joneses ${tag}`);
	const householdOf = db.prepare('select household_id from users where id = ?').pluck();
	expect(householdOf.get(userId)).toBe(joneses);
	expect(db.prepare('select count(*) from invites where email = ?').pluck().get(email)).toBe(0);
});

test('keeps typed settings through the page reloading until Save (MEA-130)', async ({
	page,
	db,
	person
}) => {
	await open(page, '/household');
	const name = page.getByLabel('Household name');
	const servings = page.getByLabel('Usual number of servings');
	const timeZone = page.getByLabel('Time zone');
	await name.fill('The Robins');
	await servings.fill('6');
	await timeZone.selectOption('America/Denver');

	// Checking a spelling in another app and coming back reloads the page's data.
	await comeBack(page);
	await expect(name).toHaveValue('The Robins');
	await expect(servings).toHaveValue('6');
	await expect(timeZone).toHaveValue('America/Denver');

	// So does adding a store, also after someone else saved other settings meanwhile.
	db.prepare(
		'update households set name = ?, default_servings = 2, time_zone = ? where id = ?'
	).run('The Jays', 'America/New_York', person.householdId);
	await page.getByLabel('Store name').fill('Costco');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('Costco', { exact: true })).toBeVisible();
	await expect(name).toHaveValue('The Robins');
	await expect(servings).toHaveValue('6');
	await expect(timeZone).toHaveValue('America/Denver');

	// Save keeps what was typed, the last save winning (6.11), and the fields show what was saved.
	await name.fill('  The   Robins ');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('Saved.');
	const settings = db.prepare(
		'select name, default_servings, time_zone from households where id = ?'
	);
	expect(settings.get(person.householdId)).toEqual({
		name: 'The Robins',
		default_servings: 6,
		time_zone: 'America/Denver'
	});
	await expect(name).toHaveValue('The Robins');
});

test('manages stores and invites', async ({ page, db, person }) => {
	await open(page, '/household');

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

	// Answered here, so nothing goes to Resend (the server's side is in page.server.spec.ts), with
	// the invite saved as the action saves it. Each household's invites stand on their own, so other
	// tests' don't get in the way (MEA-112).
	const friend = 'friend@example.com';
	const sent = `Invited ${friend}. An invite email was sent to them.`;
	await answerAction(page, '/household', 'invite', { action: 'invite', message: sent });
	await page.getByLabel('Email').fill(friend);
	addInvite(db, friend, person.householdId);
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('status')).toHaveText(sent);
	await expect(page.getByLabel('Email')).toHaveValue('');
	await expect(page.getByText(friend, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText(friend, { exact: true })).toHaveCount(0);
});

test("shows an invite whose email couldn't be sent as saved, and says so (MEA-26)", async ({
	page,
	db,
	person
}) => {
	await open(page, '/household');

	// Answered as the server answers when Resend refuses the email, once the invite is saved.
	const friend = 'friend@example.com';
	const notSent = `Invited ${friend}, but the invite email couldn't be sent. Tell them to sign in with that Google account.`;
	await answerAction(page, '/household', 'invite', { action: 'invite', error: notSent });
	await page.getByLabel('Email').fill(friend);
	addInvite(db, friend, person.householdId);
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('alert')).toHaveText(notSent);
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.getByLabel('Email')).toHaveValue('');
	await expect(page.getByText(friend, { exact: true })).toBeVisible();
});

test('keeps a household to 20 invites waiting (MEA-112)', async ({ page, db, person }) => {
	const invite = db.prepare('insert into invites (email, household_id, created_at) values (?, ?, 0)');
	for (let i = 0; i < 20; i += 1) invite.run(`guest-${i}@example.com`, person.householdId);
	await open(page, '/household');

	await page.getByLabel('Email').fill('one-more@example.com');
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Your household can have 20 invites waiting at a time. Cancel one to invite someone else.'
	);
	await expect(page.getByText('one-more@example.com', { exact: true })).toHaveCount(0);
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
	await expect(page.getByText('Waiting for them to join:')).toHaveCount(0);
});

test("keeps the Household page and what was typed when an action can't reach Meals (MEA-111)", async ({
	page,
	db,
	person
}) => {
	addStore(db, person.householdId, 'Costco');
	await open(page, '/household');
	const reconnect = await dropActions(page);

	// The invite says so under it, with the address still typed.
	await page.getByLabel('Email').fill('friend@example.com');
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('alert')).toHaveText(UNREACHABLE);
	await expect(page.getByLabel('Email')).toHaveValue('friend@example.com');

	// A store's sheet stays open with the name typed in it.
	await page.getByRole('button', { name: 'Edit' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Costco Wholesale');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog.getByRole('alert')).toHaveText(UNREACHABLE);
	await expect(dialog.getByLabel('Name')).toHaveValue('Costco Wholesale');

	// Once Meals answers, the same Save goes through.
	await reconnect();
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText('Costco Wholesale', { exact: true })).toBeVisible();
	expect(
		db.prepare('select count(*) from invites where household_id = ?').pluck().get(person.householdId)
	).toBe(0);
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

	await open(page, '/admin');
	await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
	await expect(page.getByText('No backups yet.')).toBeVisible();
	// Answered here, so nothing goes to Resend (the server's side is in page.server.spec.ts), with
	// the invite saved as the action saves it.
	const email = `household-${test.info().workerIndex}-${Date.now()}@example.com`;
	const sent = `Invited ${email} to start a household. An invite email was sent to them.`;
	await answerAction(page, '/admin', 'invite', { action: 'invite', message: sent });
	await page.getByLabel('Email').fill(email);
	addInvite(db, email, null);
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByRole('status')).toHaveText(sent);
	await expect(page.getByLabel('Email')).toHaveValue('');
	await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("lists each household's invites waiting on Admin (MEA-112)", async ({
	page,
	db,
	context,
	baseURL
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	const household = addPerson(db);
	const invite = db.prepare('insert into invites (email, household_id, created_at) values (?, ?, 0)');
	invite.run('sam@example.com', household.householdId);
	invite.run('pat@example.com', household.householdId);
	await open(page, '/admin');

	const listed = page.getByRole('listitem').filter({ hasText: household.email });
	await expect(listed).toContainText('Invited: pat@example.com, sam@example.com');
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

test('says where the admin test email went, and stays on Admin', async ({
	page,
	db,
	context,
	baseURL
}) => {
	await signInAs(db, context, baseURL, adminId(db));
	await open(page, '/admin');
	const section = page.locator('section').filter({
		has: page.getByRole('heading', { name: 'Email', level: 2 })
	});
	// It goes to the admin's own Google email, so there's no field for another.
	await expect(section.getByRole('textbox')).toHaveCount(0);

	// Answered here, so nothing goes to Resend (the server's side is in page.server.spec.ts).
	const sent = 'Test email sent to admin@example.com. Check your inbox.';
	await answerAction(page, '/admin', 'testEmail', { action: 'testEmail', message: sent });
	await section.getByRole('button', { name: 'Send test email' }).click();
	await expect(section.getByRole('status')).toHaveText(sent);
	// Only in the Email section.
	await expect(page.getByRole('status')).toHaveCount(1);
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
});

test('shows the privacy page to anyone, linked from the sign-in page', async ({ page }) => {
	await open(page, '/login');
	await page.getByRole('link', { name: 'Privacy' }).click();
	await expect(page).toHaveURL(/\/privacy$/);
	await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
});
