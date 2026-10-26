import { lookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

// Import from a link (design 7) fetches the recipe's page on the server. A link may only reach
// a public website over http or https, never this computer or a private network, where the
// server's own services and the cloud's metadata service are (design 4.5).

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

// This computer, private networks and link-local ones. An IPv4 address written as IPv6, such
// as ::ffff:127.0.0.1, is checked as IPv4.
const PRIVATE = new BlockList();
// "This network": 0.0.0.0 reaches this computer.
PRIVATE.addSubnet('0.0.0.0', 8);
PRIVATE.addSubnet('10.0.0.0', 8);
// Shared address space: private to a provider's network, as with carrier-grade NAT.
PRIVATE.addSubnet('100.64.0.0', 10);
PRIVATE.addSubnet('127.0.0.0', 8);
// Link-local, where clouds put their metadata service: 169.254.169.254.
PRIVATE.addSubnet('169.254.0.0', 16);
PRIVATE.addSubnet('172.16.0.0', 12);
PRIVATE.addSubnet('192.168.0.0', 16);
PRIVATE.addAddress('::', 'ipv6');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

function isPrivate(address: string): boolean {
	return PRIVATE.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Looks up a name as the connection is made, and refuses it if any of its addresses is private.
 * Checking then, rather than before, means the name can't give a public address to a check and
 * a private one to the connection.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, []);
		const refused = addresses.find(({ address }) => isPrivate(address));
		if (refused) {
			return callback(new Error(`${hostname} is at ${refused.address}, a private address`), []);
		}
		const [first] = addresses;
		if (!first) return callback(new Error(`${hostname} has no address`), []);
		if (options.all) callback(null, addresses);
		else callback(null, first.address, first.family);
	});
};

/** Throws for a link that isn't http or https, or whose host is a private address. */
function checkLink(url: URL): void {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${url.protocol} links can't be fetched`);
	}
	// A name is checked as it's looked up, but an address in the link is never looked up.
	const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
	if (isIP(host) !== 0 && isPrivate(host)) throw new Error(`${host} is a private address`);
}

const HEADERS = {
	accept: 'text/html,application/xhtml+xml',
	// Uncompressed, so the body is read as it comes.
	'accept-encoding': 'identity',
	'user-agent': 'Mozilla/5.0 (compatible; Meals recipe import)'
};

/** Sends a GET, giving the response once its headers arrive. */
function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
	// A connection of its own, so its address is checked as it's made.
	const options = { agent: false, headers: HEADERS, lookup: publicLookup, signal };
	return new Promise((resolve, reject) => {
		const request =
			url.protocol === 'https:'
				? https.get(url, options, resolve)
				: http.get(url, options, resolve);
		request.on('error', reject);
	});
}

/** The body as text, read until it ends or passes 5 MB. */
async function readBody(response: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of response as AsyncIterable<Buffer>) {
		bytes += chunk.length;
		// Leaving the loop closes the connection.
		if (bytes > MAX_BYTES) throw new Error(`The page is over ${MAX_BYTES} bytes`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * A web page's HTML. Redirects are followed one at a time, up to 5, each checked as the link
 * was. Throws if the link or a redirect isn't http or https or reaches a private address, if the
 * page doesn't answer 200, or if it takes over 10 seconds or 5 MB in all.
 */
export async function fetchPage(link: URL): Promise<string> {
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	let url = link;
	for (let redirects = 0; ; redirects += 1) {
		checkLink(url);
		const response = await get(url, signal);
		const { location } = response.headers;
		if (REDIRECTS.has(response.statusCode ?? 0) && location !== undefined) {
			response.destroy();
			if (redirects === MAX_REDIRECTS) throw new Error(`${link.href} redirects too many times`);
			url = new URL(location, url);
			continue;
		}
		if (response.statusCode !== 200) {
			response.destroy();
			throw new Error(`${url.href} answered ${response.statusCode}`);
		}
		return readBody(response);
	}
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
