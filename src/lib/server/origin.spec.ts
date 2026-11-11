import type { RouteId } from '$app/types';
import { expect, it } from 'vitest';
import { checkOrigin } from './origin.ts';
import { expectHttpError } from './testing.ts';

const SITE = 'https://meals.dev.boyersoftware.com';

function sent(
	method: string,
	headers: Record<string, string>,
	routeId: RouteId | null = '/(app)/groceries'
): () => void {
	const url = new URL(`${SITE}/groceries?/add`);
	return () => checkOrigin(new Request(url, { method, headers }), url, routeId);
}

it("refuses a form from another site, or one that doesn't say where it's from (4.5)", () => {
	const form = 'application/x-www-form-urlencoded';
	expectHttpError(sent('POST', { 'content-type': form, origin: 'https://evil.example' }), 403);
	expectHttpError(sent('POST', { 'content-type': form }), 403);
	expectHttpError(sent('POST', {}), 403);
	expectHttpError(sent('POST', { 'content-type': '' }), 403);
	expectHttpError(sent('POST', { 'content-type': 'Multipart/Form-Data; boundary=x' }), 403);
	expectHttpError(sent('DELETE', { 'content-type': 'text/plain;charset=UTF-8' }), 403);
	expectHttpError(sent('PUT', { 'content-type': form, origin: 'http://meals.dev.boyersoftware.com' }), 403);
});

it("takes a form from this site, and requests that aren't forms", () => {
	const form = 'application/x-www-form-urlencoded';
	expect(sent('POST', { 'content-type': form, origin: SITE })).not.toThrow();
	expect(sent('POST', { 'content-type': 'application/json' })).not.toThrow();
	expect(sent('GET', { origin: 'https://evil.example' })).not.toThrow();
});

it("takes forms from other servers on OAuth's token endpoint only (design 6.17)", () => {
	const form = { 'content-type': 'application/x-www-form-urlencoded' };
	expect(sent('POST', form, '/oauth/token')).not.toThrow();
	expectHttpError(sent('POST', form, '/oauth/register'), 403);
	expectHttpError(sent('POST', form, null), 403);
});
