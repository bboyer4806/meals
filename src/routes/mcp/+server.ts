import { json } from '@sveltejs/kit';
import { handleMessage, PROTOCOL_VERSIONS, rpcError } from '#lib/server/ai/mcp.ts';
import { resourceMetadataUrl, validateAccessToken } from '#lib/server/auth/oauth.ts';
import { config } from '#lib/server/config.ts';

// The MCP endpoint ChatGPT and Claude connect to (design 6.17): Streamable HTTP, answering each
// request with JSON, and only for an access token from a connection the admin allowed.

/** Points a client without a working token at how to get one (RFC 9728, RFC 6750). */
function unauthorized(origin: string, sentToken: boolean): Response {
	const challenge = [`Bearer resource_metadata="${resourceMetadataUrl(origin)}"`];
	if (sentToken) challenge.push('error="invalid_token"');
	const body = sentToken
		? { error: 'invalid_token', error_description: 'The access token is unknown or expired' }
		: { error: 'unauthorized', error_description: 'Connect with OAuth to use Meals' };
	return json(body, { status: 401, headers: { 'www-authenticate': challenge.join(', ') } });
}

export async function POST({ request, url }) {
	const now = Date.now();
	const authorization = request.headers.get('authorization');
	const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
	const connection = token === null ? null : validateAccessToken(token, config().ADMIN_EMAIL, now);
	if (!connection) return unauthorized(url.origin, token !== null);

	const version = request.headers.get('mcp-protocol-version');
	if (version !== null && !PROTOCOL_VERSIONS.includes(version)) {
		return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${version}`), {
			status: 400
		});
	}
	let message: unknown;
	try {
		message = await request.json();
	} catch {
		return json(rpcError(null, -32700, 'Parse error'), { status: 400 });
	}
	const answer = handleMessage(message, { connectionId: connection.id, origin: url.origin, now });
	return answer === null ? new Response(null, { status: 202 }) : json(answer);
}

// No stream of messages from the server, and no sessions to end (MCP, Streamable HTTP).
function notAllowed(): Response {
	return new Response(null, { status: 405, headers: { allow: 'POST' } });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
