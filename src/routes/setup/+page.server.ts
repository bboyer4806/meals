import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards.ts';
import { createHousehold } from '#lib/server/data/households.ts';
import { householdSettings, parseForm } from '#lib/server/forms.ts';
import { assignStandardImages } from '#lib/server/standard-images.ts';

export function load({ locals }) {
	const user = requireUser(locals);
	if (user.householdId !== null) redirect(303, '/');
	return { name: user.name, timeZones: Intl.supportedValuesOf('timeZone') };
}

export const actions = {
	default: async ({ locals, request }) => {
		const user = requireUser(locals);
		if (user.householdId !== null) redirect(303, '/');
		const parsed = parseForm(householdSettings, await request.formData(), 'setup');
		if ('failure' in parsed) return parsed.failure;
		const now = Date.now();
		const householdId = createHousehold(user.id, parsed.data, now);
		// Its standard items get their images (design 6.14).
		await assignStandardImages(householdId, now);
		redirect(303, '/groceries');
	}
};
