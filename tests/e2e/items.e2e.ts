import { existsSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import {
	addItem,
	addPhotoFiles,
	addStore,
	expect,
	makeJpeg,
	makePng,
	open,
	photoFile,
	test
} from './fixtures.ts';

test('renames and archives an item, and asks before adding it again', async ({ page, person: _ }) => {
	await page.goto('/groceries');
	const add = page.getByRole('form', { name: 'Add to the list' });
	await add.getByRole('combobox', { name: 'Item' }).fill('Dish soap');
	await add.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByRole('button', { name: /^Dish soap/ })).toBeVisible();

	await page.goto('/groceries/items');
	const dialog = page.getByRole('dialog');
	// Edits abandoned with the close button don't come back.
	await page.getByRole('button', { name: /^Dish soap/ }).click();
	await dialog.getByLabel('Name').fill('Something else');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: /^Dish soap/ }).click();
	await expect(dialog.getByLabel('Name')).toHaveValue('Dish soap');

	await dialog.getByLabel('Name').fill('Dawn dish soap');
	await dialog.getByLabel('Notes').fill('Blue, 20 oz');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('button', { name: /^Dawn dish soap\s*Blue, 20 oz/ })).toBeVisible();

	await page.getByRole('button', { name: /^Dawn dish soap/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
	await page.getByRole('dialog').last().getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByText('No items.')).toBeVisible();

	// The line on the list keeps working; adding the archived name again asks first.
	await page.goto('/groceries');
	await expect(page.getByRole('button', { name: /^Dawn dish soap/ })).toBeVisible();
	await add.getByRole('combobox', { name: 'Item' }).fill('dawn dish soap');
	await add.getByRole('button', { name: 'Add' }).click();
	const prompt = page.getByRole('dialog');
	await expect(prompt).toContainText('Dawn dish soap is archived.');
	await prompt.getByRole('button', { name: 'Restore and add' }).click();
	// Restored, it's already on the list, so the duplicate question follows.
	await expect(page.getByRole('dialog')).toContainText('Already on the list: 1');
});

test("keeps an item's Always have when it's saved, without showing it", async ({
	page,
	db,
	person
}) => {
	// The pantry check is hidden (design 6.8), so the Items page leaves Always have as stored.
	const salt = addItem(db, person.householdId, 'Salt', { alwaysHave: true });
	await page.goto('/groceries/items');
	const row = page.getByRole('button', { name: /^Salt/ });
	await expect(row).not.toContainText('Always have');

	await row.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Always have')).toHaveCount(0);
	await dialog.getByLabel('Notes').fill('Kosher');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(row).toContainText('Kosher');
	expect(db.prepare('select notes, always_have from items where id = ?').get(salt)).toEqual({
		notes: 'Kosher',
		always_have: 1
	});
});

test.describe('on a phone in another time zone', () => {
	test.use({ timezoneId: 'Asia/Tokyo' });

	test("shows the last-bought date in the household's time zone", async ({
		page,
		db,
		person
	}) => {
		const aldi = addStore(db, person.householdId, 'Aldi');
		const milk = addItem(db, person.householdId, 'Milk', { defaultStoreId: aldi });
		// 9 pm on Fri, Mar 14 in Chicago, where the household is, is already Mar 15 in UTC and Tokyo.
		const received = Date.UTC(2025, 2, 15, 2, 0);
		db.prepare(
			"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, 1, ?, 'received', ?, ?, ?)"
		).run(person.householdId, milk, aldi, received, received, received);

		// As the server shows it, and as the phone shows it after going there within the app.
		await page.goto('/groceries/items');
		const row = page.getByRole('button', { name: /^Milk/ });
		await expect(row).toContainText('Aldi · last bought Fri, Mar 14, 2025 at Aldi');
		await page.goto('/groceries');
		await page.getByRole('link', { name: 'Items', exact: true }).click();
		await expect(page).toHaveURL(/\/groceries\/items$/);
		await expect(row).toContainText('Aldi · last bought Fri, Mar 14, 2025 at Aldi');
	});
});

// An item's image (MEA-50): added in the Items sheet from the device or a link, and shown beside
// the item's name throughout Groceries.

/** The Items sheet's Image group. */
const imageGroup = (page: Page) => page.getByRole('dialog').getByRole('group', { name: 'Image' });

const imageInput = (page: Page) => page.getByRole('dialog').locator('input[type="file"]');

function photoKeyOf(db: Database.Database, itemId: number): string | null {
	return db.prepare('select photo_key from items where id = ?').pluck().get(itemId) as string | null;
}

/** A stored image, as a device would have sent it, and its key. */
async function storedImage(page: Page): Promise<string> {
	return addPhotoFiles(
		await makeJpeg(page, { width: 800, height: 600, hue: 200 }),
		await makeJpeg(page, { width: 400, height: 300, hue: 200 })
	);
}

/** Checks the image has loaded, and returns its width. */
async function loadedWidth(image: Locator): Promise<number> {
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)
		)
		.toBeGreaterThan(0);
	return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

