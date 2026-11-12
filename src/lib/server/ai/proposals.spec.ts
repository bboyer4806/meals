import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { revokeConnection } from '../auth/oauth.ts';
import { getHousehold } from '../data/households.ts';
import { addNeed, getLine, listActiveLines, updateLine } from '../data/needs.ts';
import { createStore, listStores } from '../data/stores.ts';
import { db } from '../db/index.ts';
import { aiConnections, aiProposals } from '../db/schema.ts';
import { expectHttpError, freshDb, makeHousehold } from '../testing.ts';
import {
	approveProposal,
	getProposal,
	listProposals,
	proposalInput,
	proposeChanges,
	PROPOSAL_LIFETIME,
	rejectProposal
} from './proposals.ts';

let connectionId: number;
let one: number;
let two: number;

beforeEach(() => {
	freshDb();
	const admin = makeHousehold();
	one = admin.householdId;
	two = makeHousehold().householdId;
	connectionId = db()
		.insert(aiConnections)
		.values({
			clientId: 'claude-client',
			platform: 'claude',
			redirectUris: '[]',
			createdAt: 0,
			userId: admin.userId,
			authorizedAt: 0
		})
		.returning({ id: aiConnections.id })
		.get().id;
});

function propose(changes: object[], now = 0) {
	return proposeChanges(connectionId, proposalInput.parse({ summary: 'Weekly shop', changes }), now);
}

const addMilk = (householdId: number) => ({
	operation: 'add_grocery_line',
	householdId,
	itemName: 'Milk',
	quantity: 1,
	unit: null,
	store: 'none'
});

const rename = (householdId: number, name: string) => ({
	operation: 'update_household',
	householdId,
	name,
	defaultServings: 4,
	timeZone: 'America/Chicago'
});

function lines(householdId: number) {
	return listActiveLines(householdId, 'America/Chicago', 0);
}

