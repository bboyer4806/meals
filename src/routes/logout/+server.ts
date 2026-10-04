import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteSession, deleteSessionCookie } from '#lib/server/auth/session.ts';

export function POST({ cookies }) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteSession(token);
	deleteSessionCookie(cookies);
	redirect(303, '/login');
}
