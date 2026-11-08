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

// An item's image (design 7, Item images).

const sheet = (page: Page) => page.getByRole('dialog');
const imageGroup = (page: Page) => sheet(page).getByRole('group', { name: 'Image' });
const imageFile = (page: Page) => imageGroup(page).locator('input[type="file"]');
const itemRow = (page: Page, name: string) =>
	page.getByRole('button', { name: new RegExp(`^${name}`) });
const NO_IMAGE =
	"Couldn't get an image from that link. Use the image's own link, not the page it's on.";

/** The key of the item's image, or null. */
function imageKey(db: Database.Database, itemId: number): string | null {
	return db.prepare('select photo_key from items where id = ?').pluck().get(itemId) as
		string | null;
}

/** Gives the item an image, stored as the server stores one, and returns its key. */
async function giveImage(page: Page, db: Database.Database, itemId: number): Promise<string> {
	const key = addPhotoFiles(
		await makeJpeg(page, { width: 1600, height: 1200 }),
		await makeJpeg(page, { width: 400, height: 300 })
	);
	db.prepare('update items set photo_key = ? where id = ?').run(key, itemId);
	return key;
}

/** Puts a To Order line for the item on the list, at the store. */
function addLine(db: Database.Database, householdId: number, itemId: number, storeId: number) {
	db.prepare(
		"insert into grocery_needs (household_id, item_id, quantity, store_id, status, created_at) values (?, ?, 1, ?, 'to_order', ?)"
	).run(householdId, itemId, storeId, Date.now());
}

