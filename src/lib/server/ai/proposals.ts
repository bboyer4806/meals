import { createHash } from 'node:crypto';
import { error, isHttpError } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, transaction } from '../db/index.ts';
import { aiConnections, aiProposals, type AiPlatform } from '../db/schema.ts';
import {
	changeSchema,
	planChange,
	type Change,
	type ChangePreview,
	type PlannedChange
} from './operations.ts';

// What an AI assistant proposes, which happens only when the admin approves it on Meals's
// confirmation page (design 6.17). A proposal is saved whole and never changed: approving makes
// exactly its changes, once, all of them or none.

/** How long the admin has to approve or reject a proposal. */
export const PROPOSAL_LIFETIME = 24 * 60 * 60 * 1000;
const MAX_CHANGES = 50;

export const proposalInput = z.object({
	summary: z
		.string()
		.trim()
		.min(1, 'Say what the changes are for')
		.max(500, 'Keep the summary under 500 characters')
		.describe('What the changes are for, in a sentence or two, for the admin'),
	changes: z
		.array(changeSchema)
		.min(1, 'Propose at least one change')
		.max(MAX_CHANGES, `Propose up to ${MAX_CHANGES} changes at a time`)
});

export type ProposalInput = z.output<typeof proposalInput>;

/** What a proposal keeps: its changes, and what the confirmation page shows of each. */
type Content = { summary: string; changes: { change: Change; preview: ChangePreview }[] };

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'expired';

export type Proposal = {
	id: number;
	connectionId: number;
	platform: AiPlatform;
	summary: string;
	changes: ChangePreview[];
	status: ProposalStatus;
	/** Why approving it failed, on a failed proposal. */
	error: string | null;
	createdAt: number;
	expiresAt: number;
	decidedAt: number | null;
	/** What approving or rejecting it sends back, so it's this proposal and no other. */
	hash: string;
};

/** A change that couldn't be made, so none of its proposal's were. */
class ChangeFailed extends Error {}

/** Thrown to undo changes made only to see that they can be (tryChanges). */
class Undo extends Error {
	constructor(readonly previews: ChangePreview[]) {
		super('Undone');
	}
}

