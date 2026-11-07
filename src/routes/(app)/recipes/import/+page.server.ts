import { fail } from '@sveltejs/kit';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { importRecipeFile, importSummary } from '#lib/server/recipe-import.ts';

export const actions = {
	import: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const result = await importRecipeFile(user.householdId, await request.formData(), Date.now());
		if (result.kind === 'problems') return fail(400, { problems: result.problems });
		if (result.kind === 'duplicates') {
			const { duplicates, problems } = result;
			return problems.length > 0 ? fail(400, { duplicates, problems }) : { duplicates };
		}
		// The import page takes this to Recipes, which says it (design 7, Import recipes).
		return { summary: importSummary(result) };
	}
};
