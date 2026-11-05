import { readFileSync } from 'node:fs';
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

// Fetching itself, only from a public website, is fetch-link.spec.ts.
describe('fetchPage', () => {
	it("gets a page's HTML, asking for HTML as Meals recipe import", async () => {
		const requested = servePages({ [PIE]: { status: 200, body: '<h1>Pie</h1>' } });
		expect(await fetchPage(new URL(PIE))).toBe('<h1>Pie</h1>');
		expect(requested).toEqual([PIE]);
		const headers = {
			accept: 'text/html,application/xhtml+xml',
			'user-agent': 'Mozilla/5.0 (compatible; Meals recipe import)',
			'accept-encoding': 'identity'
		};
		expect(https.get).toHaveBeenCalledExactlyOnceWith(
			expect.anything(),
			expect.objectContaining({ headers }),
			expect.any(Function)
		);
	});

	it('refuses a link to this computer, as fetchLink does', async () => {
		const requested = servePages({});
		await expect(fetchPage(new URL('http://127.0.0.1/'))).rejects.toThrow(
			'127.0.0.1 is a private address'
		);
		expect(requested).toEqual([]);
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
			}
		});
		expect(await fetchPage(new URL(PIE))).toBe(`${meta}${BRULEE}`);
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
