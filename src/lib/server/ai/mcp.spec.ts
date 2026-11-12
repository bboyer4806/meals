import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../auth/session.ts';
import { createInvite } from '../data/households.ts';
import { addNeed } from '../data/needs.ts';
import { db } from '../db/index.ts';
import { aiConnections, users } from '../db/schema.ts';
import { freshDb, makeDish, makeHousehold, makeStore, recipe } from '../testing.ts';
import { handleMessage, type McpContext } from './mcp.ts';

let context: McpContext;
let one: { householdId: number; userId: number };
let two: { householdId: number; userId: number };

function connection(clientId: string): number {
	return db()
		.insert(aiConnections)
		.values({
			clientId,
			platform: 'chatgpt',
			redirectUris: '[]',
			createdAt: 0,
			userId: one.userId,
			authorizedAt: 0
		})
		.returning({ id: aiConnections.id })
		.get().id;
}

beforeEach(() => {
	freshDb();
	one = makeHousehold();
	two = makeHousehold('America/New_York');
	context = { connectionId: connection('chatgpt-client'), origin: 'https://meals.example.com', now: 0 };
});

function request(method: string, params?: unknown, on = context) {
	return handleMessage({ jsonrpc: '2.0', id: 7, method, params }, on);
}

/** A tool's result, as the assistant reads it. */
function call(name: string, args: object, on = context) {
	const answer = request('tools/call', { name, arguments: args }, on);
	if (!answer || !('result' in answer)) throw new Error(`No result: ${JSON.stringify(answer)}`);
	const result = answer.result as { content: { text: string }[]; isError?: boolean };
	const text = result.content[0]!.text;
	return result.isError ? { error: text } : JSON.parse(text);
}

describe('the protocol', () => {
	it('agrees on a protocol version, and says what it offers', () => {
		expect(request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })).toMatchObject({
			jsonrpc: '2.0',
			id: 7,
			result: {
				protocolVersion: '2025-06-18',
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'meals' },
				instructions: expect.stringContaining('propose_changes')
			}
		});
		expect(request('initialize', { protocolVersion: '1999-01-01' })).toMatchObject({
			result: { protocolVersion: '2025-11-25' }
		});
		expect(request('ping')).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
	});

	it('answers no notification or response, and refuses what it doesn’t know', () => {
		expect(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, context)).toBeNull();
		expect(handleMessage({ jsonrpc: '2.0', id: 3, result: {} }, context)).toBeNull();
		expect(request('resources/list')).toEqual({
			jsonrpc: '2.0',
			id: 7,
			error: { code: -32601, message: 'Method not found: resources/list' }
		});
		expect(handleMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }], context)).toMatchObject({
			error: { code: -32600 }
		});
		expect(request('tools/call', { name: 'run_sql', arguments: {} })).toMatchObject({
			error: { code: -32602, message: 'Unknown tool: run_sql' }
		});
	});

	it('lists read tools and the one tool that proposes changes, each with its JSON Schema', () => {
		const answer = request('tools/list') as { result: { tools: Record<string, unknown>[] } };
		const tools = answer.result.tools;
		expect(tools.map((tool) => tool.name)).toEqual([
			'list_households',
			'list_stores',
			'list_items',
			'get_grocery_list',
			'get_grocery_history',
			'list_recipes',
			'get_recipe',
			'get_menu',
			'list_requests',
			'list_party_lists',
			'get_party_list',
			'propose_changes',
			'get_proposal'
		]);
		for (const tool of tools) {
			expect(tool.inputSchema).toMatchObject({ type: 'object' });
			const { readOnlyHint } = tool.annotations as { readOnlyHint: boolean };
			expect(readOnlyHint, String(tool.name)).toBe(tool.name !== 'propose_changes');
		}
	});
});

