import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '#lib/server/auth/guards.ts';
import { config } from '#lib/server/config.ts';
import { createHousehold, joinHousehold, setupChoices } from '#lib/server/data/households.ts';
import { assignDefaultDishPhotos } from '#lib/server/default-dish-photos.ts';
import { attempt, householdSettings, id, parseForm } from '#lib/server/forms.ts';
import { assignStandardImages } from '#lib/server/standard-images.ts';

// Someone signed in without a household joins one that invited them, or sets up their own when
// they're the admin or were invited to (design 6.1, MEA-112).

export function load({ locals }) {
	const user = requireUser(locals);
	if (user.householdId !== null) redirect(303, '/');
	return {
		name: user.name,
		email: user.email,
		...setupChoices(user.id, config().ADMIN_EMAIL),
		timeZones: Intl.supportedValuesOf('timeZone')
	};
}

export const actions = {
	join: async ({ locals, request }) => {
		const user = requireUser(locals);
		if (user.householdId !== null) redirect(303, '/');
		const parsed = parseForm(z.object({ id }), await request.formData(), 'join');
		if ('failure' in parsed) return parsed.failure;
		const joined = attempt('join', () => joinHousehold(user.id, parsed.data.id));
		if (typeof joined !== 'number') return joined;
		redirect(303, '/groceries');
	},

	create: async ({ locals, request }) => {
		const user = requireUser(locals);
		if (user.householdId !== null) redirect(303, '/');
		const parsed = parseForm(householdSettings, await request.formData(), 'setup');
		if ('failure' in parsed) return parsed.failure;
		const now = Date.now();
		const householdId = attempt('setup', () =>
			createHousehold(user.id, config().ADMIN_EMAIL, parsed.data, now)
		);
		if (typeof householdId !== 'number') return householdId;
		// Its standard items get their images (design 6.14), and its default dishes their photos
		// (6.19).
		await assignStandardImages(householdId, now);
		await assignDefaultDishPhotos(householdId, now);
		redirect(303, '/groceries');
	}
};
