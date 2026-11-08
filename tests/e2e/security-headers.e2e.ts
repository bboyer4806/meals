import { expect, test } from './fixtures.ts';

// Pages and endpoints send these (design 4.5). nginx on the server adds strict-transport-security.
const HEADERS = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

test("sends the security headers, and keeps a page's Content Security Policy", async ({
	request
}) => {
	const page = await request.get('/login');
	expect(page.status()).toBe(200);
	expect(page.headers()).toMatchObject(HEADERS);
	// SvelteKit's policy (vite.config.ts), not the one an error page gets.
	const policy = page.headers()['content-security-policy'];
	expect(policy).toContain("script-src 'self' 'nonce-");
	expect(policy).toContain("frame-ancestors 'none'");

	const health = await request.get('/healthz');
	expect(health.status()).toBe(200);
	expect(health.headers()).toMatchObject(HEADERS);
	expect(health.headers()['content-security-policy']).toBeUndefined();
});

test("keeps other sites from framing an endpoint's error page", async ({ page, person: _ }) => {
	// A photo that isn't there, opened in a tab of its own.
	const response = await page.request.get(`/photos/${'0'.repeat(32)}.jpg`, {
		headers: { accept: 'text/html' }
	});
	expect(response.status()).toBe(404);
	expect(await response.text()).toContain('Not found');
	expect(response.headers()).toMatchObject({
		...HEADERS,
		'content-type': 'text/html; charset=utf-8',
		'content-security-policy': "frame-ancestors 'none'"
	});
});
