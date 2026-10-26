import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPage, jsonLdBlocks } from './recipe-page.ts';
import { servePages } from './testing.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

const PIE = 'https://recipes.example/pie';

// Addresses on this computer or a network beside it, written in the link.
const PRIVATE_LINKS = [
	'http://127.0.0.1/',
	'http://10.0.0.1/',
	'http://192.168.1.1/',
	'http://169.254.169.254/latest/meta-data/',
	'http://[::1]/',
	'http://0.0.0.0/',
	'http://172.16.0.1/',
	'http://100.64.0.1/',
	'http://[fe80::1]/',
	'http://[fd00::1]/',
	'http://[::ffff:169.254.169.254]/',
	// 127.0.0.1 as one number.
	'https://2130706433:8443/'
];

describe('fetchPage', () => {
	it("gets a page's HTML", async () => {
		const requested = servePages({ [PIE]: { status: 200, body: '<h1>Pie</h1>' } });
		expect(await fetchPage(new URL(PIE))).toBe('<h1>Pie</h1>');
		expect(requested).toEqual([PIE]);
	});

	it('gets a page from a public address written in the link', async () => {
		servePages({ 'http://93.184.215.14/pie': { status: 200, body: 'Pie' } });
		expect(await fetchPage(new URL('http://93.184.215.14/pie'))).toBe('Pie');
	});

	it.each(['ftp://recipes.example/pie', 'file:///etc/passwd', 'data:text/html,<p>Pie</p>'])(
		'only fetches http and https, not %s',
		async (link) => {
			const requested = servePages({});
			await expect(fetchPage(new URL(link))).rejects.toThrow("links can't be fetched");
			expect(requested).toEqual([]);
		}
	);

	it.each(PRIVATE_LINKS)('refuses %s without connecting', async (link) => {
		const requested = servePages({});
		await expect(fetchPage(new URL(link))).rejects.toThrow('is a private address');
		expect(requested).toEqual([]);
	});

	it('refuses a name with a private address as it connects', async () => {
		const requested = servePages({});
		await expect(fetchPage(new URL('http://localhost:5173/'))).rejects.toThrow(
			/^localhost is at (127\.0\.0\.1|::1), a private address$/
		);
		expect(requested).toEqual(['http://localhost:5173/']);
	});

	it.each([...PRIVATE_LINKS, 'http://localhost/', 'ftp://recipes.example/pie'])(
		'refuses a redirect to %s',
		async (target) => {
			const requested = servePages({ [PIE]: { status: 302, headers: { location: target } } });
			await expect(fetchPage(new URL(PIE))).rejects.toThrow(
				/a private address$|links can't be fetched$/
			);
			// Only a name is requested, and it's refused as it connects.
			expect(requested).toEqual(target === 'http://localhost/' ? [PIE, target] : [PIE]);
		}
	);

	it('follows redirects one at a time', async () => {
		const requested = servePages({
			'http://recipes.example/pie': { status: 301, headers: { location: PIE } },
			[PIE]: { status: 302, headers: { location: '/recipes/pie?print=1' } },
			'https://recipes.example/recipes/pie?print=1': { status: 200, body: 'Pie' }
		});
		expect(await fetchPage(new URL('http://recipes.example/pie'))).toBe('Pie');
		expect(requested).toEqual([
			'http://recipes.example/pie',
			PIE,
			'https://recipes.example/recipes/pie?print=1'
		]);
	});

	it('follows up to 5 redirects', async () => {
		// Each page redirects to the next, and the last is the recipe.
		const chain = (redirects: number) => {
			const pages: Record<string, { status: number; headers?: Record<string, string> }> = {};
			for (let page = 0; page < redirects; page += 1) {
				pages[`https://recipes.example/${page}`] = {
					status: 307,
					headers: { location: `/${page + 1}` }
				};
			}
			pages[`https://recipes.example/${redirects}`] = { status: 200 };
			return pages;
		};
		servePages(chain(5));
		expect(await fetchPage(new URL('https://recipes.example/0'))).toBe('');

		vi.restoreAllMocks();
		const requested = servePages(chain(6));
		await expect(fetchPage(new URL('https://recipes.example/0'))).rejects.toThrow(
			'https://recipes.example/0 redirects too many times'
		);
		expect(requested).toHaveLength(6);
	});

	it("fails when the page doesn't answer 200", async () => {
		servePages({
			[PIE]: { status: 403, body: 'Forbidden' },
			'https://recipes.example/moved': { status: 301 }
		});
		await expect(fetchPage(new URL(PIE))).rejects.toThrow(`${PIE} answered 403`);
		// A redirect without a Location.
		await expect(fetchPage(new URL('https://recipes.example/moved'))).rejects.toThrow(
			'answered 301'
		);
	});

	it('stops reading after 5 MB', async () => {
		servePages({
			'https://recipes.example/big': { status: 200, body: Buffer.alloc(5_000_001, 'a') },
			'https://recipes.example/fits': { status: 200, body: Buffer.alloc(5_000_000, 'a') }
		});
		await expect(fetchPage(new URL('https://recipes.example/big'))).rejects.toThrow(
			'The page is over 5000000 bytes'
		);
		expect(await fetchPage(new URL('https://recipes.example/fits'))).toHaveLength(5_000_000);
	});

	it('gives every request, and reading the page, 10 seconds in all', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		servePages({
			'http://recipes.example/pie': { status: 301, headers: { location: PIE } },
			[PIE]: { status: 200, body: 'Pie' }
		});
		await fetchPage(new URL('http://recipes.example/pie'));
		expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
		// Aborting a request also stops reading its answer.
		const signal = timeout.mock.results[0]?.value;
		const requests = [...vi.mocked(http.get).mock.calls, ...vi.mocked(https.get).mock.calls];
		expect(requests.map(([, options]) => options)).toEqual([
			expect.objectContaining({ signal }),
			expect.objectContaining({ signal })
		]);
	});
});

describe('jsonLdBlocks', () => {
	it('reads the JSON-LD of a saved recipe page', () => {
		// The page's head, among 26 other scripts.
		const html = readFileSync('src/lib/test-pages/kingarthurbaking.html', 'utf8');
		const blocks = jsonLdBlocks(html);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			'@graph': [{ '@type': 'Recipe', name: 'Spiced Rye Ginger Cookies' }]
		});
	});

	it("reads the type with or without quotes, and leaves out blocks that aren't JSON-LD", () => {
		const html = [
			'<script type=application/ld+json class=yoast-schema-graph>{"@type":"WebSite"}</script>',
			`<SCRIPT data-testid="schema" TYPE='Application/LD+JSON'>[{"@type":"Recipe"}]</SCRIPT >`,
			'<script type="application/ld+json">{ not JSON }</script>',
			'<script type="application/json">{"@type":"Recipe"}</script>',
			'<script data-type="application/ld+json">{"@type":"Recipe"}</script>',
			'<script>const recipe = {"@type":"Recipe"};</script>'
		].join('\n');
		expect(jsonLdBlocks(html)).toEqual([{ '@type': 'WebSite' }, [{ '@type': 'Recipe' }]]);
	});

	it('reads a page written to be slow to search as fast as any other', () => {
		const started = performance.now();
		// 1 MB each of tags that never close, and of elements that never end.
		expect(jsonLdBlocks('<script '.repeat(125_000))).toEqual([]);
		expect(jsonLdBlocks('<script type=application/ld+json>'.repeat(30_000))).toEqual([]);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
