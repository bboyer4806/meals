import { isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { daysBetween, isDate } from '../../menu.ts';
import { getDinners } from '../data/dinners.ts';
import { getDish, listDishes, listDishRatings } from '../data/dishes.ts';
import { getHousehold, listHouseholds, listInvites, listMembers } from '../data/households.ts';
import { listCatalog } from '../data/items.ts';
import { listActiveLines, listHistory } from '../data/needs.ts';
import { getPartyList, listPartyLists } from '../data/party-lists.ts';
import { listCompletedRequests, listRequests } from '../data/requests.ts';
import { listStores } from '../data/stores.ts';
import { id } from '../forms.ts';
import { getProposal, proposalInput, proposeChanges, type Proposal } from './proposals.ts';

// Meals's MCP server (design 6.17): JSON-RPC messages over Streamable HTTP, each request answered
// with JSON. Its tools read any household's data through the data layer, and propose changes,
// which happen only when the admin approves them. Nothing here writes household data.

/** Newest first. A client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const INSTRUCTIONS = [
	'Meals is a website where households keep a grocery list, recipes and a dinner menu.',
	'list_households gives each household’s id, which the other tools take.',
	'Nothing changes until the Meals admin approves it: propose_changes saves changes as one proposal',
	'and gives a link, where the admin approves or rejects them all together. Share the link, and',
	'check the outcome with get_proposal. A change to a record takes all of its fields, so read the',
	'record first and send its values back with only the ones that change.'
].join(' ');

/** Who's asking: the connection the access token is for, on this site, now. */
export type McpContext = { connectionId: number; origin: string; now: number };

/** A tool's answer when it can't do what was asked; its message is safe to show. */
class ToolError extends Error {}

type Tool = {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	inputSchema: object;
	call: (args: unknown, context: McpContext) => unknown;
};

/** The JSON Schema MCP clients get for a tool's arguments: what the zod schema takes. */
function jsonSchema(schema: z.ZodType): object {
	const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: 'input' });
	return rest;
}

function issuesText(issues: z.ZodError['issues']): string {
	return issues
		.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ` : '') + issue.message)
		.join('\n');
}

function tool<S extends z.ZodType>(
	spec: Omit<Tool, 'inputSchema' | 'call'> & {
		input: S;
		run: (input: z.output<S>, context: McpContext) => unknown;
	}
): Tool {
	const { input, run, ...rest } = spec;
	return {
		...rest,
		inputSchema: jsonSchema(input),
		call: (args, context) => {
			const parsed = input.safeParse(args);
			if (!parsed.success) throw new ToolError(issuesText(parsed.error.issues));
			return run(parsed.data, context);
		}
	};
}

/** The household, or an error saying it isn't there. */
function household(householdId: number) {
	try {
		return getHousehold(householdId);
	} catch (e) {
		if (isHttpError(e, 404)) throw new ToolError(`Household ${householdId} wasn't found.`);
		throw e;
	}
}

const householdId = id.describe('The household, from list_households');
const inHousehold = z.object({ householdId });
const search = z.string().max(80).default('').describe('Part of a name, or empty for all');

const MAX_MENU_DAYS = 92;

/** A proposal as an assistant sees it, with the link the admin opens. */
function proposalView(proposal: Proposal, origin: string) {
	const { id, status, error, summary, changes, createdAt, expiresAt, decidedAt } = proposal;
	return {
		proposalId: id,
		status,
		...(error === null ? {} : { error }),
		url: `${origin}/ai/proposals/${id}`,
		summary,
		changes,
		createdAt,
		expiresAt,
		decidedAt
	};
}

