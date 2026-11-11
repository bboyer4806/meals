import { error, redirect } from '@sveltejs/kit';
import { requireAdmin, requireAdminAfterSignIn } from '#lib/server/auth/guards.ts';
import {
	allowConnection,
	ASSISTANT_ORIGINS,
	denyConnection,
	PLATFORM_NAMES,
	readAuthorizationRequest,
	type AuthorizationRequest
} from '#lib/server/auth/oauth.ts';

// Where ChatGPT or Claude asks the admin to allow it (RFC 6749, design 6.17). Only the admin,
// signed in with Google, can answer. A request from an assistant Meals doesn't know gets an error
// page here, since there's nowhere safe to send it back to.

const INVALID = "This connection request isn't valid. Start connecting again from ChatGPT or Claude.";

export function load({ locals, url }) {
	const read = readAuthorizationRequest(url.searchParams, url.origin);
	if (read.kind === 'invalid') error(400, INVALID);
	if (read.kind === 'refused') redirect(303, read.redirectTo, { external: ASSISTANT_ORIGINS });
	requireAdminAfterSignIn(locals, url);
	return {
		platform: PLATFORM_NAMES[read.request.platform],
		// Sent again by Allow and Deny, which read the request from the form.
		params: [...url.searchParams]
	};
}

/** The request the page showed, as its Allow or Deny button sends it back. */
async function shownRequest(request: Request, origin: string): Promise<AuthorizationRequest> {
	const read = readAuthorizationRequest(await request.formData(), origin);
	if (read.kind !== 'valid') error(400, INVALID);
	return read.request;
}

export const actions = {
	allow: async ({ locals, request, url }) => {
		const user = requireAdmin(locals);
		const shown = await shownRequest(request, url.origin);
		const back = allowConnection(shown, user.id, url.origin, Date.now());
		redirect(303, back, { external: ASSISTANT_ORIGINS });
	},

	deny: async ({ locals, request, url }) => {
		requireAdmin(locals);
		const shown = await shownRequest(request, url.origin);
		redirect(303, denyConnection(shown, url.origin), { external: ASSISTANT_ORIGINS });
	}
};
