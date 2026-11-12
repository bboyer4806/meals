import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, transaction } from '../db/index.ts';
import { aiConnections, aiTokens, users, type AiPlatform } from '../db/schema.ts';
import { randomToken } from './google.ts';
import { hashToken } from './session.ts';

// The OAuth 2.1 authorization server that ChatGPT and Claude sign in to Meals with, to use its MCP
// server as the admin (design 6.17). An assistant registers itself (RFC 7591), the admin allows it
// on a page that needs their Google sign-in, and it gets a code (with PKCE) for tokens. Only
// SHA-256 hashes of codes, tokens and client secrets are stored, as for sessions (4.5).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// RFC 6749 suggests a code last at most 10 minutes.
const CODE_LIFETIME = 5 * MINUTE;
const ACCESS_LIFETIME = HOUR;
// From the last refresh, as a session lasts from the last visit (4.5).
const REFRESH_LIFETIME = 30 * DAY;
// A registration the admin never allowed is deleted after this long.
const UNALLOWED_LIFETIME = DAY;

export const PLATFORM_NAMES: Record<AiPlatform, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };

// Where ChatGPT and Claude send the admin back after Allow or Deny, so only they can connect, and
// codes only ever go to them (design 6.17). ChatGPT uses its fixed address for an authorization
// server that sends `iss` back (RFC 9207), as this one does, and an address of its own per
// connection otherwise; OpenAI's platform site has one for apps it reviews. Claude may move from
// claude.ai to claude.com.
const CLAUDE_REDIRECTS = [
	'https://claude.ai/api/mcp/auth_callback',
	'https://claude.com/api/mcp/auth_callback'
];
const CHATGPT_REDIRECTS = ['https://platform.openai.com/apps-manage/oauth'];
const CHATGPT_REDIRECT =
	/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[\w-]+)$/;

/**
 * The sites those redirect URIs are on: the only other sites Meals sends the admin to, which
 * the connection page's redirects allow (SvelteKit's `external`). vite.config.ts lists them too.
 */
export const ASSISTANT_ORIGINS = [
	'https://chatgpt.com',
	'https://platform.openai.com',
	'https://claude.ai',
	'https://claude.com'
];

/** Which assistant a redirect URI belongs to, or null for any other. */
export function platformOf(redirectUri: string): AiPlatform | null {
	if (CLAUDE_REDIRECTS.includes(redirectUri)) return 'claude';
	if (CHATGPT_REDIRECTS.includes(redirectUri) || CHATGPT_REDIRECT.test(redirectUri)) {
		return 'chatgpt';
	}
	return null;
}

/** The MCP endpoint, the resource Meals's tokens are for (RFC 8707, RFC 9728). */
export function mcpResource(origin: string): string {
	return `${origin}/mcp`;
}

/** Where the MCP endpoint's metadata is: after the well-known path, its own path (RFC 9728). */
export function resourceMetadataUrl(origin: string): string {
	return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

/** RFC 8414. The site is its own issuer. */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: GRANT_TYPES,
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: AUTH_METHODS,
		authorization_response_iss_parameter_supported: true
	};
}

/** RFC 9728. */
export function protectedResourceMetadata(origin: string) {
	return {
		resource: mcpResource(origin),
		authorization_servers: [origin],
		bearer_methods_supported: ['header'],
		resource_name: 'Meals'
	};
}

type OAuthAnswer = { status: number; body: Record<string, unknown> };

function oauthError(status: number, code: string, description: string): OAuthAnswer {
	return { status, body: { error: code, error_description: description } };
}

const registration = z.object({
	redirect_uris: z.array(z.string().max(2000)).min(1).max(5),
	// RFC 7591 makes client_secret_basic the method of a client that names none.
	token_endpoint_auth_method: z.enum(AUTH_METHODS).default('client_secret_basic'),
	grant_types: z.array(z.enum(GRANT_TYPES)).optional(),
	response_types: z.array(z.literal('code')).optional()
});

/**
 * Registers an assistant as an OAuth client (RFC 7591), which can do nothing until the admin
 * allows it. Its redirect URIs must all be ChatGPT's or all Claude's. Every registration the admin
 * didn't allow within a day is deleted.
 */
