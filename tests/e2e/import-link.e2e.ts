import type { Dialog, Page } from '@playwright/test';
import type { RecipeFormValues } from '#lib/server/recipe-form.ts';
import { addRecipe, expect, makeJpeg, open, test } from './fixtures.ts';

// Import from a link (design 7) on New recipe. The server fetches the page, and refuses
// addresses on its own computer (design 4.5), which are the only ones these tests have. So
// they import the app's own address to see what a page that can't be opened does, and answer
// Import themselves to see what a page with a recipe does.

const link = (page: Page) => page.getByLabel('Link', { exact: true });
const importButton = (page: Page) => page.getByRole('button', { name: 'Import', exact: true });
const name = (page: Page) => page.getByLabel('Name', { exact: true });
const ingredient = (page: Page, number: number) =>
	page.getByRole('group', { name: `Ingredient ${number}`, exact: true });
const amount = (page: Page, number: number) =>
	ingredient(page, number).getByLabel('Amount', { exact: true });
const item = (page: Page, number: number) =>
	ingredient(page, number).getByRole('combobox', { name: 'Item', exact: true });

const FILLED = 'Filled in from the page. Check it, then tap Save.';
const REPLACE = "Replace what you typed with the page's recipe? The photo, tags and notes stay.";
const LEAVE = 'Leave without saving? What you typed will be lost.';

// What the server fills the editor in with from a page with this recipe.
const toast: RecipeFormValues = {
	name: 'Cinnamon toast',
	servings: '2',
	prepMinutes: '5',
	cookMinutes: '3',
	tags: '',
	steps: 'Toast the bread.\nSpread the butter.\nSprinkle with cinnamon sugar.',
	notes: '',
	source: 'https://recipes.example/cinnamon-toast',
	calories: '210',
	proteinG: '4',
	carbsG: '30',
	fatG: '9',
	rows: [
		{ kind: 'ingredient', amount: '2', unit: 'slices', item: 'Bread', prepNote: '' },
		{ kind: 'ingredient', amount: '1', unit: 'tbsp', item: 'Butter', prepNote: 'softened' }
	]
};

/**
 * Answers Import as the server does for a page with this recipe. SvelteKit sends an action's
 * data as devalue writes it: a list of every value, where objects and lists hold the places of
 * what's in them.
 */
async function answerImport(page: Page, values: RecipeFormValues) {
	const flat: unknown[] = [];
	const place = (value: unknown): number => {
		const index = flat.push(null) - 1;
		flat[index] = Array.isArray(value)
			? value.map(place)
			: typeof value === 'object' && value !== null
				? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, place(inner)]))
				: value;
		return index;
	};
	place({ action: 'import', values });
	await page.route(
		(url) => url.pathname === '/recipes/new' && url.search === '?/import',
		(route) =>
			route.fulfill({ json: { type: 'success', status: 200, data: JSON.stringify(flat) } })
	);
}

/** Collects the questions the page asks, answering each with Cancel. */
function stayOnEachQuestion(page: Page): { questions: string[]; stop: () => void } {
	const questions: string[] = [];
	const stay = (dialog: Dialog) => {
		questions.push(dialog.message());
		void dialog.dismiss();
	};
	page.on('dialog', stay);
	return { questions, stop: () => page.off('dialog', stay) };
}

test('puts the Link field and Import above the editor', async ({ page, person: _signedIn }) => {
	await open(page, '/recipes/new');
	await expect(link(page)).toHaveAttribute('type', 'url');
	await expect(link(page)).toHaveAccessibleDescription(
		"Paste a recipe's web address to fill in the recipe below."
	);
	const field = (await link(page).boundingBox())!;
	const button = (await importButton(page).boundingBox())!;
	const name = (await page.getByLabel('Name', { exact: true }).boundingBox())!;
	// Side by side, on one line of a phone's screen.
	expect(button.x).toBeGreaterThan(field.x + field.width - 1);
	expect(button.y).toBeLessThan(field.y + field.height);
	expect(Math.max(field.y + field.height, button.y + button.height)).toBeLessThan(name.y);
});

test("says when a page can't be imported, keeping the link and the editor as they were", async ({
	page,
	baseURL,
	person: _signedIn
}) => {
	await open(page, '/recipes/new');
	await page.getByLabel('Name', { exact: true }).fill('Pie');
	await page.getByLabel('Steps').fill('Bake.');

	const ownAddress = `${baseURL}/recipes`;
	await link(page).fill(ownAddress);
	await importButton(page).click();
	await expect(page.getByRole('alert')).toHaveText(
		"Couldn't open that page. Check the link and try again."
	);
	await expect(link(page)).toHaveValue(ownAddress);
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Pie');
	await expect(page.getByLabel('Steps')).toHaveValue('Bake.');
	await expect(page.getByLabel('Source')).toHaveValue('');

	// The browser takes any address, and the server only http and https ones.
	await link(page).fill('ftp://recipes.example/pie');
	await link(page).press('Enter');
	await expect(page.getByRole('alert')).toHaveText(
		'Enter a link that starts with http:// or https://'
	);
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Pie');
});

