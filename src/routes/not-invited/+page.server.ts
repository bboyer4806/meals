import { NOT_INVITED_COOKIE } from '#lib/server/auth/sign-in.ts';

export function load({ cookies }) {
	return { email: cookies.get(NOT_INVITED_COOKIE) ?? null };
}