export function registerClient(metadata: unknown, now: number): OAuthAnswer {
	const parsed = registration.safeParse(metadata);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return oauthError(400, 'invalid_client_metadata', `${issue?.path.join('.')}: ${issue?.message}`);
	}
	const { redirect_uris: redirectUris, token_endpoint_auth_method: method } = parsed.data;
	const platforms = new Set(redirectUris.map(platformOf));
	const [platform] = platforms;
	if (platforms.size !== 1 || !platform) {
		return oauthError(400, 'invalid_redirect_uri', 'Only ChatGPT and Claude can connect to Meals');
	}

	const clientId = randomToken();
	const secret = method === 'none' ? null : randomToken();
	transaction(() => {
		db()
			.delete(aiConnections)
			.where(
				and(
					isNull(aiConnections.authorizedAt),
					lte(aiConnections.createdAt, now - UNALLOWED_LIFETIME)
				)
			)
			.run();
		db()
			.insert(aiConnections)
			.values({
				clientId,
				secretHash: secret === null ? null : hashToken(secret),
				platform,
				redirectUris: JSON.stringify(redirectUris),
				createdAt: now
			})
			.run();
	});
	return {
		status: 201,
		body: {
			client_id: clientId,
			client_id_issued_at: Math.floor(now / 1000),
			...(secret === null ? {} : { client_secret: secret, client_secret_expires_at: 0 }),
			redirect_uris: redirectUris,
			grant_types: GRANT_TYPES,
			response_types: ['code'],
			token_endpoint_auth_method: method
		}
	};
}

function findClient(clientId: string) {
	return db().select().from(aiConnections).where(eq(aiConnections.clientId, clientId)).get();
}

/** A request that the admin allow an assistant, as its authorization request asked (RFC 6749). */
export type AuthorizationRequest = {
	clientId: string;
	platform: AiPlatform;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
};

export type ReadAuthorization =
	/** Not from an assistant Meals knows, so nothing is sent back: the page says so. */
	| { kind: 'invalid' }
	/** From a known assistant, but not one Meals can allow: it's sent back there with why. */
	| { kind: 'refused'; redirectTo: string }
	| { kind: 'valid'; request: AuthorizationRequest };

// The base64url SHA-256 of a code verifier (RFC 7636).
const S256_CHALLENGE = /^[\w-]{43}$/;

/**
 * Reads an authorization request: the query of the page that asks the admin, or the form its
 * buttons send, which repeats it. `issuer` is the site's origin.
 */
export function readAuthorizationRequest(
	params: { get(name: string): FormDataEntryValue | null },
	issuer: string
): ReadAuthorization {
	const text = (name: string) => {
		const value = params.get(name);
		return typeof value === 'string' ? value : null;
	};
	const clientId = text('client_id');
	const redirectUri = text('redirect_uri');
	const connection = clientId === null ? undefined : findClient(clientId);
	if (!connection || clientId === null || redirectUri === null) return { kind: 'invalid' };
	if (!(JSON.parse(connection.redirectUris) as string[]).includes(redirectUri)) {
		return { kind: 'invalid' };
	}

	const state = text('state');
	const refuse = (code: string, description: string): ReadAuthorization => ({
		kind: 'refused',
		redirectTo: callbackUrl(redirectUri, issuer, state, {
			error: code,
			error_description: description
		})
	});
	if (text('response_type') !== 'code') {
		return refuse('unsupported_response_type', 'Meals supports response_type code only');
	}
	const codeChallenge = text('code_challenge');
	if (
		text('code_challenge_method') !== 'S256' ||
		codeChallenge === null ||
		!S256_CHALLENGE.test(codeChallenge)
	) {
		return refuse('invalid_request', 'Send a PKCE code_challenge with code_challenge_method S256');
	}
	const resource = text('resource');
	if (resource !== null && resource !== mcpResource(issuer)) {
		return refuse('invalid_target', `Meals's MCP server is ${mcpResource(issuer)}`);
	}
	return {
		kind: 'valid',
		request: { clientId, platform: connection.platform, redirectUri, state, codeChallenge }
	};
}

