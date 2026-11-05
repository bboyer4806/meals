import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { checkBodySize } from '#lib/server/body-size.ts';
import { config, loadConfig } from '#lib/server/config.ts';
import { addStandardItemsToAllHouseholds } from '#lib/server/data/households.ts';
import { openDb } from '#lib/server/db/index.ts';
import { assignAllStandardImages, checkLibrary } from '#lib/server/standard-images.ts';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSession
} from '#lib/server/auth/session.ts';

export const init: ServerInit = async () => {
	const { DATA_DIR } = loadConfig(process.env);
	// Never create it: a missing directory in production means the storage mount is missing,
	// and writing anyway would put the database where the next deploy deletes it.
	if (!existsSync(DATA_DIR)) throw new Error(`DATA_DIR ${DATA_DIR} does not exist`);
	checkLibrary();
	openDb(join(DATA_DIR, 'meals.db'));
	const now = Date.now();
	// Households set up before the standard items get them, once each (design 6.13).
	addStandardItemsToAllHouseholds(now);
	// Items not yet checked for a standard image get theirs: every item when the images came, and
	// any a save couldn't finish or the version a deploy replaces made (design 6.14).
	await assignAllStandardImages(now);
};

export const handle: Handle = async ({ event, resolve }) => {
	// First, so a body too large to read is refused before anything reads it (4.5).
	checkBodySize(event.request, event.route.id);
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
	const response = await resolve(event);
	// Back must not show a stored copy of a page (6.11). Photos set their own cache and keep it.
	if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'no-store');
	return response;
};
