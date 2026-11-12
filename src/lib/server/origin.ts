import { error } from '@sveltejs/kit';
import type { RouteId } from '$app/types';

// Forms sent to Meals from another site are refused (design 4.5), as SvelteKit's own check refuses
// them. That check is turned off (vite.config.ts) because it can't leave out a route, and OAuth's
// token endpoint takes forms from ChatGPT's and Claude's servers, which send no Origin (RFC 6749,
// design 6.17). This is the same check, with that one route left out.

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes that take forms from other servers: only OAuth's token endpoint (design 6.17). */
const SERVER_FORM_ROUTES = new Set<RouteId>(['/oauth/token']);

/**
 * Refuses (403) a POST, PUT, PATCH or DELETE that has a form's content type, or none, and whose
 * Origin isn't this site's, as SvelteKit does.
 */
export function checkOrigin(request: Request, url: URL, routeId: RouteId | null): void {
	if (!CHANGING_METHODS.has(request.method)) return;
	if (routeId !== null && SERVER_FORM_ROUTES.has(routeId)) return;
	const type = request.headers.get('content-type');
	const isForm = !type || FORM_TYPES.includes(type.split(';', 1)[0]!.trim().toLowerCase());
	if (!isForm || request.headers.get('origin') === url.origin) return;
	error(403, `Cross-site ${request.method} form submissions are forbidden`);
}