test('fills in an untouched recipe without asking, and asks before leaving it unsaved', async ({
	page,
	person: _signedIn
}) => {
	await answerImport(page, toast);
	const { questions } = stayOnEachQuestion(page);
	await open(page, '/recipes/new');
	await link(page).fill(toast.source);
	await importButton(page).click();
	await expect(page.getByText(FILLED)).toBeVisible();
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(page.getByLabel('Servings')).toHaveValue('2');
	await expect(page.getByLabel('Steps')).toHaveValue(toast.steps);
	await expect(page.getByLabel('Source')).toHaveValue(toast.source);
	await expect(item(page, 1)).toHaveValue('Bread');
	await expect(item(page, 2)).toHaveValue('Butter');
	expect(questions).toEqual([]);

	// Checking something on Groceries before Save would lose it, so it asks, and staying keeps
	// the recipe and the link.
	await page.getByRole('navigation', { name: 'Main' }).getByText('Groceries').click();
	await expect.poll(() => questions).toEqual([LEAVE]);
	await expect(page).toHaveURL(/\/recipes\/new$/);
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(link(page)).toHaveValue(toast.source);

	// Saving doesn't ask.
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('heading', { name: 'Cinnamon toast', level: 1 })).toBeVisible();
	expect(questions).toEqual([LEAVE]);
});

test('keeps the photo, tags and notes, and asks before replacing anything else typed', async ({
	page,
	person: _signedIn
}) => {
	await answerImport(page, toast);
	const jpeg = await makeJpeg(page, { width: 800, height: 600 });
	const { questions, stop } = stayOnEachQuestion(page);
	const preview = page.getByRole('group', { name: 'Photo' }).locator('img');
	const tags = page.getByLabel('Tags', { exact: true });
	const notes = page.getByLabel('Notes', { exact: true });
	async function expectKept() {
		await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
		await expect(tags).toHaveValue('Breakfast');
		await expect(notes).toHaveValue('Day-old bread toasts best.');
	}

	await open(page, '/recipes/new');
	await page.getByRole('main').locator('input[type="file"]').setInputFiles({
		name: 'toast.jpg',
		mimeType: 'image/jpeg',
		buffer: jpeg
	});
	await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
	await tags.fill('Breakfast');
	await notes.fill('Day-old bread toasts best.');

	// Import leaves those as they are, so it has nothing to ask.
	await link(page).fill(toast.source);
	await importButton(page).click();
	await expect(page.getByText(FILLED)).toBeVisible();
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(amount(page, 1)).toHaveValue('2');
	await expectKept();
	expect(questions).toEqual([]);

	// Fixed after the import, so importing again asks first, and Cancel changes nothing.
	await name(page).fill('Cinnamon sugar toast');
	await amount(page, 1).fill('3');
	await importButton(page).click();
	await expect.poll(() => questions).toEqual([REPLACE]);
	await expect(importButton(page)).toBeEnabled();
	await expect(name(page)).toHaveValue('Cinnamon sugar toast');
	await expect(amount(page, 1)).toHaveValue('3');
	await expectKept();

	// OK replaces them with the page's recipe, and the photo, tags and notes still stay.
	stop();
	page.once('dialog', (dialog) => {
		questions.push(dialog.message());
		void dialog.accept();
	});
	await importButton(page).click();
	await expect.poll(() => questions).toEqual([REPLACE, REPLACE]);
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(amount(page, 1)).toHaveValue('2');
	await expectKept();
});

test("drops a failed save's message once an import replaces the recipe", async ({
	page,
	db,
	person
}) => {
	addRecipe(db, person.householdId, { name: 'Pie' });
	await answerImport(page, toast);
	await open(page, '/recipes/new');
	await name(page).fill('Pie');
	await page.getByRole('button', { name: 'Save' }).click();
	const problem = page.getByRole('alert');
	await expect(problem).toHaveText('A recipe is already called Pie.');

	page.once('dialog', (dialog) => {
		expect(dialog.message()).toBe(REPLACE);
		void dialog.accept();
	});
	await link(page).fill(toast.source);
	await importButton(page).click();
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(problem).toHaveCount(0);
});

test("drops a failed save's problems beside the fields once an import replaces the recipe", async ({
	page,
	person: _signedIn
}) => {
	await answerImport(page, toast);
	await open(page, '/recipes/new');
	await name(page).fill(' ');
	await amount(page, 1).fill('lots');
	await item(page, 1).fill('Apples');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(name(page)).toHaveAccessibleDescription('Enter a recipe name');
	await expect(amount(page, 1)).toHaveAccessibleDescription(
		'Ingredient 1: enter an amount like 1 1/2'
	);

	page.once('dialog', (dialog) => {
		expect(dialog.message()).toBe(REPLACE);
		void dialog.accept();
	});
	await link(page).fill(toast.source);
	await importButton(page).click();
	await expect(name(page)).toHaveValue('Cinnamon toast');
	await expect(amount(page, 1)).toHaveValue('2');
	await expect(page.locator('[aria-invalid]')).toHaveCount(0);
	await expect(page.locator('.field-problem')).toHaveCount(0);
});