function addLine(
	db: Database.Database,
	householdId: number,
	itemId: number,
	storeId: number,
	status: 'to_order' | 'received'
) {
	const now = Date.now();
	const done = status === 'received' ? now : null;
	db.prepare(
		'insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at, ordered_at, received_at) values (?, ?, 1, ?, ?, ?, ?, ?)'
	).run(householdId, itemId, storeId, status, now, done, done);
}

test('adds, replaces and removes an image from the device, shown throughout Groceries', async ({
	page,
	db,
	person
}) => {
	const aldi = addStore(db, person.householdId, 'Aldi');
	const milk = addItem(db, person.householdId, 'Milk', { defaultStoreId: aldi });
	const eggs = addItem(db, person.householdId, 'Eggs', { defaultStoreId: aldi });
	addLine(db, person.householdId, milk, aldi, 'received');
	addLine(db, person.householdId, milk, aldi, 'to_order');
	addLine(db, person.householdId, eggs, aldi, 'to_order');
	const dialog = page.getByRole('dialog');
	const milkRow = page.getByRole('button', { name: /^Milk/ });
	const eggsRow = page.getByRole('button', { name: /^Eggs/ });

	await open(page, '/groceries/items');
	await milkRow.click();
	await expect(imageGroup(page).locator('img')).toHaveCount(0);
	await expect(imageGroup(page).getByRole('button', { name: 'Remove image' })).toHaveCount(0);
	const photo = await makeJpeg(page, { width: 2400, height: 1800, hue: 40 });
	await imageInput(page).setInputFiles({ name: 'milk.jpg', mimeType: 'image/jpeg', buffer: photo });
	// Resized on the phone and shown before it's saved, as a recipe's photo is.
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	await expect(imageGroup(page).getByRole('button', { name: 'Change image' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);

	const first = photoKeyOf(db, milk);
	if (first === null) throw new Error('Expected an image');
	const thumb = `/photos/${first}-thumb.jpg`;
	await expect(milkRow.locator('img')).toHaveAttribute('src', thumb);
	expect(await loadedWidth(milkRow.locator('img'))).toBe(400);
	expect((await page.request.get(`/photos/${first}.jpg`)).status()).toBe(200);
	// Items without an image show as they always have.
	await expect(eggsRow.locator('img')).toHaveCount(0);

	// The list, the add bar's suggestions and History show it too.
	await open(page, '/groceries');
	await expect(milkRow.locator('img')).toHaveAttribute('src', thumb);
	await expect(eggsRow.locator('img')).toHaveCount(0);
	await page.getByRole('combobox', { name: 'Item' }).fill('mil');
	await expect(page.getByRole('option', { name: 'Milk' }).locator('img')).toHaveAttribute('src', thumb);
	await page.getByRole('combobox', { name: 'Item' }).fill('egg');
	await expect(page.getByRole('option', { name: 'Eggs' }).locator('img')).toHaveCount(0);
	await open(page, '/groceries/history');
	await expect(page.getByRole('listitem').filter({ hasText: 'Milk' }).locator('img')).toHaveAttribute(
		'src',
		thumb
	);

	// Replaced with a PNG, such as a screenshot.
	await open(page, '/groceries/items');
	await milkRow.click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', thumb);
	const png = await makePng(page, { width: 300, height: 200, hue: 120 });
	await imageInput(page).setInputFiles({ name: 'milk.png', mimeType: 'image/png', buffer: png });
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	const second = photoKeyOf(db, milk);
	if (second === null) throw new Error('Expected an image');
	expect(second).not.toBe(first);
	await expect(milkRow.locator('img')).toHaveAttribute('src', `/photos/${second}-thumb.jpg`);
	expect(await loadedWidth(milkRow.locator('img'))).toBe(300);
	// The replaced image is gone.
	expect((await page.request.get(`/photos/${first}.jpg`)).status()).toBe(404);
	expect(existsSync(photoFile(first, 'full'))).toBe(false);
	expect(existsSync(photoFile(first, 'thumb'))).toBe(false);

	// Removed, after changing one's mind once.
	await milkRow.click();
	await imageGroup(page).getByRole('button', { name: 'Remove image' }).click();
	await expect(dialog.getByText('The image is removed when you save.')).toBeVisible();
	await expect(imageGroup(page).getByRole('button', { name: 'Add image' })).toBeFocused();
	await imageGroup(page).getByRole('button', { name: 'Keep the old image' }).click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', `/photos/${second}-thumb.jpg`);
	await imageGroup(page).getByRole('button', { name: 'Remove image' }).click();
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(milkRow.locator('img')).toHaveCount(0);
	expect(photoKeyOf(db, milk)).toBeNull();
	expect(existsSync(photoFile(second, 'full'))).toBe(false);
	expect(existsSync(photoFile(second, 'thumb'))).toBe(false);
});

test("keeps the image when a link can't be downloaded", async ({ page, db, person, baseURL }) => {
	const key = await storedImage(page);
	const milk = addItem(db, person.householdId, 'Milk', { photoKey: key });
	const dialog = page.getByRole('dialog');
	const link = imageGroup(page).getByLabel('Image link');

	await open(page, '/groceries/items');
	await page.getByRole('button', { name: /^Milk/ }).click();
	// A link replaces an image picked before it.
	const photo = await makeJpeg(page, { width: 600, height: 600, hue: 300 });
	await imageInput(page).setInputFiles({ name: 'milk.jpg', mimeType: 'image/jpeg', buffer: photo });
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	// The server refuses its own computer, the only address these tests have (design 4.5).
	const own = `${baseURL}/photos/${key}.jpg`;
	await link.fill(own);
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
	await expect(dialog.getByText('Saving downloads the image from this link and uses it.')).toBeVisible();
	await dialog.getByLabel('Name').fill('Whole milk');
	await dialog.getByRole('button', { name: 'Save' }).click();

	await expect(dialog.getByRole('alert')).toHaveText(
		"Couldn't download an image from that link. Check the link, or try an image under 5 MB."
	);
	// Nothing changed, and what was typed stays for another try.
	expect(db.prepare('select name, photo_key from items where id = ?').get(milk)).toEqual({
		name: 'Milk',
		photo_key: key
	});
	await expect(link).toHaveValue(own);
	await expect(dialog.getByLabel('Name')).toHaveValue('Whole milk');
	await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();

	// Picking an image clears the link again.
	await imageInput(page).setInputFiles({ name: 'milk.jpg', mimeType: 'image/jpeg', buffer: photo });
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	await expect(link).toHaveValue('');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('button', { name: /^Milk/ }).locator('img')).toHaveAttribute(
		'src',
		`/photos/${key}-thumb.jpg`
	);
	expect(existsSync(photoFile(key, 'full'))).toBe(true);
});

test("keeps an archived item's image, and shows it again once restored", async ({
	page,
	db,
	person
}) => {
	const key = await storedImage(page);
	const milk = addItem(db, person.householdId, 'Milk', { photoKey: key });
	const dialog = page.getByRole('dialog');
	const milkRow = page.getByRole('button', { name: /^Milk/ });
	const thumb = `/photos/${key}-thumb.jpg`;

	await open(page, '/groceries/items');
	await milkRow.click();
	await dialog.getByRole('button', { name: 'Archive' }).click();
	await page.getByRole('dialog').last().getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByText('No items.')).toBeVisible();

	await page.getByRole('link', { name: 'Show archived items' }).click();
	await expect(milkRow.locator('img')).toHaveAttribute('src', thumb);
	expect(await loadedWidth(milkRow.locator('img'))).toBe(400);
	await milkRow.click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', thumb);
	await dialog.getByRole('button', { name: 'Restore' }).click();

	// Restore lands on the active items, where it's back with its image.
	await expect(page).toHaveURL(/\/groceries\/items$/);
	await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();
	await expect(milkRow.locator('img')).toHaveAttribute('src', thumb);
	expect(photoKeyOf(db, milk)).toBe(key);
	expect(existsSync(photoFile(key, 'full'))).toBe(true);
});

