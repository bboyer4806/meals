import { error } from '@sveltejs/kit';
import type { RouteId } from '$app/types';

// Request bodies are checked by the length a request states, before anything reads them
// (design 4.5, MEA-66). Reading a URL-encoded form takes time that grows with the square of its
// length, so a few large posts a second would hold up the server for every household. The
// largest form people send this way, a dinner's note or feedback, comes to about 25 KB.

export const MAX_BODY_BYTES = 64 * 1024;

// The recipe editor and Import recipes send a photo or a file as multipart/form-data, up to
// BODY_SIZE_LIMIT (Dockerfile).
const FILE_ROUTES = new Set<RouteId>([
	'/(app)/recipes/new',
	'/(app)/recipes/[id]/edit',
	'/(app)/recipes/import'
]);

/**
 * Whether the body is multipart/form-data. A comma would let a second type follow, such as
 * application/x-www-form-urlencoded, which Node then reads the form as.
 */
function isMultipart(request: Request): boolean {
	const type = request.headers.get('content-type') ?? '';
	return type.startsWith('multipart/form-data;') && !type.includes(',');
}

/**
 * Refuses a request before its body is read: a POST that doesn't state its body's length (411),
 * and a body over MAX_BODY_BYTES (413), unless it's multipart/form-data to the recipe editor or
 * Import recipes.
 */
export function checkBodySize(request: Request, routeId: RouteId | null): void {
	const length = request.headers.get('content-length');
	if (length === null) {
		if (request.method === 'POST') error(411, 'Send the length of the request body.');
		return;
	}
	if (Number(length) <= MAX_BODY_BYTES) return;
	if (routeId !== null && FILE_ROUTES.has(routeId) && isMultipart(request)) return;
	error(413, "That's too much to send at once.");
}
