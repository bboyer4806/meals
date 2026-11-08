import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDish } from '#lib/server/data/dishes.ts';
import {
	freshDb,
	ingredient,
	makeDish,
	makeHousehold,
	recipe,
	servePages
} from '#lib/server/testing.ts';
import { actions } from './+page.server.ts';

// Import from a link on Edit recipe (design 7; MEA-264). Reading the page is the same as on New
// recipe, whose tests cover it (recipes/new/page.server.spec.ts).

const LINK = 'https://recipes.example/toast';

let householdId: number;
let userId: number;
let dishId: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	dishId = makeDish(
		householdId,
		recipe('Toast', {
			servings: 2,
			steps: 'Toast the bread.',
			notes: 'Day-old bread toasts best.',
			ingredients: [ingredient('Bread', 2, 'slice')]
		})
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Imports the link into the recipe's editor as the household's member, or as nobody. */
function importLink(id: number, link: string, as: 'member' | 'nobody' = 'member') {
	const form = new FormData();
	form.set('link', link);
	const request = new Request(`http://localhost/recipes/${id}/edit?/import`, {
		method: 'POST',
		body: form
	});
	const member = { id: userId, householdId, email: 'pat@example.com', name: 'Pat', isAdmin: false };
	const event = {
		locals: { user: as === 'member' ? member : null },
		params: { id: String(id) },
		request
	};
	return actions.import(event as unknown as Parameters<typeof actions.import>[0]);
}

/** A page whose only JSON-LD is this. */
function pageWith(jsonLd: object): string {
	const script = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
	return `<!doctype html><html><head>${script}</head><body></body></html>`;
}

const CINNAMON_TOAST = {
	'@type': 'Recipe',
	name: 'Cinnamon toast',
	cookTime: 'PT3M',
	recipeIngredient: ['2 slices bread', '1 tbsp butter, softened'],
	recipeInstructions: 'Toast the bread.\nSpread the butter.'
};

describe('the import action', () => {
	it('gives each field the page has, null for the rest, and the link as its source', async () => {
		servePages({ [LINK]: { status: 200, body: pageWith(CINNAMON_TOAST) } });
		expect(await importLink(dishId, ` ${LINK} `)).toEqual({
			action: 'import',
			values: {
				name: 'Cinnamon toast',
				servings: null,
				prepMinutes: null,
				cookMinutes: '3',
				steps: 'Toast the bread.\nSpread the butter.',
				source: LINK,
				calories: null,
				proteinG: null,
				carbsG: null,
				fatG: null,
				rows: [
					{ kind: 'ingredient', amount: '2', unit: 'slices', item: 'bread', prepNote: '' },
					{ kind: 'ingredient', amount: '1', unit: 'tbsp', item: 'butter', prepNote: 'softened' }
				]
			},
			leftOut: []
		});
	});

	it('saves nothing', async () => {
		const before = getDish(householdId, dishId);
		servePages({ [LINK]: { status: 200, body: pageWith(CINNAMON_TOAST) } });
		await importLink(dishId, LINK);
		expect(getDish(householdId, dishId)).toEqual(before);
	});

	it('says why a page has nothing to import', async () => {
		servePages({ [LINK]: { status: 200, body: pageWith({ '@type': 'WebSite' }) } });
		expect(await importLink(dishId, LINK)).toMatchObject({
			status: 400,
			data: { action: 'import', error: "Couldn't find a recipe on that page." }
		});
	});

	it("is not found for another household's recipe, and fetches nothing", async () => {
		const other = makeHousehold();
		const theirs = makeDish(other.householdId, recipe('Their toast'));
		const requested = servePages({ [LINK]: { status: 200, body: pageWith(CINNAMON_TOAST) } });
		const result = await importLink(theirs, LINK).catch((e: unknown) => e);
		expect(isHttpError(result, 404)).toBe(true);
		expect(requested).toEqual([]);
	});

	it('needs a signed-in member of a household', async () => {
		const result = await importLink(dishId, LINK, 'nobody').catch((e: unknown) => e);
		expect(isRedirect(result) && result.location).toBe('/login');
	});
});