describe('reading', () => {
	it('reads every household, and never sign-in details', () => {
		createSession(one.userId, 0);
		db().update(users).set({ name: 'Alex Smith' }).where(eq(users.id, two.userId)).run();
		createInvite(null, 'new@example.com', 0);
		const { households, newHouseholdInvites } = call('list_households', {});
		expect(newHouseholdInvites).toEqual([{ id: expect.any(Number), email: 'new@example.com' }]);
		expect(households).toHaveLength(2);
		expect(households[1]).toEqual({
			id: two.householdId,
			name: expect.any(String),
			defaultServings: 4,
			timeZone: 'America/New_York',
			createdAt: '1970-01-01T00:00:00.000Z',
			members: [{ id: two.userId, name: 'Alex Smith', email: expect.stringContaining('@example.com') }],
			invites: []
		});
		const text = JSON.stringify(households);
		for (const { googleSub } of db().select({ googleSub: users.googleSub }).from(users).all()) {
			expect(text).not.toContain(googleSub);
		}
	});

	it("reads a household's grocery list, recipes and menu by its id", () => {
		const store = makeStore(two.householdId, 'Aldi');
		addNeed(two.householdId, { itemName: 'Eggs', quantity: 12, unit: null, store, resolution: 'none' }, 0);
		makeDish(two.householdId, recipe('Chili', { tags: ['Spicy'] }));

		expect(call('get_grocery_list', { householdId: two.householdId }).lines).toMatchObject([
			{ itemName: 'Eggs', quantity: 12, storeName: 'Aldi', status: 'to_order' }
		]);
		expect(call('get_grocery_list', { householdId: one.householdId }).lines).toEqual([]);
		const { recipes } = call('list_recipes', { householdId: two.householdId, tags: ['spicy'] });
		expect(recipes.map((dish: { name: string }) => dish.name)).toEqual(['Chili']);
		expect(call('get_recipe', { householdId: two.householdId, recipeId: recipes[0].id })).toMatchObject({
			name: 'Chili',
			tags: ['Spicy'],
			ratings: []
		});
		expect(call('get_menu', { householdId: two.householdId, startDate: '2026-11-01', endDate: '2026-11-30' })).toEqual({
			dinners: []
		});
	});

	it('says what was wrong with what it was sent', () => {
		expect(call('list_stores', { householdId: 999 })).toEqual({ error: "Household 999 wasn't found." });
		expect(call('list_stores', {})).toEqual({
			error: 'householdId: Invalid input: expected number, received NaN'
		});
		expect(
			call('get_menu', { householdId: one.householdId, startDate: '2026-01-01', endDate: '2026-12-31' })
		).toEqual({ error: 'Ask for up to 92 days, ending on or after the start' });
		// Another household's recipe isn't there for this one.
		const dish = makeDish(two.householdId, recipe('Chili'));
		expect(call('get_recipe', { householdId: one.householdId, recipeId: dish })).toEqual({
			error: 'Not found: check the ids you sent.'
		});
	});

	it('logs an unexpected failure and says only that something went wrong', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			db().run(sql`drop table dish_requests`);
			expect(call('list_requests', { householdId: one.householdId })).toEqual({
				error: 'Something went wrong in Meals. Try again later.'
			});
			expect(logged).toHaveBeenCalledTimes(1);
		} finally {
			logged.mockRestore();
		}
	});
});

describe('proposing', () => {
	const addMilk = (householdId: number) => ({
		operation: 'add_grocery_line',
		householdId,
		itemName: 'Milk',
		quantity: 1,
		unit: null,
		store: 'none'
	});

	it('proposes changes and gives the link to approve them, and their outcome', () => {
		const proposal = call('propose_changes', {
			summary: 'Milk for both',
			changes: [addMilk(one.householdId), addMilk(two.householdId)]
		});
		expect(proposal).toMatchObject({
			proposalId: expect.any(Number),
			status: 'pending',
			url: `https://meals.example.com/ai/proposals/${proposal.proposalId}`,
			expiresAt: '1970-01-02T00:00:00.000Z',
			changes: [{ householdId: one.householdId }, { householdId: two.householdId }]
		});
		expect(call('get_proposal', { proposalId: proposal.proposalId })).toMatchObject({
			status: 'pending'
		});
		expect(call('get_grocery_list', { householdId: one.householdId }).lines).toEqual([]);
	});

	it("refuses changes it can't make, and another connection's proposals", () => {
		expect(call('propose_changes', { summary: 'Twice', changes: [addMilk(one.householdId), addMilk(one.householdId)] })).toEqual({
			error: 'Change 2 (add_grocery_line): Milk is already on the grocery list (1, To order).'
		});
		const { proposalId } = call('propose_changes', { summary: 'Milk', changes: [addMilk(one.householdId)] });
		const other = { ...context, connectionId: connection('another-client') };
		expect(call('get_proposal', { proposalId }, other)).toEqual({
			error: `Proposal ${proposalId} wasn't found.`
		});
	});
});
