import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaRecipeValues } from '#lib/recipe-schema.ts';
import { listDishes } from '#lib/server/data/dishes.ts';
import { getHousehold, updateHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { newRecipeValues } from '#lib/server/recipe-form.ts';
import { freshDb, makeHousehold, servePages } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

// The real function, which a test can make fail once.
vi.mock('#lib/recipe-schema.ts', async (importOriginal) => {
	const schema = await importOriginal<typeof import('#lib/recipe-schema.ts')>();
	return { ...schema, schemaRecipeValues: vi.fn(schema.schemaRecipeValues) };
});

const LINK = 'https://www.kingarthurbaking.com/recipes/spiced-rye-ginger-cookies-recipe';
// The page's head, as saved from King Arthur Baking.
const PAGE = readFileSync('src/lib/test-pages/kingarthurbaking.html', 'utf8');

const NOT_OPENED = "Couldn't open that page. Check the link and try again.";
const NO_RECIPE = "Couldn't find a recipe on that page.";

let householdId: number;
let userId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Imports from the link as the household's member, or as nobody, giving the action's result. */
function importLink(link: string, as: 'member' | 'nobody' = 'member') {
	const form = new FormData();
	form.set('link', link);
	const request = new Request('http://localhost/recipes/new?/import', {
		method: 'POST',
		body: form
	});
	const member = { id: userId, householdId, email: 'pat@example.com', name: 'Pat', isAdmin: false };
	const event = { locals: { user: as === 'member' ? member : null }, request };
	return actions.import(event as unknown as Parameters<typeof actions.import>[0]);
}

/** A page whose only JSON-LD is this. */
function pageWith(jsonLd: object): string {
	const script = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
	return `<!doctype html><html><head>${script}</head><body></body></html>`;
}

describe('the import action', () => {
	it("fills in the editor from the page's recipe, with the link as its source", async () => {
		servePages({ [LINK]: { status: 200, body: PAGE } });
		const result = await importLink(`  ${LINK} `);
		expect(result).toEqual({
			action: 'import',
			values: {
				name: 'Spiced Rye Ginger Cookies',
				servings: '22',
				prepMinutes: '20',
				cookMinutes: '15',
				tags: '',
				steps: expect.any(String),
				notes: '',
				source: LINK,
				calories: '130',
				proteinG: '2',
				carbsG: '20',
				fatG: '6',
				rows: expect.any(Array)
			},
			leftOut: []
		});
		if (!('values' in result)) throw new Error('Not imported');
		const { steps, rows } = result.values;
		// The page writes its steps as paragraphs.
		expect(steps.split('\n')).toHaveLength(12);
		expect(steps.split('\n')[0]).toBe(
			'Preheat the oven to 325°F. Lightly grease (or line with parchment) two baking sheets.'
		);
		expect(rows).toHaveLength(12);
		// "2 cups (212g) <a href=...>medium rye flour</a>"
		expect(rows[0]).toEqual({
			kind: 'ingredient',
			amount: '2',
			unit: 'cups',
			item: 'medium rye flour',
			prepNote: '212g'
		});
	});

	it('saves nothing', async () => {
		servePages({ [LINK]: { status: 200, body: PAGE } });
		await importLink(LINK);
		const filter = { search: '', tags: [], archived: false, sort: 'name' as const };
		expect(listDishes(householdId, filter)).toEqual([]);
		expect(listPickerItems(householdId)).toEqual([]);
	});

	it("keeps a new recipe's fields where the page has none, like the usual servings", async () => {
		const { name, timeZone } = getHousehold(householdId);
		updateHousehold(householdId, { name, defaultServings: 6, timeZone });
		const toast = {
			'@context': 'https://schema.org',
			'@type': 'Recipe',
			name: 'Toast',
			recipeIngredient: ['1 slice bread'],
			recipeInstructions: 'Toast the bread.'
		};
		servePages({ 'https://recipes.example/toast': { status: 200, body: pageWith(toast) } });
		expect(await importLink('https://recipes.example/toast')).toEqual({
			action: 'import',
			values: {
				...newRecipeValues(6),
				name: 'Toast',
				steps: 'Toast the bread.',
				source: 'https://recipes.example/toast',
				rows: [{ kind: 'ingredient', amount: '1', unit: 'slice', item: 'bread', prepNote: '' }]
			},
			leftOut: []
		});
	});

	it('reads a page in windows-1252 that the server gzips', async () => {
		const brulee = {
			'@type': 'Recipe',
			name: 'Crème brûlée',
			recipeIngredient: ['½ cup sugar'],
			recipeInstructions: 'Bake at 325°F.'
		};
		const link = 'https://recipes.example/brulee';
		servePages({
			[link]: {
				status: 200,
				headers: { 'content-type': 'text/html; charset=windows-1252', 'content-encoding': 'gzip' },
				body: gzipSync(Buffer.from(pageWith(brulee), 'latin1'))
			}
		});
		expect(await importLink(link)).toEqual({
			action: 'import',
			values: {
				...newRecipeValues(4),
				name: 'Crème brûlée',
				steps: 'Bake at 325°F.',
				source: link,
				rows: [{ kind: 'ingredient', amount: '½', unit: 'cup', item: 'sugar', prepNote: '' }]
			},
			leftOut: []
		});
	});

	it('reads JSON-LD that leaves line breaks and tabs raw in its text (MEA-90)', async () => {
		// As a theme writes it when it pastes the recipe's text into its template.
		const script = [
			'<script type="application/ld+json">{',
			'\t"@type": "Recipe",',
			'\t"name": "Apple\tpie",',
			'\t"recipeIngredient": ["6 apples"],',
			'\t"recipeInstructions": "Slice the apples.\nBake for an hour."',
			'}</script>'
		].join('\n');
		const link = 'https://recipes.example/pie';
		servePages({ [link]: { status: 200, body: `<!doctype html><head>${script}</head>` } });
		expect(await importLink(link)).toEqual({
			action: 'import',
			values: {
				...newRecipeValues(4),
				name: 'Apple pie',
				// Each line break still starts a step.
				steps: 'Slice the apples.\nBake for an hour.',
				source: link,
				rows: [{ kind: 'ingredient', amount: '6', unit: '', item: 'apples', prepNote: '' }]
			},
			leftOut: []
		});
	});

	it('says what it left out of a page with more than the editor takes (MEA-84)', async () => {
		const feast = {
			'@type': 'Recipe',
			name: 'Feast',
			recipeIngredient: Array.from({ length: 101 }, (_, at) => `${at + 1} cups flour`),
			recipeInstructions: Array<string>(2_001).fill('Stir.')
		};
		servePages({ 'https://recipes.example/feast': { status: 200, body: pageWith(feast) } });
		const result = await importLink('https://recipes.example/feast');
		expect(result).toMatchObject({ action: 'import', leftOut: ['ingredients', 'steps'] });
		if (!('values' in result)) throw new Error('Not imported');
		expect(result.values.rows).toHaveLength(100);
		// 1,666 steps of 5 characters with a line break between come to 9,995, and one more would
		// pass 10,000.
		expect(result.values.steps.split('\n')).toHaveLength(1_666);
	});

	it('says when the page has no recipe', async () => {
		const blog = pageWith({ '@type': 'WebSite', name: 'A food blog' });
		servePages({ 'https://recipes.example/': { status: 200, body: blog } });
		expect(await importLink('https://recipes.example/')).toMatchObject({
			status: 400,
			data: { action: 'import', error: NO_RECIPE }
		});
	});

	it('says there is no recipe when reading the page fails, and logs why (MEA-84)', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new RangeError('Maximum call stack size exceeded');
		vi.mocked(schemaRecipeValues).mockImplementationOnce(() => {
			throw failure;
		});
		servePages({ [LINK]: { status: 200, body: PAGE } });
		expect(await importLink(LINK)).toMatchObject({
			status: 400,
			data: { action: 'import', error: NO_RECIPE }
		});
		expect(logged).toHaveBeenCalledWith(`Couldn't read the recipe on ${LINK}:`, failure);
	});

	it("says when the page can't be opened", async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		servePages({ [LINK]: { status: 403, body: 'Forbidden' } });
		expect(await importLink(LINK)).toMatchObject({
			status: 400,
			data: { action: 'import', error: NOT_OPENED }
		});
		expect(logged).toHaveBeenCalledWith(`Couldn't open ${LINK} to import it:`, expect.any(Error));
	});

	it('refuses a link to a private address without fetching it', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const requested = servePages({});
		expect(await importLink('http://169.254.169.254/latest/meta-data/')).toMatchObject({
			status: 400,
			data: { action: 'import', error: NOT_OPENED }
		});
		expect(requested).toEqual([]);
	});

	it('asks for an http or https link of 500 characters at most', async () => {
		const requested = servePages({});
		const links = ['', 'recipes.example/pie', 'ftp://recipes.example/pie', 'javascript:alert(1)'];
		for (const link of links) {
			expect(await importLink(link)).toMatchObject({
				status: 400,
				data: { action: 'import', error: 'Enter a link that starts with http:// or https://' }
			});
		}
		expect(await importLink(`https://recipes.example/${'a'.repeat(477)}`)).toMatchObject({
			status: 400,
			data: { action: 'import', error: 'Keep the link under 500 characters' }
		});
		expect(requested).toEqual([]);
	});

	it('needs a signed-in member of a household', async () => {
		const result = await importLink(LINK, 'nobody').catch((e: unknown) => e);
		expect(isRedirect(result) && result.location).toBe('/login');
	});
});
