import { error, json } from '@sveltejs/kit';
import { protectedResourceMetadata } from '#lib/server/auth/oauth.ts';

// How ChatGPT and Claude find who signs them in to the MCP endpoint (RFC 9728, design 6.17): its
// own address, with the endpoint's path after the well-known one, and the bare well-known address
// that some look at first.
export function GET({ params, url }) {
	if (params.path !== '' && params.path !== 'mcp') error(404, 'Not found');
	return json(protectedResourceMetadata(url.origin));
}