test.describe('on a computer', () => {
	test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

	test('shows item images beside their names', async ({ page, db, person }) => {
		const aldi = addStore(db, person.householdId, 'Aldi');
		const key = await storedImage(page);
		const milk = addItem(db, person.householdId, 'Milk', { defaultStoreId: aldi, photoKey: key });
		addLine(db, person.householdId, milk, aldi, 'to_order');
		const thumb = page.getByRole('button', { name: /^Milk/ }).locator('img');

		for (const path of ['/groceries', '/groceries/items']) {
			await open(page, path);
			await expect(thumb).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
			expect(await loadedWidth(thumb)).toBe(400);
			// Beside the name, at the size it's shown in.
			const image = await thumb.boundingBox();
			const name = await page.getByRole('button', { name: /^Milk/ }).getByText('Milk').boundingBox();
			expect(image && name && image.x + image.width <= name.x).toBe(true);
			expect(image?.width).toBe(path === '/groceries' ? 40 : 48);
		}
	});
});

test('rejects a sign-in callback that did not start here', async ({ page }) => {
	const response = await page.goto('/login/google/callback?code=abc&state=forged');
	expect(response?.status()).toBe(400);
	await expect(page.getByText('Sign-in was cancelled or expired.')).toBeVisible();
});

test('shows the invite-only page only the address that was really used', async ({
	page,
	context,
	baseURL
}) => {
	await context.addCookies([
		{ name: 'not_invited_email', value: 'stranger@example.com', url: `${baseURL}/not-invited` }
	]);
	await page.goto('/not-invited');
	await expect(page.getByText("stranger@example.com hasn't been invited.")).toBeVisible();

	// Text in the URL is ignored, so nobody can make the page say something else.
	await context.clearCookies();
	await page.goto('/not-invited?email=Your%20account%20is%20locked');
	await expect(page.getByText("This account hasn't been invited.")).toBeVisible();
});
