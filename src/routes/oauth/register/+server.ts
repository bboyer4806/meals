import { json } from '@sveltejs/kit';
import { registerClient } from '#lib/server/auth/oauth.ts';

// ChatGPT or Claude registers itself before asking the admin to allow it (RFC 7591, design 6.17).
export async function POST({ request }) {
	// Anything that isn't JSON is refused as client metadata that isn't valid.
	const metadata: unknown = await request.json().catch(() => null);
	const answer = registerClient(metadata, Date.now());
	return json(answer.body, { status: answer.status });
}
