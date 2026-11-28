import { createHash } from 'node:crypto';
import { error, isHttpError } from '@sveltejs/kit';
import { and, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, transaction } from '../db/index.ts';
import { aiConnections, aiProposals, type AiPlatform } from '../db/schema.ts';
import { discardPhoto, householdOwnsPhoto } from '../photos.ts';
import {
	changeSchema,
	planChange,
	prepareChange,
	proposesImage,
	type Change,
	type ChangeInput,
	type ChangePreview,
	type PlannedChange
} from './operations.ts';

// What an AI assistant proposes, which happens only when the admin approves it on Meals's
// confirmation page (design 6.17). A proposal is saved whole and never changed: approving makes
// exactly its changes, once, all of them or none. An image it proposes is stored as a photo when
// it's proposed, and deleted again once nothing can give it to a recipe or an item.

/** How long the admin has to approve or reject a proposal. */
export const PROPOSAL_LIFETIME = 24 * 60 * 60 * 1000;
const MAX_CHANGES = 50;
// Each is fetched and resized while the assistant waits, one at a time (prepareAll).
const MAX_IMAGES = 10;
// An approval that began before its proposal expired ends well within this, so an expired
// proposal's images are never deleted while it can still give them to a record.
const EXPIRED_IMAGES_DELAY = 60 * 1000;

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
		.refine(
			(changes) => changes.filter(proposesImage).length <= MAX_IMAGES,
			`Propose up to ${MAX_IMAGES} images at a time`
		)
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
function changeFailed(index: number, change: { operation: string }, cause: unknown): unknown {
	if (!isHttpError(cause) || cause.status >= 500) return cause;
	return new ChangeFailed(`Change ${index + 1} (${change.operation}): ${cause.body.message}`);
}

/** An image a proposal shows, of a recipe or an item in its household. */
export type ProposalImage = { householdId: number; photoKey: string };

/** The images a proposal shows: those its changes would replace, and those they propose. */
function imagesOf(content: Content): ProposalImage[] {
	return content.changes.flatMap(({ preview }) =>
		[...preview.current, ...preview.proposed].flatMap(({ photoKey }) =>
			photoKey === undefined ? [] : [{ householdId: preview.householdId, photoKey }]
		)
	);
}

/**
 * Deletes the files of each image that no recipe or item in its household has, for a proposal
 * that can't be approved anymore: the images it proposed that weren't approved, and the ones that
 * approved images replaced. A proposal's images and the ones it would replace are its own, unique
 * to a record, so nothing else ever points at them (photos.ts).
 */
export function discardUnusedImages(images: ProposalImage[]): void {
	for (const { householdId, photoKey } of images) {
		if (!householdOwnsPhoto(householdId, photoKey)) discardPhoto(photoKey);
	}
}

/** Deletes the images stored for changes that no proposal kept (prepareChange). */
function discardStaged(changes: Change[]): void {
	for (const change of changes) {
		if ('photoKey' in change && change.photoKey !== null) discardPhoto(change.photoKey);
	}
}

/**
 * Prepares the changes in order (prepareChange), one image at a time, so a proposal's images never
 * fill the server's memory together. A refusal says which change and why (400), and the images
 * stored so far are deleted.
 */
async function prepareAll(changes: ChangeInput[]): Promise<Change[]> {
	const prepared: Change[] = [];
	for (const [index, change] of changes.entries()) {
		try {
			prepared.push(await prepareChange(change));
		} catch (e) {
			discardStaged(prepared);
			const failed = changeFailed(index, change, e);
			if (failed instanceof ChangeFailed) error(400, failed.message);
			throw failed;
		}
	}
	return prepared;
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

/**
 * Saves the changes as a proposal for the admin to approve or reject, once they can be made. An
 * image change's image is fetched, resized and stored first (prepareChange), so the page shows the
 * image that approving gives the record. A refused proposal's images are deleted again.
 */
export async function proposeChanges(
	connectionId: number,
	input: ProposalInput,
	now: number
): Promise<Proposal> {
	discardExpiredImages(now);
	const changes = await prepareAll(input.changes);
	let id: number;
	try {
		const previews = tryChanges(changes, now);
		const content: Content = {
			summary: input.summary,
			changes: changes.map((change, index) => ({ change, preview: previews[index]! }))
		};
		id = db()
			.insert(aiProposals)
			.values({
				connectionId,
				content: JSON.stringify(content),
				status: 'pending',
				createdAt: now,
				expiresAt: now + PROPOSAL_LIFETIME
			})
			.returning({ id: aiProposals.id })
			.get().id;
	} catch (e) {
		discardStaged(changes);
		throw e;
	}
	return getProposal(id, now);
}

/**
 * Deletes the images of proposals that expired over a minute ago, so nothing can approve them, but
 * for those a recipe or an item has (design 6.17). Runs when the app starts and with each new
 * proposal, since nothing else happens when a proposal expires.
 */
export function discardExpiredImages(now: number): void {
	const expired = db()
		.select({ content: aiProposals.content })
		.from(aiProposals)
		.where(
			and(
				eq(aiProposals.status, 'pending'),
				lte(aiProposals.expiresAt, now - EXPIRED_IMAGES_DELAY)
			)
		)
		.all();
	for (const { content } of expired) discardUnusedImages(imagesOf(JSON.parse(content) as Content));
}

/** The images the connection's proposals show, for revoking it (oauth.ts) to delete. */
export function connectionImages(connectionId: number): ProposalImage[] {
	return db()
		.select({ content: aiProposals.content })
		.from(aiProposals)
		.where(eq(aiProposals.connectionId, connectionId))
		.all()
		.flatMap(({ content }) => imagesOf(JSON.parse(content) as Content));
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
 * for good, with why. Refused (400) as pendingContent says. Either way, the images it leaves
 * unused are deleted afterward: those it proposed that it didn't give a record, and those it
 * replaced.
 */
export function approveProposal(proposalId: number, hash: string, now: number): Approval {
	let approved: { content: Content; householdIds: number[] };
	try {
		approved = transaction(() => {
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
			return { content, householdIds: [...new Set(changes.map((change) => change.householdId))] };
		});
	} catch (e) {
		if (!(e instanceof ChangeFailed)) throw e;
		db()
			.update(aiProposals)
			.set({ status: 'failed', error: e.message, decidedAt: now })
			.where(and(eq(aiProposals.id, proposalId), eq(aiProposals.status, 'pending')))
			.run();
		// Its content never changes, so reading it again reads what failed, unless revoking the
		// connection deleted it meanwhile, and its images with it.
		const failed = db()
			.select({ content: aiProposals.content })
			.from(aiProposals)
			.where(eq(aiProposals.id, proposalId))
			.get();
		if (failed) discardUnusedImages(imagesOf(JSON.parse(failed.content) as Content));
		return { kind: 'failed', error: e.message };
	}
	discardUnusedImages(imagesOf(approved.content));
	return { kind: 'approved', householdIds: approved.householdIds };
}

/**
 * Changes nothing but the proposal, and deletes the images it proposed. Refused (400) as
 * pendingContent says.
 */
export function rejectProposal(proposalId: number, hash: string, now: number): void {
	const content = transaction(() => {
		const content = pendingContent(proposalId, hash, now);
		decide(proposalId, 'rejected', now);
		return content;
	});
	discardUnusedImages(imagesOf(content));
}