/** The SHA-256 of a proposal's content, which approving it must send back. */
function contentHash(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

/** Says which change a refusal from the data layer is about. Anything else is a bug. */
function changeFailed(index: number, change: Change, cause: unknown): unknown {
	if (!isHttpError(cause) || cause.status >= 500) return cause;
	return new ChangeFailed(`Change ${index + 1} (${change.operation}): ${cause.body.message}`);
}

/** Looks every change up in the database as it is before any of them is made. */
function planAll(changes: Change[]): PlannedChange[] {
	return changes.map((change, index) => {
		try {
			return planChange(change);
		} catch (e) {
			throw changeFailed(index, change, e);
		}
	});
}

/** Makes the changes in order, in the transaction the caller runs. */
function applyAll(changes: Change[], planned: PlannedChange[], now: number): void {
	for (const [index, plan] of planned.entries()) {
		try {
			plan.apply(now);
		} catch (e) {
			throw changeFailed(index, changes[index]!, e);
		}
	}
}

function preview({ apply: _, ...shown }: PlannedChange): ChangePreview {
	return shown;
}

/**
 * Makes the changes and undoes them, so a change that can't be made is refused when it's proposed,
 * with why (400). Gives what the confirmation page shows of each.
 */
function tryChanges(changes: Change[], now: number): ChangePreview[] {
	try {
		transaction(() => {
			const planned = planAll(changes);
			applyAll(changes, planned, now);
			throw new Undo(planned.map(preview));
		});
	} catch (e) {
		if (e instanceof Undo) return e.previews;
		if (e instanceof ChangeFailed) error(400, e.message);
		throw e;
	}
	throw new Error('Changes tried without being undone');
}

/** Saves the changes as a proposal for the admin to approve or reject, once they can be made. */
export function proposeChanges(connectionId: number, input: ProposalInput, now: number): Proposal {
	const previews = tryChanges(input.changes, now);
	const content: Content = {
		summary: input.summary,
		changes: input.changes.map((change, index) => ({ change, preview: previews[index]! }))
	};
	const { id } = db()
		.insert(aiProposals)
		.values({
			connectionId,
			content: JSON.stringify(content),
			status: 'pending',
			createdAt: now,
			expiresAt: now + PROPOSAL_LIFETIME
		})
		.returning({ id: aiProposals.id })
		.get();
	return getProposal(id, now);
}

function proposalRow(proposalId: number) {
	const row = db()
		.select({
			id: aiProposals.id,
			connectionId: aiProposals.connectionId,
			platform: aiConnections.platform,
			content: aiProposals.content,
			status: aiProposals.status,
			error: aiProposals.error,
			createdAt: aiProposals.createdAt,
			expiresAt: aiProposals.expiresAt,
			decidedAt: aiProposals.decidedAt
		})
		.from(aiProposals)
		.innerJoin(aiConnections, eq(aiConnections.id, aiProposals.connectionId))
		.where(eq(aiProposals.id, proposalId))
		.get();
	if (!row) error(404, 'Not found');
	return row;
}

function statusOf(row: { status: Proposal['status']; expiresAt: number }, now: number) {
	return row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status;
}

/** Not found when there's no such proposal, as after its connection was revoked. */
export function getProposal(proposalId: number, now: number): Proposal {
	const { content, ...row } = proposalRow(proposalId);
	const { summary, changes } = JSON.parse(content) as Content;
	return {
		...row,
		summary,
		changes: changes.map((change) => change.preview),
		status: statusOf(row, now),
		hash: contentHash(content)
	};
}

export type ProposalSummary = {
	id: number;
	platform: AiPlatform;
	summary: string;
	changeCount: number;
	status: ProposalStatus;
	createdAt: number;
};

/** The newest proposals, for Admin (design 7). */
export function listProposals(now: number, limit: number): ProposalSummary[] {
	return db()
		.select({
			id: aiProposals.id,
			platform: aiConnections.platform,
			content: aiProposals.content,
			status: aiProposals.status,
			createdAt: aiProposals.createdAt,
			expiresAt: aiProposals.expiresAt
		})
		.from(aiProposals)
		.innerJoin(aiConnections, eq(aiConnections.id, aiProposals.connectionId))
		.orderBy(desc(aiProposals.id))
		.limit(limit)
		.all()
		.map(({ content, expiresAt, ...row }) => {
			const { summary, changes } = JSON.parse(content) as Content;
			return {
				...row,
				summary,
				changeCount: changes.length,
				status: statusOf({ status: row.status, expiresAt }, now)
			};
		});
}

const DECIDED: Record<Exclude<Proposal['status'], 'pending' | 'expired'>, string> = {
	approved: 'This proposal was already approved.',
	rejected: 'This proposal was already rejected.',
	failed: 'This proposal already failed, so it can’t be approved again.'
};

/**
 * The content of a proposal still waiting for the admin, and the one the page showed: refused
 * (400) once it's approved, rejected, failed or expired, or when `hash` isn't its content's.
 */
function pendingContent(proposalId: number, hash: string, now: number): Content {
	const row = proposalRow(proposalId);
	if (row.status !== 'pending') error(400, DECIDED[row.status]);
	if (row.expiresAt <= now) error(400, 'This proposal has expired. Ask for a new one.');
	if (contentHash(row.content) !== hash) {
		error(400, "This isn't the proposal the page showed. Reload the page.");
	}
	return JSON.parse(row.content) as Content;
}

function decide(proposalId: number, status: 'approved' | 'rejected', now: number): void {
	db()
		.update(aiProposals)
		.set({ status, decidedAt: now })
		.where(eq(aiProposals.id, proposalId))
		.run();
}

export type Approval =
	/** The households it changed, which may now have new items to give standard images (6.14). */
	| { kind: 'approved'; householdIds: number[] }
	| { kind: 'failed'; error: string };

/**
 * Makes the proposal's changes, all in one transaction with recording that it's approved, so they
 * all happen once or none do. A change fails when a record it names has changed since it was
 * proposed, or when the data layer refuses it. Then nothing changes but the proposal, which fails
 * for good, with why. Refused (400) as pendingContent says.
 */
export function approveProposal(proposalId: number, hash: string, now: number): Approval {
	try {
		return transaction(() => {
			const content = pendingContent(proposalId, hash, now);
			const changes = content.changes.map(({ change }) => change);
			const planned = planAll(changes);
			for (const [index, plan] of planned.entries()) {
				const shown = content.changes[index]!.preview;
				const same =
					plan.record === shown.record &&
					JSON.stringify(plan.current) === JSON.stringify(shown.current);
				if (!same) {
					const change = `Change ${index + 1} (${changes[index]!.operation})`;
					throw new ChangeFailed(`${change}: ${shown.record} changed after this was proposed.`);
				}
			}
			applyAll(changes, planned, now);
			decide(proposalId, 'approved', now);
			const householdIds = [...new Set(changes.map((change) => change.householdId))];
			return { kind: 'approved', householdIds };
		});
	} catch (e) {
		if (!(e instanceof ChangeFailed)) throw e;
		db()
			.update(aiProposals)
			.set({ status: 'failed', error: e.message, decidedAt: now })
			.where(and(eq(aiProposals.id, proposalId), eq(aiProposals.status, 'pending')))
			.run();
		return { kind: 'failed', error: e.message };
	}
}

/** Changes nothing but the proposal. Refused (400) as pendingContent says. */
export function rejectProposal(proposalId: number, hash: string, now: number): void {
	transaction(() => {
		pendingContent(proposalId, hash, now);
		decide(proposalId, 'rejected', now);
	});
}
