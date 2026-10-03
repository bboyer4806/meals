import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { config, loadConfig } from '#lib/server/config.ts';
import { openDb } from '#lib/server/db/index.ts';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSession
} from '#lib/server/auth/session.ts';

export const init: ServerInit = () => {
	const { DATA_DIR } = loadConfig(process.env);
	// Never create it: a missing directory in production means the storage mount is missing,
	// and writing anyway would put the database where the next deploy deletes it.
	if (!existsSync(DATA_DIR)) throw new Error(`DATA_DIR ${DATA_DIR} does not exist`);
	openDb(join(DATA_DIR, 'meals.db'));
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = validateSession(token, config().ADMIN_EMAIL, Date.now());
		if (session) {
			event.locals.user = session.user;
			if (session.renewed) setSessionCookie(event.cookies, token, session.expiresAt);
		} else {
			deleteSessionCookie(event.cookies);
		}
	}
	return resolve(event);
};
