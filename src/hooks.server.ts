import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { checkBodySize } from '#lib/server/body-size.ts';
import { config, loadConfig } from '#lib/server/config.ts';
import { addStandardItemsToAllHouseholds } from '#lib/server/data/households.ts';
import { openDb } from '#lib/server/db/index.ts';
import { assignAllStandardImages, checkLibrary } from '#lib/server/standard-images.ts';
import {
	deleteSessionCookie,
	sessionCookieName,
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
	const token = event.cookies.get(sessionCookieName(event.url));
	if (token) {
		const session = validateSession(token, config().ADMIN_EMAIL, Date.now());
		if (session) {
			event.locals.user = session.user;
			if (session.renewed) setSessionCookie(event.cookies, event.url, token, session.expiresAt);
		} else {
			deleteSessionCookie(event.cookies, event.url);
		}
	}
	const response = await resolve(event);
	// Back must not show a stored copy of a page (6.11). Photos set their own cache and keep it.
	if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'no-store');
	setSecurityHeaders(response.headers);
	return response;
};

/**
 * The security headers on every page and endpoint response (4.5). nginx on the server adds
 * strict-transport-security.
 */
function setSecurityHeaders(headers: Headers): void {
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	// Leaves screen-wake-lock allowed, so the cooking view can keep the screen on (7).
	headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
	// Pages get SvelteKit's policy (vite.config.ts). An endpoint's error page, such as a cancelled
	// sign-in's, has none, so this one keeps other sites from framing it.
	if (
		headers.get('content-type')?.startsWith('text/html') &&
		!headers.has('content-security-policy')
	) {
		headers.set('content-security-policy', "frame-ancestors 'none'");
	}
}
