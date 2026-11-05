import { fetchLink } from './fetch-link.ts';

// Import from a link (design 7) fetches the recipe's page on the server, only from a public
// website (fetch-link.ts, design 4.5), and reads its JSON-LD.

const HEADERS = {
	accept: 'text/html,application/xhtml+xml',
	'user-agent': 'Mozilla/5.0 (compatible; Meals recipe import)'
};

// The charset of a Content-Type such as "text/html; charset=windows-1252", and of a meta element
// such as <meta charset="iso-8859-1"> or an http-equiv whose content is a Content-Type. A meta
// element's charset must end before the bytes searched do, or iso-8859-15 could be read as
// iso-8859-1.
const CHARSET = /\bcharset\s*=\s*["']?([\w.:-]+)/i;
const META_CHARSET = /<meta\b[^>]*?\bcharset\s*=\s*["']?([\w.:-]+)(?![\w.:-]|$)/i;

/**
 * The page's text, in the charset its Content-Type names, else the charset of a meta element
 * in its first 1,024 bytes, else UTF-8 (design 7). TextDecoder reads the names as browsers do,
 * so ISO-8859-1 is read as windows-1252. Throws for a charset it doesn't know.
 */
function decode(body: Buffer, contentType = ''): string {
	// Byte for byte, as a meta element is written in ASCII.
	const start = body.subarray(0, 1024).toString('latin1');
	const charset = CHARSET.exec(contentType)?.[1] ?? META_CHARSET.exec(start)?.[1] ?? 'utf-8';
	return new TextDecoder(charset).decode(body);
}

/**
 * A web page's HTML, unzipped and decoded by its charset. Throws if fetchLink can't get it, or if
 * its charset isn't known.
 */
export async function fetchPage(link: URL): Promise<string> {
	const { body, contentType } = await fetchLink(link, HEADERS);
	return decode(body, contentType);
}

// A script tag whose type is JSON-LD. Some pages leave the quotes off.
const JSON_LD_TYPE = /\stype\s*=\s*["']?application\/ld\+json\b/i;

/**
 * The JSON-LD blocks in a page's HTML, parsed, in order. A block that isn't JSON is left out.
 * The page is read once from start to end, one script element after another: a pattern for a
 * whole element can take minutes on a page written to make it backtrack.
 */
export function jsonLdBlocks(html: string): unknown[] {
	const blocks: unknown[] = [];
	const scriptTag = /<script\b/gi;
	const endTag = /<\/script/gi;
	for (let from = 0; ; ) {
		scriptTag.lastIndex = from;
		const start = scriptTag.exec(html)?.index;
		if (start === undefined) break;
		const contentStart = html.indexOf('>', start) + 1;
		if (contentStart === 0) break;
		endTag.lastIndex = contentStart;
		const end = endTag.exec(html)?.index;
		if (end === undefined) break;
		if (JSON_LD_TYPE.test(html.slice(start, contentStart))) {
			try {
				blocks.push(JSON.parse(html.slice(contentStart, end)));
			} catch {
				// Not JSON, so nothing to read.
			}
		}
		from = end;
	}
	return blocks;
}