/** The key in a thumbnail's address. */
async function thumbKey(image: Locator): Promise<string> {
	const src = await image.getAttribute('src');
	const key = /^\/photos\/([0-9a-f]{32})-thumb\.jpg$/.exec(src ?? '')?.[1];
	if (!key) throw new Error(`Not a thumbnail address: ${src}`);
	return key;
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

/** The size of the stored image, as the browser reads it. */
function storedSize(page: Page, key: string): Promise<{ width: number; height: number }> {
	return page.evaluate(async (url) => {
		const bitmap = await createImageBitmap(await (await fetch(url)).blob());
		return { width: bitmap.width, height: bitmap.height };
	}, `/photos/${key}.jpg`);
}

/** Waits for the sheet to show a new image, resized on the phone, before it's saved. */
async function expectPreview(page: Page) {
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	await expect(page.getByText('Getting the image ready…')).toHaveCount(0);
}

/** Checks a thumbnail has loaded at its size, left of the item's name and level with it. */
async function expectBeside(image: Locator, name: Locator, size: number) {
	expect(await loadedWidth(image)).toBe(400);
	const picture = await image.boundingBox();
	const text = await name.boundingBox();
	if (!picture || !text) throw new Error('Not shown');
	expect(picture).toMatchObject({ width: size, height: size });
	expect(picture.x + picture.width).toBeLessThan(text.x);
	expect(text.y + text.height / 2).toBeGreaterThan(picture.y);
	expect(text.y + text.height / 2).toBeLessThan(picture.y + picture.height);
}

/**
 * Answers Get image as the server does for a link to this image, once `held` settles, and gives
 * the links asked for. The server only fetches public addresses (design 4.5), which these tests
 * don't have. SvelteKit sends an action's data as devalue writes it: a list of every value, where
 * an object holds the places of its values, and bytes are their buffer in base64.
 */
async function answerImage(page: Page, image: Buffer, held?: Promise<void>): Promise<string[]> {
	const asked: string[] = [];
	const data = [
		{ action: 1, image: 2 },
		'image',
		['Uint8Array', 3],
		['ArrayBuffer', image.toString('base64')]
	];
	await page.route(
		(url) => url.pathname === '/groceries/items' && url.search === '?/image',
		async (route) => {
			asked.push(new URLSearchParams(route.request().postData() ?? '').get('link') ?? '');
			await held;
			await route.fulfill({ json: { type: 'success', status: 200, data: JSON.stringify(data) } });
		}
	);
	return asked;
}

test('adds an image from the device and shows it beside the item throughout Groceries', async ({
	page,
	db,
	person
}) => {
	const walmart = addStore(db, person.householdId, 'Walmart');
	const milk = addItem(db, person.householdId, 'Milk', { defaultStoreId: walmart });
	const eggs = addItem(db, person.householdId, 'Eggs', { defaultStoreId: walmart });
	addLine(db, person.householdId, milk, walmart);
	addLine(db, person.householdId, eggs, walmart);

	await open(page, '/groceries/items');
	await itemRow(page, 'Milk').click();
	await expect(imageGroup(page).locator('img')).toHaveCount(0);
	await expect(imageGroup(page).getByRole('button', { name: 'Remove image' })).toHaveCount(0);
	const photo = await makeJpeg(page, { width: 2000, height: 1500 });
	await expect(imageGroup(page).getByRole('button', { name: 'Add image' })).toBeVisible();
	await imageFile(page).setInputFiles({ name: 'milk.jpg', mimeType: 'image/jpeg', buffer: photo });
	await expectPreview(page);
	await expect(imageGroup(page).getByRole('button', { name: 'Change image' })).toBeVisible();
	// Nothing changes until Save.
	expect(imageKey(db, milk)).toBeNull();
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);

	// Resized on the phone, as a recipe's photo is.
	const thumb = itemRow(page, 'Milk').locator('img');
	const key = await thumbKey(thumb);
	expect(imageKey(db, milk)).toBe(key);
	expect(await storedSize(page, key)).toEqual({ width: 1600, height: 1200 });
	await expectBeside(thumb, itemRow(page, 'Milk').getByText('Milk', { exact: true }), 48);
	// An item without an image shows as it always has.
	await expect(itemRow(page, 'Eggs').locator('img')).toHaveCount(0);

	// On the list, in the add bar's suggestions and in History.
	const src = `/photos/${key}-thumb.jpg`;
	await page.goto('/groceries');
	const line = page.getByRole('button', { name: /^Milk/ });
	await expectBeside(line.locator('img'), line.getByText('Milk', { exact: true }), 40);
	await expect(page.getByRole('button', { name: /^Eggs/ }).locator('img')).toHaveCount(0);
	const item = page.getByRole('combobox', { name: 'Item' });
	await item.fill('m');
	await expect(page.getByRole('option', { name: 'Milk' }).locator('img')).toHaveAttribute(
		'src',
		src
	);
	await item.fill('e');
	await expect(page.getByRole('option', { name: 'Eggs' }).locator('img')).toHaveCount(0);
	await item.fill('');
	await page.getByRole('button', { name: 'Mark received: Milk' }).click();
	await expect(page.getByRole('button', { name: 'Undo received: Milk' })).toBeVisible();
	await page.goto('/groceries/history');
	const received = page.getByRole('listitem').filter({ hasText: 'Milk' });
	await expectBeside(received.locator('img'), received.getByText('Milk', { exact: true }), 40);
});

test('replaces and removes an image, and a failed save keeps it', async ({ page, db, person }) => {
	const milk = addItem(db, person.householdId, 'Milk');
	addItem(db, person.householdId, 'Eggs');
	const first = await giveImage(page, db, milk);
	await open(page, '/groceries/items');
	const thumb = itemRow(page, 'Milk').locator('img');
	await expect(thumb).toHaveAttribute('src', `/photos/${first}-thumb.jpg`);
	const png = await makePng(page, { width: 900, height: 900, hue: 200 });
	const pickPng = async () => {
		await expect(imageGroup(page).getByRole('button', { name: 'Change image' })).toBeVisible();
		await imageFile(page).setInputFiles({ name: 'milk.png', mimeType: 'image/png', buffer: png });
		await expectPreview(page);
	};

	// A picked image that isn't saved doesn't come back.
	await itemRow(page, 'Milk').click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute(
		'src',
		`/photos/${first}-thumb.jpg`
	);
	await pickPng();
	await sheet(page).getByRole('button', { name: 'Close' }).click();
	await itemRow(page, 'Milk').click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute(
		'src',
		`/photos/${first}-thumb.jpg`
	);

	// A save that fails changes nothing, and keeps what was picked and typed for another try.
	await pickPng();
	await sheet(page).getByLabel('Name').fill('eggs');
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page).getByRole('alert')).toHaveText('An item is already called eggs.');
	expect(imageKey(db, milk)).toBe(first);
	await expectPreview(page);
	await expect(sheet(page).getByLabel('Name')).toHaveValue('eggs');

	// Saved with the right name, the PNG replaces the image, and the old files go.
	await sheet(page).getByLabel('Name').fill('Milk');
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	await expect(thumb).not.toHaveAttribute('src', `/photos/${first}-thumb.jpg`);
	const second = await thumbKey(thumb);
	expect(imageKey(db, milk)).toBe(second);
	expect(await storedSize(page, second)).toEqual({ width: 900, height: 900 });
	expect(existsSync(photoFile(first, 'full'))).toBe(false);
	expect(existsSync(photoFile(first, 'thumb'))).toBe(false);

	// Remove asks nothing, and Keep the old image takes it back before saving.
	await itemRow(page, 'Milk').click();
	await imageGroup(page).getByRole('button', { name: 'Remove image' }).click();
	await expect(imageGroup(page).locator('img')).toHaveCount(0);
	await expect(imageGroup(page)).toContainText('The image is removed when you save.');
	await imageGroup(page).getByRole('button', { name: 'Keep the old image' }).click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute(
		'src',
		`/photos/${second}-thumb.jpg`
	);
	await imageGroup(page).getByRole('button', { name: 'Remove image' }).click();
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	await expect(thumb).toHaveCount(0);
	expect(imageKey(db, milk)).toBeNull();
	expect(existsSync(photoFile(second, 'full'))).toBe(false);
	expect(existsSync(photoFile(second, 'thumb'))).toBe(false);
});

