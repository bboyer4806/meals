import { readFileSync } from 'node:fs';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDishes } from '#lib/server/data/dishes.ts';
import { getHousehold, updateHousehold } from '#lib/server/data/households.ts';
import { listPickerItems } from '#lib/server/data/items.ts';
import { newRecipeValues } from '#lib/server/recipe-form.ts';
import { freshDb, makeHousehold, servePages } from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

const LINK = 'https://www.kingarthurbaking.com/recipes/spiced-rye-ginger-cookies-recipe';
// The page's head, as saved from King Arthur Baking.
const PAGE = readFileSync('src/lib/test-pages/kingarthurbaking.html', 'utf8');

const NOT_OPENED = "Couldn't open that page. Check the link and try again.";

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
			}
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
			item: '(212g) medium rye flour',
			prepNote: ''
		});
	});

	it('saves nothing', async () => {
		servePages({ [LINK]: { status: 200, body: PAGE } });
		await importLink(LINK);
		const filter = { search: '', tag: null, archived: false, sort: 'name' } as const;
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
			}
		});
	});

	it('says when the page has no recipe', async () => {
		const blog = pageWith({ '@type': 'WebSite', name: 'A food blog' });
		servePages({ 'https://recipes.example/': { status: 200, body: blog } });
		expect(await importLink('https://recipes.example/')).toMatchObject({
			status: 400,
			data: { action: 'import', error: "Couldn't find a recipe on that page." }
		});
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
