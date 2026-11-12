import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { approveProposal, getProposal, rejectProposal } from '#lib/server/ai/proposals.ts';
import { PLATFORM_NAMES } from '#lib/server/auth/oauth.ts';
import { requireAdmin, requireAdminAfterSignIn } from '#lib/server/auth/guards.ts';
import { attempt, id, parseForm } from '#lib/server/forms.ts';
import { assignStandardImages } from '#lib/server/standard-images.ts';

// The confirmation page an AI assistant links to (design 6.17): every change it proposes, for the
// admin, signed in with Google, to approve or reject together.

function proposalId(params: { id: string }): number {
	const parsed = id.safeParse(params.id);
	if (!parsed.success) error(404, 'Not found');
	return parsed.data;
}

export function load({ locals, params, url }) {
	requireAdminAfterSignIn(locals, url);
	const proposal = getProposal(proposalId(params), Date.now());
	return { proposal, platform: PLATFORM_NAMES[proposal.platform] };
}

// The proposal's content as the page showed it, so only that is approved or rejected.
const decision = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) });

export const actions = {
	approve: async ({ locals, params, request }) => {
		requireAdmin(locals);
		const parsed = parseForm(decision, await request.formData(), 'proposal');
		if ('failure' in parsed) return parsed.failure;
		const now = Date.now();
		const approval = attempt('proposal', () =>
			approveProposal(proposalId(params), parsed.data.hash, now)
		);
		if (!('kind' in approval)) return approval;
		// New items get their standard images, as after any save that adds them (6.14).
		if (approval.kind === 'approved') {
			for (const householdId of approval.householdIds) await assignStandardImages(householdId, now);
		}
		// The page shows what happened, from the proposal's status, failed ones included.
		return { action: 'proposal' };
	},

	reject: async ({ locals, params, request }) => {
		requireAdmin(locals);
		const parsed = parseForm(decision, await request.formData(), 'proposal');
		if ('failure' in parsed) return parsed.failure;
		const rejected = attempt('proposal', () =>
			rejectProposal(proposalId(params), parsed.data.hash, Date.now())
		);
		return rejected ?? { action: 'proposal' };
	}
};
