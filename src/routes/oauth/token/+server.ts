import { json } from '@sveltejs/kit';
import { exchangeToken } from '#lib/server/auth/oauth.ts';

// ChatGPT's or Claude's server exchanges a code or a refresh token for tokens (RFC 6749, design
// 6.17). It sends a form with no Origin, so hooks.server.ts lets this route take forms from other
// sites (origin.ts).
export async function POST({ request, url }) {
	const type = request.headers.get('content-type') ?? '';
	if (!type.startsWith('application/x-www-form-urlencoded')) {
		const description = 'Send the request as application/x-www-form-urlencoded';
		return json({ error: 'invalid_request', error_description: description }, { status: 400 });
	}
	const form = new URLSearchParams(await request.text());
	const answer = exchangeToken(form, request.headers.get('authorization'), url.origin, Date.now());
	return json(answer.body, { status: answer.status });
}
