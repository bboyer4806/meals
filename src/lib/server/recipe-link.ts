import { fail, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import { findRecipe, schemaRecipeValues, type PageRecipe } from '../recipe-schema.ts';
import { parseForm, type FormFailure } from './forms.ts';
import { fetchPage, jsonLdBlocks } from './recipe-page.ts';

// Import from a link (design 7), above New recipe's editor and Edit recipe's (MEA-264): the link
// sent, and the recipe on its page. The link becomes the recipe's source, so it has the source's
// limit.

const importForm = z.object({
	link: z
		.string()
		.trim()
		.max(500, 'Keep the link under 500 characters')
		.pipe(
			z.url({ protocol: /^https?$/, error: 'Enter a link that starts with http:// or https://' })
		)
});

/** The name of the import action, on both editors' routes. */
export const IMPORT_ACTION = 'import';
const NOT_OPENED = "Couldn't open that page. Check the link and try again.";
const NO_RECIPE = "Couldn't find a recipe on that page.";

function failure(error: string): { failure: ActionFailure<FormFailure> } {
	return { failure: fail(400, { action: IMPORT_ACTION, error }) };
}

/**
 * Reads the link in the form, fetches its page (design 4.5) and reads the recipe on it, saving
 * nothing. A link that isn't an http or https one, a page that can't be opened, and a page without
 * a recipe, or whose reading fails, are each a failure with the message the editor shows.
 */
export async function importLink(
	formData: FormData
): Promise<{ link: string; recipe: PageRecipe } | { failure: ActionFailure<FormFailure> }> {
	const parsed = parseForm(importForm, formData, IMPORT_ACTION);
	if ('failure' in parsed) return parsed;
	const { link } = parsed.data;
	let html: string;
	try {
		html = await fetchPage(new URL(link));
	} catch (e) {
		console.error(`Couldn't open ${link} to import it:`, e);
		return failure(NOT_OPENED);
	}
	try {
		const recipe = findRecipe(jsonLdBlocks(html));
		if (!recipe) return failure(NO_RECIPE);
		return { link, recipe: schemaRecipeValues(recipe) };
	} catch (e) {
		// A page broken in a way reading it didn't expect (MEA-84).
		console.error(`Couldn't read the recipe on ${link}:`, e);
		return failure(NO_RECIPE);
	}
}
