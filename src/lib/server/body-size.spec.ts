import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import type { RouteId } from '$app/types';
import { checkBodySize, MAX_BODY_BYTES } from './body-size.ts';

const URL_ENCODED = 'application/x-www-form-urlencoded';
// As Chrome sends it.
const MULTIPART = 'multipart/form-data; boundary=----WebKitFormBoundaryq3TqUvBbVRq4QAsT';
const FILE_ROUTES: RouteId[] = [
	'/(app)/recipes/new',
	'/(app)/recipes/[id]/edit',
	'/(app)/recipes/import',
	'/(app)/feedback'
];
const PHOTO_SAVE = 5 * 1024 * 1024;

/** A POST stating this length, or none for null. */
function post(length: number | null, contentType: string | null): Request {
	const headers = new Headers();
	if (contentType !== null) headers.set('content-type', contentType);
	if (length !== null) headers.set('content-length', String(length));
	return new Request('http://localhost/', { method: 'POST', headers });
}

/** The status the request is refused with, or null when its body may be read. */
function refusal(request: Request, routeId: RouteId | null): number | null {
	try {
		checkBodySize(request, routeId);
		return null;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

describe('checkBodySize', () => {
	it('reads a body up to 64 KB on any route', () => {
		expect(refusal(post(MAX_BODY_BYTES, URL_ENCODED), '/(app)/groceries')).toBeNull();
		expect(refusal(post(MAX_BODY_BYTES, MULTIPART), '/(app)/menu/[date]')).toBeNull();
		expect(refusal(post(MAX_BODY_BYTES, URL_ENCODED), '/(app)/recipes/new')).toBeNull();
		expect(refusal(post(0, null), '/logout')).toBeNull();
		expect(refusal(post(MAX_BODY_BYTES, URL_ENCODED), null)).toBeNull();
	});

	it('refuses a larger body on a route that takes no files', () => {
		expect(refusal(post(MAX_BODY_BYTES + 1, URL_ENCODED), '/(app)/groceries')).toBe(413);
		expect(refusal(post(PHOTO_SAVE, MULTIPART), '/(app)/menu/[date]')).toBe(413);
		expect(refusal(post(MAX_BODY_BYTES + 1, MULTIPART), '/(app)/recipes/[id]')).toBe(413);
		expect(refusal(post(MAX_BODY_BYTES + 1, MULTIPART), null)).toBe(413);
	});

	it('reads a larger multipart body on the recipe editor, Import recipes and feedback', () => {
		for (const route of FILE_ROUTES) {
			expect(refusal(post(PHOTO_SAVE, MULTIPART), route), route).toBeNull();
		}
	});

	it('refuses a larger body to the routes that take files unless it is multipart', () => {
		for (const route of FILE_ROUTES) {
			expect(refusal(post(MAX_BODY_BYTES + 1, URL_ENCODED), route), route).toBe(413);
			expect(refusal(post(PHOTO_SAVE, 'text/plain'), route), route).toBe(413);
			expect(refusal(post(PHOTO_SAVE, null), route), route).toBe(413);
		}
	});

	it('refuses a larger body whose type only starts as multipart', () => {
		// Node reads the form as the last type in the list, so this one as URL-encoded.
		const urlEncoded = 'multipart/form-data; boundary=x, application/x-www-form-urlencoded';
		expect(refusal(post(PHOTO_SAVE, urlEncoded), '/(app)/recipes/new')).toBe(413);
		expect(refusal(post(PHOTO_SAVE, 'multipart/form-data'), '/(app)/recipes/new')).toBe(413);
		expect(refusal(post(PHOTO_SAVE, 'multipart/mixed; boundary=x'), '/(app)/recipes/new')).toBe(
			413
		);
	});

	it("refuses a POST that doesn't state its length", () => {
		expect(refusal(post(null, URL_ENCODED), '/(app)/groceries')).toBe(411);
		expect(refusal(post(null, MULTIPART), '/(app)/recipes/new')).toBe(411);
		expect(refusal(post(null, null), '/logout')).toBe(411);
	});

	it('reads a request without a body', () => {
		expect(refusal(new Request('http://localhost/'), '/(app)/groceries')).toBeNull();
		expect(refusal(new Request('http://localhost/', { method: 'HEAD' }), null)).toBeNull();
	});
});