/** The assistant's redirect URI with the answer, the request's state and who answered (RFC 9207). */
function callbackUrl(
	redirectUri: string,
	issuer: string,
	state: string | null,
	answer: Record<string, string>
): string {
	const url = new URL(redirectUri);
	for (const [name, value] of Object.entries(answer)) url.searchParams.set(name, value);
	if (state !== null) url.searchParams.set('state', state);
	url.searchParams.set('iss', issuer);
	return url.href;
}

/**
 * The admin allows the assistant, which then counts as connected. Returns where to send them: back
 * to the assistant, with a code it exchanges for tokens.
 */
export function allowConnection(
	request: AuthorizationRequest,
	userId: number,
	issuer: string,
	now: number
): string {
	const code = randomToken();
	transaction(() => {
		const connection = findClient(request.clientId);
		if (!connection) error(404, 'Not found');
		db()
			.update(aiConnections)
			.set({ userId, authorizedAt: connection.authorizedAt ?? now })
			.where(eq(aiConnections.id, connection.id))
			.run();
		db()
			.insert(aiTokens)
			.values({
				id: hashToken(code),
				connectionId: connection.id,
				kind: 'code',
				expiresAt: now + CODE_LIFETIME,
				redirectUri: request.redirectUri,
				codeChallenge: request.codeChallenge
			})
			.run();
	});
	return callbackUrl(request.redirectUri, issuer, request.state, { code });
}

/** Where Deny sends the admin: back to the assistant, which is told it wasn't allowed. */
export function denyConnection(request: AuthorizationRequest, issuer: string): string {
	return callbackUrl(request.redirectUri, issuer, request.state, {
		error: 'access_denied',
		error_description: 'The Meals admin did not allow the connection'
	});
}

type Client = NonNullable<ReturnType<typeof findClient>>;

/**
 * The client a token request is from: its client_id, and its secret when it registered with one,
 * in an HTTP Basic header or in the form. Null when they don't match.
 */
function authenticateClient(form: URLSearchParams, authorization: string | null): Client | null {
	let clientId = form.get('client_id');
	let secret = form.get('client_secret') || null;
	if (authorization?.startsWith('Basic ')) {
		const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString();
		const colon = decoded.indexOf(':');
		if (colon === -1) return null;
		try {
			clientId = decodeURIComponent(decoded.slice(0, colon));
			secret = decodeURIComponent(decoded.slice(colon + 1)) || null;
		} catch {
			return null;
		}
	}
	const client = clientId === null ? undefined : findClient(clientId);
	if (!client) return null;
	if (client.secretHash === null) return secret === null ? client : null;
	return secret !== null && hashToken(secret) === client.secretHash ? client : null;
}

/** Issues an access token and a refresh token, and deletes everyone's expired ones and codes. */
function issueTokens(connectionId: number, now: number): OAuthAnswer {
	const access = randomToken();
	const refresh = randomToken();
	db().delete(aiTokens).where(lte(aiTokens.expiresAt, now)).run();
	db()
		.insert(aiTokens)
		.values([
			{ id: hashToken(access), connectionId, kind: 'access', expiresAt: now + ACCESS_LIFETIME },
			{ id: hashToken(refresh), connectionId, kind: 'refresh', expiresAt: now + REFRESH_LIFETIME }
		])
		.run();
	return {
		status: 200,
		body: {
			access_token: access,
			token_type: 'Bearer',
			expires_in: ACCESS_LIFETIME / 1000,
			refresh_token: refresh
		}
	};
}

/** The connection's stored code or refresh token, used up whether it turns out to fit or not. */
function useToken(connectionId: number, kind: 'code' | 'refresh', token: string, now: number) {
	const row = db()
		.select()
		.from(aiTokens)
		.where(and(eq(aiTokens.id, hashToken(token)), eq(aiTokens.kind, kind)))
		.get();
	if (!row) return null;
	db().delete(aiTokens).where(eq(aiTokens.id, row.id)).run();
	return row.connectionId === connectionId && row.expiresAt > now ? row : null;
}