test("gets an image from a link, and keeps the old one when a link can't be used", async ({
	page,
	db,
	person
}) => {
	const milk = addItem(db, person.householdId, 'Milk');
	const first = await giveImage(page, db, milk);
	await open(page, '/groceries/items');
	await itemRow(page, 'Milk').click();
	const link = sheet(page).getByLabel('Image link');
	const getImage = sheet(page).getByRole('button', { name: 'Get image' });

	// The server only fetches public addresses (design 4.5), and this one is its own.
	await link.fill('http://localhost:4173/favicon.svg');
	await getImage.click();
	await expect(imageGroup(page).getByRole('alert')).toHaveText(NO_IMAGE);
	await expect(link).toHaveValue('http://localhost:4173/favicon.svg');
	await expect(imageGroup(page).locator('img')).toHaveAttribute(
		'src',
		`/photos/${first}-thumb.jpg`
	);
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	expect(imageKey(db, milk)).toBe(first);

	// A link the server can get. A smaller image keeps its size.
	const asked = await answerImage(page, await makePng(page, { width: 1000, height: 500 }));
	await itemRow(page, 'Milk').click();
	await link.fill('https://shop.example/milk.png');
	await getImage.click();
	await expectPreview(page);
	await expect(link).toHaveValue('');
	expect(asked).toEqual(['https://shop.example/milk.png']);
	expect(imageKey(db, milk)).toBe(first);
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	const thumb = itemRow(page, 'Milk').locator('img');
	await expect(thumb).not.toHaveAttribute('src', `/photos/${first}-thumb.jpg`);
	const second = await thumbKey(thumb);
	expect(imageKey(db, milk)).toBe(second);
	expect(await storedSize(page, second)).toEqual({ width: 1000, height: 500 });
	expect(existsSync(photoFile(first, 'full'))).toBe(false);
});

test('drops an image still on its way when its sheet closes', async ({ page, db, person }) => {
	const milk = addItem(db, person.householdId, 'Milk');
	const eggs = addItem(db, person.householdId, 'Eggs');
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await answerImage(page, await makePng(page, { width: 600, height: 600 }), held);
	await open(page, '/groceries/items');
	await itemRow(page, 'Milk').click();
	await sheet(page).getByLabel('Image link').fill('https://shop.example/milk.png');
	await sheet(page).getByRole('button', { name: 'Get image' }).click();
	await expect(imageGroup(page)).toContainText('Getting the image ready…');
	await sheet(page).getByRole('button', { name: 'Close' }).click();

	// Milk's image arrives once Eggs' sheet is open, and goes on neither.
	await itemRow(page, 'Eggs').click();
	const answered = page.waitForResponse((response) => response.url().endsWith('?/image'));
	release();
	await answered;
	// Time to resize it, had it been kept.
	await page.waitForTimeout(500);
	await expect(imageGroup(page).locator('img')).toHaveCount(0);
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	expect(imageKey(db, eggs)).toBeNull();
	expect(imageKey(db, milk)).toBeNull();
});

