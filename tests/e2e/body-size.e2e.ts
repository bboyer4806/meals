import { addItem, expect, makeJpeg, open, test } from './fixtures.ts';

// Request bodies over 64 KB are refused before anything reads them, except a photo, an image or a
// file sent to the recipe editor, Items or Import recipes (design 4.5).

const LIMIT = 64 * 1024;
const PADDING = 'x'.repeat(LIMIT);
const REFUSED = { status: 413, message: "That's too much to send at once." };

// The recipe editor's fields, all blank but the name and servings.
const RECIPE = {
	name: 'Pound cake',
	servings: '8',
	prepMinutes: '',
	cookMinutes: '',
	tags: '',
	ingredients: '[]',
	steps: '',
	notes: '',
	source: '',
	calories: '',
	proteinG: '',
	carbsG: '',
	fatG: ''
};

test('refuses a form over 64 KB without reading it', async ({ page, db, person, baseURL }) => {
	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const form = { itemName: 'Flour', quantity: '1', unit: '', store: 'none' };
	const lines = () =>
		db
			.prepare('select count(*) from grocery_needs where household_id = ?')
			.pluck()
			.get(person.householdId);

	const refused = await page.request.post('/groceries?/add', {
		form: { ...form, padding: PADDING },
		headers
	});
	expect(refused.status()).toBe(413);
	expect(await refused.json()).toEqual(REFUSED);
	expect(lines()).toBe(0);

	// The same form under 64 KB goes through.
	const added = await page.request.post('/groceries?/add', { form, headers });
	expect(await added.json()).toMatchObject({ type: 'success' });
	expect(lines()).toBe(1);
});

test('saves a recipe with a photo over 64 KB', async ({ page, db, person, baseURL }) => {
	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const photo = await makeJpeg(page, { width: 3000, height: 2250 });
	const thumb = await makeJpeg(page, { width: 400, height: 300 });
	expect(photo.length).toBeGreaterThan(LIMIT);

	const saved = await page.request.post('/recipes/new?/save', {
		multipart: {
			...RECIPE,
			photo: { name: 'cake.jpg', mimeType: 'image/jpeg', buffer: photo },
			thumb: { name: 'cake-thumb.jpg', mimeType: 'image/jpeg', buffer: thumb }
		},
		headers
	});
	expect(await saved.json()).toMatchObject({ type: 'redirect' });
	expect(
		db
			.prepare('select photo_key from dishes where household_id = ? and name = ?')
			.pluck()
			.get(person.householdId, 'Pound cake')
	).toMatch(/^[0-9a-f]{32}$/);
});

test("saves an item's image over 64 KB", async ({ page, db, person, baseURL }) => {
	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const milk = addItem(db, person.householdId, 'Milk');
	const photo = await makeJpeg(page, { width: 3000, height: 2250 });
	const thumb = await makeJpeg(page, { width: 400, height: 300 });
	expect(photo.length).toBeGreaterThan(LIMIT);

	const saved = await page.request.post('/groceries/items?/update', {
		multipart: {
			id: String(milk),
			name: 'Milk',
			notes: '',
			photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo },
			thumb: { name: 'thumb.jpg', mimeType: 'image/jpeg', buffer: thumb }
		},
		headers
	});
	expect(await saved.json()).toMatchObject({ type: 'success' });
	expect(db.prepare('select photo_key from items where id = ?').pluck().get(milk)).toMatch(
		/^[0-9a-f]{32}$/
	);
});

test('refuses a recipe over 64 KB sent without multipart', async ({
	page,
	db,
	person,
	baseURL
}) => {
	// The editor always sends multipart, and URL-encoded forms are the ones slow to read.
	const headers = { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
	const refused = await page.request.post('/recipes/new?/save', {
		form: { ...RECIPE, padding: PADDING },
		headers
	});
	expect(refused.status()).toBe(413);
	expect(await refused.json()).toEqual(REFUSED);
	expect(
		db.prepare('select count(*) from dishes where household_id = ?').pluck().get(person.householdId)
	).toBe(0);
});

test('imports a file over 64 KB', async ({ page, person: _signedIn }) => {
	const steps = 'Stir the pot. '.repeat(500);
	const rows = Array.from({ length: 10 }, (_, index) => `Stew ${index + 1},${steps}`);
	const csv = ['Recipe,Steps', ...rows].join('\r\n');
	expect(csv.length).toBeGreaterThan(LIMIT);

	await open(page, '/recipes/import');
	await page.getByLabel('CSV file').setInputFiles({
		name: 'recipes.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv)
	});
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page).toHaveURL(/\/recipes$/);
	await expect(page.getByRole('status')).toHaveText('Imported 10 recipes.');
});
