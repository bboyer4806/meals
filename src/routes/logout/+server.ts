import { redirect } from '@sveltejs/kit';
import { deleteSession, deleteSessionCookie, sessionCookieName } from '#lib/server/auth/session.ts';

export function POST({ cookies, url }) {
	const token = cookies.get(sessionCookieName(url));
	if (token) deleteSession(token);
	deleteSessionCookie(cookies, url);
	redirect(303, '/login');
}