test('keeps the image of an archived item, and shows it once restored', async ({
	page,
	db,
	person
}) => {
	const milk = addItem(db, person.householdId, 'Milk');
	const key = await giveImage(page, db, milk);
	await open(page, '/groceries/items');
	await itemRow(page, 'Milk').click();
	await sheet(page).getByRole('button', { name: 'Archive' }).click();
	await sheet(page).last().getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByText('No items.')).toBeVisible();

	await page.getByRole('link', { name: 'Show archived items' }).click();
	const thumb = itemRow(page, 'Milk').locator('img');
	await expect(thumb).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
	expect(await loadedWidth(thumb)).toBe(400);
	await itemRow(page, 'Milk').click();
	await expect(imageGroup(page).locator('img')).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
	await sheet(page).getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();
	await expect(thumb).toHaveAttribute('src', `/photos/${key}-thumb.jpg`);
	expect(imageKey(db, milk)).toBe(key);
});

test('gives a new item with a standard name a copy of its standard image', async ({
	page,
	db,
	person
}) => {
	await open(page, '/groceries');
	const add = page.getByRole('form', { name: 'Add to the list' });
	for (const name of ['bananas', 'Dragon fruit']) {
		await add.getByRole('combobox', { name: 'Item' }).fill(name);
		await add.getByRole('button', { name: 'Add' }).click();
		await expect(itemRow(page, name)).toBeVisible();
	}

	// Matched ignoring case, and shown like any image (design 6.14).
	const thumb = itemRow(page, 'bananas').locator('img');
	const key = await thumbKey(thumb);
	expect(await loadedWidth(thumb)).toBe(400);
	await expect(itemRow(page, 'Dragon fruit').locator('img')).toHaveCount(0);
	const bananas = db
		.prepare('select id from items where household_id = ? and name = ?')
		.pluck()
		.get(person.householdId, 'bananas') as number;
	expect(imageKey(db, bananas)).toBe(key);

	// It's the household's own, removed on Items like any other.
	await open(page, '/groceries/items');
	await itemRow(page, 'bananas').click();
	await imageGroup(page).getByRole('button', { name: 'Remove image' }).click();
	await sheet(page).getByRole('button', { name: 'Save' }).click();
	await expect(sheet(page)).toHaveCount(0);
	await expect(itemRow(page, 'bananas').locator('img')).toHaveCount(0);
	expect(imageKey(db, bananas)).toBeNull();
	expect(existsSync(photoFile(key, 'full'))).toBe(false);
});

test.describe('on a computer', () => {
	test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

	test('shows each image beside its item', async ({ page, db, person }) => {
		const walmart = addStore(db, person.householdId, 'Walmart');
		const milk = addItem(db, person.householdId, 'Milk', { defaultStoreId: walmart });
		addLine(db, person.householdId, milk, walmart);
		await giveImage(page, db, milk);

		await open(page, '/groceries');
		const line = page.getByRole('button', { name: /^Milk/ });
		await expectBeside(line.locator('img'), line.getByText('Milk', { exact: true }), 40);
		await page.getByRole('combobox', { name: 'Item' }).fill('m');
		const suggested = page.getByRole('option', { name: 'Milk' }).locator('img');
		expect(await loadedWidth(suggested)).toBe(400);
		expect(await suggested.boundingBox()).toMatchObject({ width: 32, height: 32 });

		await open(page, '/groceries/items');
		const row = itemRow(page, 'Milk');
		await expectBeside(row.locator('img'), row.getByText('Milk', { exact: true }), 48);
		await row.click();
		const preview = imageGroup(page).locator('img');
		expect(await loadedWidth(preview)).toBe(400);
		expect(await preview.boundingBox()).toMatchObject({ width: 96, height: 96 });
	});
});

test('rejects a sign-in callback that did not start here', async ({ page }) => {
	await page.goto('/login/google/callback?code=abc&state=forged');
	// Back on the sign-in page, which says so (6.1).
	await expect(page).toHaveURL(/\/login\?error=cancelled$/);
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
