import { json } from '@sveltejs/kit';
import { authorizationServerMetadata } from '#lib/server/auth/oauth.ts';

// How ChatGPT and Claude find where to register, ask the admin and get tokens (RFC 8414, 6.17).
export function GET({ url }) {
	return json(authorizationServerMetadata(url.origin));
}