describe('proposing', () => {
	it('saves what each change shows, for any households, and changes nothing yet', () => {
		const nameOfTwo = getHousehold(two).name;
		const proposal = propose([addMilk(one), rename(two, 'The Smiths')], 1000);
		expect(proposal).toMatchObject({
			connectionId,
			platform: 'claude',
			summary: 'Weekly shop',
			status: 'pending',
			error: null,
			createdAt: 1000,
			expiresAt: 1000 + PROPOSAL_LIFETIME,
			decidedAt: null,
			hash: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		expect(proposal.changes).toMatchObject([
			{ title: 'Add to the grocery list', householdId: one, record: null, current: [] },
			{ title: "Change the household's settings", householdId: two, record: `Household ${two}` }
		]);
		expect(lines(one)).toEqual([]);
		expect(getHousehold(two).name).toBe(nameOfTwo);
	});

	it('refuses changes that can’t be made, saying which and why, and saves nothing', () => {
		// The second Milk is the duplicate the add bar would warn about.
		expectHttpError(() => propose([addMilk(one), addMilk(one)]), 400);
		try {
			propose([addMilk(one), addMilk(one)]);
		} catch (e) {
			expect((e as { body: { message: string } }).body.message).toBe(
				'Change 2 (add_grocery_line): Milk is already on the grocery list (1, To order).'
			);
		}
		expect(lines(one)).toEqual([]);
		expect(db().select().from(aiProposals).all()).toEqual([]);
	});

	it('takes a summary and up to 50 changes', () => {
		const parse = (input: object) =>
			proposalInput.safeParse(input).error?.issues.map((issue) => issue.message);
		expect(parse({ summary: ' ', changes: [addMilk(one)] })).toEqual(['Say what the changes are for']);
		expect(parse({ summary: 'x', changes: [] })).toEqual(['Propose at least one change']);
		const many = Array.from({ length: 51 }, () => addMilk(one));
		expect(parse({ summary: 'x', changes: many })).toEqual(['Propose up to 50 changes at a time']);
		// Nothing but the listed operations, so no SQL and no change to the database's tables.
		const sql = { operation: 'run_sql', sql: 'drop table users' };
		expect(parse({ summary: 'x', changes: [sql] })).toEqual([
			expect.stringContaining("Invalid discriminator value. Expected 'update_household' |")
		]);
	});
});

describe('approving (design 6.17)', () => {
	it('makes every change, in every household, once', () => {
		const proposal = propose([addMilk(one), rename(two, 'The Smiths')]);
		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'approved',
			householdIds: [one, two]
		});
		expect(lines(one).map((line) => line.itemName)).toEqual(['Milk']);
		expect(getHousehold(two).name).toBe('The Smiths');
		expect(getProposal(proposal.id, 2000)).toMatchObject({ status: 'approved', decidedAt: 2000 });

		// Approving again changes nothing.
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 3000), 400);
		expect(lines(one)).toHaveLength(1);
	});

	it('makes none of the changes when one fails, and fails the proposal for good', () => {
		const nameOfOne = getHousehold(one).name;
		const proposal = propose([
			rename(one, 'Renamed'),
			addMilk(two),
			{ operation: 'create_store', householdId: two, name: 'Costco' }
		]);
		// Someone adds the store in Meals before the admin approves.
		createStore(two, 'Costco');

		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'failed',
			error: 'Change 3 (create_store): A store is already called Costco.'
		});
		expect(getHousehold(one).name).toBe(nameOfOne);
		expect(lines(two)).toEqual([]);
		expect(listStores(two)).toHaveLength(1);
		expect(getProposal(proposal.id, 2000)).toMatchObject({
			status: 'failed',
			error: 'Change 3 (create_store): A store is already called Costco.',
			decidedAt: 2000
		});
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 3000), 400);
		expectHttpError(() => rejectProposal(proposal.id, proposal.hash, 3000), 400);
	});

	it('fails when a record it changes was changed after it was proposed', () => {
		addNeed(one, { itemName: 'Eggs', quantity: 1, unit: null, store: 'none', resolution: 'none' }, 0);
		const [line] = lines(one);
		const proposal = propose([
			{
				operation: 'update_grocery_line',
				householdId: one,
				lineId: line!.id,
				quantity: 2,
				unit: null,
				storeId: null,
				note: null
			}
		]);
		updateLine(one, line!.id, { quantity: 12, unit: null, storeId: null, note: null });
		const approval = approveProposal(proposal.id, proposal.hash, 2000);
		expect(approval).toEqual({
			kind: 'failed',
			error: `Change 1 (update_grocery_line): Grocery line ${line!.id} changed after this was proposed.`
		});
		expect(getLine(one, line!.id).quantity).toBe(12);
	});

	it('refuses another version of the proposal, an expired one or a rejected one', () => {
		const proposal = propose([addMilk(one)], 0);
		expectHttpError(() => approveProposal(proposal.id, 'f'.repeat(64), 1000), 400);

		// Its content is never changed, so a changed one isn't the one the page showed.
		const forged = JSON.stringify({ summary: 'Weekly shop', changes: [] });
		const content = db().select({ content: aiProposals.content }).from(aiProposals).get()!.content;
		db().update(aiProposals).set({ content: forged }).where(eq(aiProposals.id, proposal.id)).run();
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 1000), 400);
		db().update(aiProposals).set({ content }).where(eq(aiProposals.id, proposal.id)).run();

		expect(getProposal(proposal.id, PROPOSAL_LIFETIME).status).toBe('expired');
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, PROPOSAL_LIFETIME), 400);

		rejectProposal(proposal.id, proposal.hash, 1000);
		expect(getProposal(proposal.id, 1000)).toMatchObject({ status: 'rejected', decidedAt: 1000 });
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 2000), 400);
		expect(lines(one)).toEqual([]);
		expectHttpError(() => approveProposal(proposal.id + 1, proposal.hash, 2000), 404);
	});

	it('goes with its connection when that is revoked', () => {
		const proposal = propose([addMilk(one)]);
		revokeConnection(connectionId);
		expectHttpError(() => getProposal(proposal.id, 0), 404);
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 0), 404);
	});
});

it('lists the newest proposals first', () => {
	const first = propose([addMilk(one)], 0);
	const second = propose([rename(one, 'Home'), rename(two, 'Away')], 10);
	rejectProposal(first.id, first.hash, 20);
	expect(listProposals(30, 10)).toEqual([
		{ id: second.id, platform: 'claude', summary: 'Weekly shop', changeCount: 2, status: 'pending', createdAt: 10 },
		{ id: first.id, platform: 'claude', summary: 'Weekly shop', changeCount: 1, status: 'rejected', createdAt: 0 }
	]);
});
