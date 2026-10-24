import { requireHousehold } from '#lib/server/auth/guards.ts';
import { templateCsv } from '#lib/server/recipe-import.ts';

// Download template on Import recipes: a CSV file with just the header row (design 7).
export function GET({ locals }) {
	requireHousehold(locals);
	return new Response(templateCsv(), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="recipes.csv"'
		}
	});
}