/**
 * The token endpoint (RFC 6749): exchanges a code, with its PKCE verifier, or a refresh token for
 * a new access token and refresh token. A code or refresh token works once.
 */
export function exchangeToken(
	form: URLSearchParams,
	authorization: string | null,
	issuer: string,
	now: number
): OAuthAnswer {
	const client = authenticateClient(form, authorization);
	if (!client) return oauthError(401, 'invalid_client', 'Unknown client, or the wrong secret');
	const resource = form.get('resource');
	if (resource !== null && resource !== mcpResource(issuer)) {
		return oauthError(400, 'invalid_target', `Meals's MCP server is ${mcpResource(issuer)}`);
	}
	const grantType = form.get('grant_type');
	if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
		return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
	}
	const token = form.get(grantType === 'authorization_code' ? 'code' : 'refresh_token');
	const verifier = form.get('code_verifier');
	if (token === null || (grantType === 'authorization_code' && verifier === null)) {
		const needed = 'Send the code and its code_verifier, or the refresh_token';
		return oauthError(400, 'invalid_request', needed);
	}

	return transaction(() => {
		if (grantType === 'refresh_token') {
			if (!useToken(client.id, 'refresh', token, now)) {
				return oauthError(400, 'invalid_grant', 'The refresh token is unknown, used or expired');
			}
			return issueTokens(client.id, now);
		}
		const code = useToken(client.id, 'code', token, now);
		const challenge = createHash('sha256')
			.update(verifier ?? '')
			.digest('base64url');
		if (
			!code ||
			code.redirectUri !== form.get('redirect_uri') ||
			code.codeChallenge !== challenge
		) {
			const wrong = "The code is unknown, used or expired, or doesn't match";
			return oauthError(400, 'invalid_grant', wrong);
		}
		return issueTokens(client.id, now);
	});
}

export type AiConnection = { id: number; platform: AiPlatform };

/**
 * The connection an access token is for, or null when it's unknown or expired, or the admin who
 * allowed the connection isn't the admin anymore (design 6.17). Notes when it was last used.
 */
export function validateAccessToken(
	token: string,
	adminEmail: string,
	now: number
): AiConnection | null {
	const row = db()
		.select({
			id: aiConnections.id,
			platform: aiConnections.platform,
			expiresAt: aiTokens.expiresAt,
			email: users.email
		})
		.from(aiTokens)
		.innerJoin(aiConnections, eq(aiConnections.id, aiTokens.connectionId))
		.innerJoin(users, eq(users.id, aiConnections.userId))
		.where(and(eq(aiTokens.id, hashToken(token)), eq(aiTokens.kind, 'access')))
		.get();
	if (!row || row.expiresAt <= now || row.email !== adminEmail) return null;
	db().update(aiConnections).set({ lastUsedAt: now }).where(eq(aiConnections.id, row.id)).run();
	return { id: row.id, platform: row.platform };
}

export type ConnectionSummary = {
	id: number;
	platform: AiPlatform;
	authorizedAt: number;
	lastUsedAt: number | null;
};

/** The connections the admin allowed, newest first, for Admin (design 7). */
export function listConnections(): ConnectionSummary[] {
	return db()
		.select({
			id: aiConnections.id,
			platform: aiConnections.platform,
			authorizedAt: aiConnections.authorizedAt,
			lastUsedAt: aiConnections.lastUsedAt
		})
		.from(aiConnections)
		.where(isNotNull(aiConnections.authorizedAt))
		.orderBy(desc(aiConnections.authorizedAt), desc(aiConnections.id))
		.all()
		.map(({ authorizedAt, ...connection }) => {
			if (authorizedAt === null) throw new Error(`Connection ${connection.id} isn't allowed`);
			return { ...connection, authorizedAt };
		});
}

/**
 * Deletes the connection with its tokens, so the assistant can't use Meals anymore, and its
 * proposals, so none of them can be approved (design 6.17). One already revoked counts as revoked.
 */
export function revokeConnection(connectionId: number): void {
	db().delete(aiConnections).where(eq(aiConnections.id, connectionId)).run();
}