const TOOLS: Tool[] = [
	tool({
		name: 'list_households',
		title: 'List households',
		description:
			'Every household in Meals: its id, name, usual servings, time zone, members and invites waiting to be used. Also the invites to start new households.',
		readOnly: true,
		input: z.object({}),
		run: () => ({
			newHouseholdInvites: listInvites(null),
			households: listHouseholds().map(({ id }) => {
				const { name, defaultServings, timeZone, createdAt } = household(id);
				return {
					id,
					name,
					defaultServings,
					timeZone,
					createdAt,
					members: listMembers(id).map(({ id, name, email }) => ({ id, name, email })),
					invites: listInvites(id)
				};
			})
		})
	}),
	tool({
		name: 'list_stores',
		title: 'List stores',
		description: "A household's stores, archived ones included.",
		readOnly: true,
		input: inHousehold,
		run: ({ householdId }) => ({ stores: listStores(household(householdId).id) })
	}),
	tool({
		name: 'list_items',
		title: 'List items',
		description:
			"A household's catalog of items, active or archived: notes, usual store and when and where each was last bought.",
		readOnly: true,
		input: inHousehold.extend({ archived: z.boolean().default(false), search }),
		run: ({ householdId, archived, search }) => ({
			items: listCatalog(household(householdId).id, archived, search)
		})
	}),
	tool({
		name: 'get_grocery_list',
		title: 'Get the grocery list',
		description:
			"A household's grocery list: lines to order, ordered, and received today in its time zone.",
		readOnly: true,
		input: inHousehold,
		run: ({ householdId }, { now }) => ({
			lines: listActiveLines(householdId, household(householdId).timeZone, now)
		})
	}),
	tool({
		name: 'get_grocery_history',
		title: 'Get grocery history',
		description: "A household's received grocery lines, newest first.",
		readOnly: true,
		input: inHousehold.extend({ search, limit: z.number().int().min(1).max(500).default(100) }),
		run: ({ householdId, search, limit }) => ({
			lines: listHistory(household(householdId).id, search, limit)
		})
	}),
	tool({
		name: 'list_recipes',
		title: 'List recipes',
		description:
			"A household's recipes by name, active or archived, with tags, times, ratings and whether they've been tried.",
		readOnly: true,
		input: inHousehold.extend({
			archived: z.boolean().default(false),
			search,
			tags: z.array(z.string().max(30)).max(10).default([]).describe('Recipes with every one of these')
		}),
		run: ({ householdId, archived, search, tags }) => ({
			recipes: listDishes(household(householdId).id, { search, tags, archived, sort: 'name' })
		})
	}),
	tool({
		name: 'get_recipe',
		title: 'Get a recipe',
		description: 'A recipe with all its fields, ingredients and ratings.',
		readOnly: true,
		input: inHousehold.extend({ recipeId: id.describe('The recipe, from list_recipes') }),
		run: ({ householdId, recipeId }) => {
			household(householdId);
			return {
				...getDish(householdId, recipeId),
				ratings: listDishRatings(householdId, recipeId)
			};
		}
	}),
	tool({
		name: 'get_menu',
		title: 'Get the menu',
		description: `A household's dinners from one date to another, up to ${MAX_MENU_DAYS} days. A date with no dinner isn't planned.`,
		readOnly: true,
		input: inHousehold
			.extend({
				startDate: z.string().refine(isDate, 'Enter a date as YYYY-MM-DD'),
				endDate: z.string().refine(isDate, 'Enter a date as YYYY-MM-DD')
			})
			.refine(
				({ startDate, endDate }) =>
					isDate(startDate) &&
					isDate(endDate) &&
					daysBetween(startDate, endDate) >= 0 &&
					daysBetween(startDate, endDate) < MAX_MENU_DAYS,
				`Ask for up to ${MAX_MENU_DAYS} days, ending on or after the start`
			),
		run: ({ householdId, startDate, endDate }) => ({
			dinners: getDinners(household(householdId).id, startDate, endDate)
		})
	}),
	tool({
		name: 'list_requests',
		title: 'List requests',
		description: "A household's dish and restaurant requests: active ones, and completed ones.",
		readOnly: true,
		input: inHousehold,
		run: ({ householdId }) => ({
			active: listRequests(household(householdId).id),
			completed: listCompletedRequests(householdId)
		})
	}),
	tool({
		name: 'list_party_lists',
		title: 'List party lists',
		description: "A household's party lists, with how many of their things are bought.",
		readOnly: true,
		input: inHousehold,
		run: ({ householdId }) => ({ partyLists: listPartyLists(household(householdId).id) })
	}),
	tool({
		name: 'get_party_list',
		title: 'Get a party list',
		description: "A party list's things: what's needed, bought and on the grocery list.",
		readOnly: true,
		input: inHousehold.extend({ partyListId: id.describe('The list, from list_party_lists') }),
		run: ({ householdId, partyListId }) => {
			household(householdId);
			return getPartyList(householdId, partyListId);
		}
	}),
	tool({
		name: 'propose_changes',
		title: 'Propose changes',
		description: [
			'Proposes changes to any households, which happen only when the Meals admin approves them:',
			'all together, or none. Each is checked now, and one that can’t be made is refused with why.',
			'Returns a link for the admin. A change to a record takes all of its fields. save_dinner',
			'plans a date or changes a dinner with exactly the dishes listed, by recipe name; a new name',
			'adds a recipe with no details.'
		].join(' '),
		readOnly: false,
		input: proposalInput,
		run: (input, { connectionId, origin, now }) =>
			proposalView(proposeChanges(connectionId, input, now), origin)
	}),
	tool({
		name: 'get_proposal',
		title: 'Get a proposal',
		description:
			'A proposal this connection made: pending, approved, rejected, failed with why, or expired.',
		readOnly: true,
		input: z.object({ proposalId: id }),
		run: ({ proposalId }, { connectionId, origin, now }) => {
			const proposal = getProposal(proposalId, now);
			if (proposal.connectionId !== connectionId) {
				throw new ToolError(`Proposal ${proposalId} wasn't found.`);
			}
			return proposalView(proposal, origin);
		}
	})
];

