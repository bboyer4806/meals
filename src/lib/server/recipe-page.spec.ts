import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPage, jsonLdBlocks } from './recipe-page.ts';
import { servePages } from './testing.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

const PIE = 'https://recipes.example/pie';

// Text with characters UTF-8 writes differently, and as windows-1252 writes it: ’ is 0x92, and
// é, ½ and ° are as ISO-8859-1 has them.
const BRULEE = '<h1>Grandma’s crème brûlée</h1><p>½ cup sugar at 325°F</p>';
const BRULEE_1252 = Buffer.from(BRULEE.replace('’', '\x92'), 'latin1');

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

	it('reads the page in the charset its Content-Type names', async () => {
		servePages({
			[PIE]: {
				status: 200,
				headers: { 'content-type': 'text/html; charset=ISO-8859-1' },
				body: BRULEE_1252
			}
		});
		// As browsers do, ISO-8859-1 is read as windows-1252, which has ’.
		expect(await fetchPage(new URL(PIE))).toBe(BRULEE);
	});

	it.each([
		'<meta charset="windows-1252">',
		"<META CHARSET='Windows-1252'/>",
		'<meta charset=latin1>',
		'<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">',
		'<meta content="text/html;charset=ISO-8859-1" http-equiv=content-type>'
	])("reads the charset of a meta element in the page's first 1,024 bytes: %s", async (meta) => {
		const head = `<head><meta name="viewport" content="width=device-width">${meta}</head>`;
		servePages({
			[PIE]: {
				status: 200,
				headers: { 'content-type': 'text/html' },
				body: Buffer.concat([Buffer.from(head), BRULEE_1252])
			}
		});
		expect(await fetchPage(new URL(PIE))).toBe(`${head}${BRULEE}`);
	});

	it("reads the Content-Type's charset over a meta element's", async () => {
		const page = `<meta charset="windows-1252">${BRULEE}`;
		servePages({
			[PIE]: { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: page }
		});
		expect(await fetchPage(new URL(PIE))).toBe(page);
	});

	it('reads UTF-8 when the Content-Type and first 1,024 bytes name no charset', async () => {
		/** windows-1252 text after a meta element that starts this many bytes in. */
		const metaAt = (bytes: number, charset: string) =>
			Buffer.concat([
				Buffer.from(`<!--${' '.repeat(bytes - 7)}--><meta charset=${charset}>`),
				BRULEE_1252
			]);
		servePages({
			'https://recipes.example/plain': { status: 200, body: BRULEE },
			'https://recipes.example/html': {
				status: 200,
				headers: { 'content-type': 'text/html' },
				body: BRULEE
			},
			'https://recipes.example/late': { status: 200, body: metaAt(1024, 'windows-1252') },
			// The first 1,024 bytes end after "iso-8859-1".
			'https://recipes.example/cut-off': { status: 200, body: metaAt(1000, 'iso-8859-15') }
		});
		expect(await fetchPage(new URL('https://recipes.example/plain'))).toBe(BRULEE);
		expect(await fetchPage(new URL('https://recipes.example/html'))).toBe(BRULEE);
		for (const link of ['https://recipes.example/late', 'https://recipes.example/cut-off']) {
			expect(await fetchPage(new URL(link))).toContain('Grandma�s cr�me br�l�e');
		}
	});

	it("can't read a charset it doesn't know", async () => {
		servePages({
			[PIE]: { status: 200, headers: { 'content-type': 'text/html; charset=x-pie' }, body: 'Pie' }
		});
		await expect(fetchPage(new URL(PIE))).rejects.toThrow('The "x-pie" encoding is not supported');
	});

	it('unzips a page sent gzipped, then reads its charset', async () => {
		const meta = '<meta charset="windows-1252">';
		servePages({
			[PIE]: {
				status: 200,
				headers: { 'content-encoding': 'gzip' },
				body: gzipSync(Buffer.concat([Buffer.from(meta), BRULEE_1252]))
			},
			'https://recipes.example/tart': {
				status: 200,
				headers: { 'content-encoding': 'identity' },
				body: 'Tart'
			}
		});
		expect(await fetchPage(new URL(PIE))).toBe(`${meta}${BRULEE}`);
		expect(await fetchPage(new URL('https://recipes.example/tart'))).toBe('Tart');
	});

	it('stops unzipping after 5 MB', async () => {
		const gzipped = (bytes: number) => ({
			status: 200,
			headers: { 'content-encoding': 'gzip' },
			body: gzipSync(Buffer.alloc(bytes, 'a'))
		});
		servePages({
			'https://recipes.example/big': gzipped(5_000_001),
			'https://recipes.example/fits': gzipped(5_000_000)
		});
		await expect(fetchPage(new URL('https://recipes.example/big'))).rejects.toThrow(
			'Cannot create a Buffer larger than 5000000 bytes'
		);
		expect(await fetchPage(new URL('https://recipes.example/fits'))).toHaveLength(5_000_000);
	});

	it.each(['br', 'deflate', 'gzip, gzip'])("can't read a page compressed as %s", async (coding) => {
		servePages({ [PIE]: { status: 200, headers: { 'content-encoding': coding }, body: 'Pie' } });
		await expect(fetchPage(new URL(PIE))).rejects.toThrow(`The page is compressed as ${coding}`);
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
