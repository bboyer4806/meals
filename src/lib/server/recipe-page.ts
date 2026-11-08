import { fetchLink } from './fetch-link.ts';

// Import from a link (design 7) fetches the recipe's page on the server, through fetchLink,
// which only reaches public websites (design 4.5), and reads the recipe in its JSON-LD.

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
 * A web page's HTML, unzipped and decoded by its charset. Throws if fetchLink can't get it, or
 * if its charset isn't known.
 */
export async function fetchPage(link: URL): Promise<string> {
	const { body, contentType } = await fetchLink(link, HEADERS);
	return decode(body, contentType);
}

// A script tag whose type is JSON-LD. Some pages leave the quotes off.
const JSON_LD_TYPE = /\stype\s*=\s*["']?application\/ld\+json\b/i;

// JSON's escape for each control character, U+0000 to U+001F, by its code: \n for a line break,
// \t for a tab, and \u0000 and the like for the rest.
const CONTROL_ESCAPES = Array.from({ length: 0x20 }, (_, code) =>
	JSON.stringify(String.fromCharCode(code)).slice(1, -1)
);

/**
 * JSON text with the control characters in its strings escaped, as JSON needs them to be. A page
 * that pastes text into a template to write its JSON-LD can leave line breaks and tabs in it raw,
 * which JSON.parse refuses (MEA-90). Escaped, rather than made spaces, the line breaks in steps
 * written as text still split them (recipe-schema.ts). Valid JSON comes back as it was.
 */
function escapeControlCharacters(json: string): string {
	let escaped = '';
	let copied = 0;
	let inString = false;
	for (let at = 0; at < json.length; at += 1) {
		const char = json.charAt(at);
		if (char === '\\') {
			// An escape, such as \" or \\, stays as it is.
			at += 1;
		} else if (char === '"') {
			inString = !inString;
		} else if (inString && char < ' ') {
			// The control characters are the ones before the space.
			escaped += json.slice(copied, at) + CONTROL_ESCAPES[char.charCodeAt(0)];
			copied = at + 1;
		}
	}
	return escaped + json.slice(copied);
}

/**
 * The JSON-LD blocks in a page's HTML, parsed, in order, even where their strings have line breaks
 * or tabs left raw (escapeControlCharacters). A block that isn't JSON is left out.
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
				blocks.push(JSON.parse(escapeControlCharacters(html.slice(contentStart, end))));
			} catch {
				// Not JSON, so nothing to read.
			}
		}
		from = end;
	}
	return blocks;
}