/**
 * A tool's result as an assistant reads it: times as ISO 8601 rather than milliseconds, which are
 * easy to misread.
 */
function forAssistant(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(forAssistant);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, inner]) => [
			key,
			key.endsWith('At') && typeof inner === 'number'
				? new Date(inner).toISOString()
				: forAssistant(inner)
		])
	);
}

/** What went wrong in a tool, safe to show: never a stack, a query or a secret. */
function toolError(e: unknown): string {
	if (e instanceof ToolError) return e.message;
	if (isHttpError(e) && e.status < 500) {
		return e.status === 404 ? `${e.body.message}: check the ids you sent.` : e.body.message;
	}
	console.error('An MCP tool failed:', e);
	return 'Something went wrong in Meals. Try again later.';
}

function callTool(params: unknown, context: McpContext): unknown {
	const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
	const found = TOOLS.find((candidate) => candidate.name === name);
	if (!found) throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
	try {
		const result = forAssistant(found.call(args ?? {}, context));
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	} catch (e) {
		return { content: [{ type: 'text', text: toolError(e) }], isError: true };
	}
}

function listTools() {
	return TOOLS.map(({ name, title, description, readOnly, inputSchema }) => ({
		name,
		title,
		description,
		inputSchema,
		annotations: {
			readOnlyHint: readOnly,
			destructiveHint: false,
			idempotentHint: readOnly,
			openWorldHint: false
		}
	}));
}

function initialize(params: unknown) {
	const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
	return {
		protocolVersion:
			typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
		capabilities: { tools: { listChanged: false } },
		serverInfo: { name: 'meals', title: 'Meals', version: '1.0.0' },
		instructions: INSTRUCTIONS
	};
}

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string
	) {
		super(message);
	}
}

export type RpcId = string | number | null;

export type RpcResponse =
	| { jsonrpc: '2.0'; id: RpcId; result: unknown }
	| { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string } };

export function rpcError(id: RpcId, code: number, message: string): RpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Answers one JSON-RPC message from an MCP client, or null for a notification or a response,
 * which get no answer. Batches aren't taken, as MCP since 2025-06-18 has none.
 */
export function handleMessage(message: unknown, context: McpContext): RpcResponse | null {
	if (typeof message !== 'object' || message === null || Array.isArray(message)) {
		return rpcError(null, -32600, 'Send one JSON-RPC message at a time');
	}
	const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
	if (typeof method === 'string' && id === undefined) return null;
	if (method === undefined && ('result' in message || 'error' in message)) return null;
	if (typeof method !== 'string' || (typeof id !== 'string' && typeof id !== 'number')) {
		return rpcError(null, -32600, 'Invalid request');
	}
	try {
		switch (method) {
			case 'initialize':
				return { jsonrpc: '2.0', id, result: initialize(params) };
			case 'ping':
				return { jsonrpc: '2.0', id, result: {} };
			case 'tools/list':
				return { jsonrpc: '2.0', id, result: { tools: listTools() } };
			case 'tools/call':
				return { jsonrpc: '2.0', id, result: callTool(params, context) };
			default:
				return rpcError(id, -32601, `Method not found: ${method}`);
		}
	} catch (e) {
		if (e instanceof RpcError) return rpcError(id, e.code, e.message);
		throw e;
	}
}
