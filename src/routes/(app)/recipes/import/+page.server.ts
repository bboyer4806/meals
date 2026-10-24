import { fail, redirect } from '@sveltejs/kit';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { importRecipeFile } from '#lib/server/recipe-import.ts';

export const actions = {
	import: async ({ locals, request }) => {
		const user = requireHousehold(locals);
		const result = await importRecipeFile(user.householdId, await request.formData(), Date.now());
		if (result.kind === 'problems') return fail(400, { problems: result.problems });
		if (result.kind === 'duplicates') {
			const { duplicates, problems } = result;
			return problems.length > 0 ? fail(400, { duplicates, problems }) : { duplicates };
		}
		// Recipes says what was imported (design 7, Import recipes).
		const params = new URLSearchParams({
			imported: String(result.imported),
			replaced: String(result.replaced),
			skipped: String(result.skipped)
		});
		for (const column of result.ignored) params.append('ignored', column);
		redirect(303, `/recipes?${params}`);
	}
};
