import { lookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

// Import from a link and an item's image link (design 7) fetch from the web on the server. A
// link may only reach a public website over http or https, never this computer or a private
// network, where the server's own services and the cloud's metadata service are (design 4.5).

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

// Addresses off the public internet, all called private here: this computer, private networks,
// link-local ones, and the other ranges IANA sets aside as not reachable across the internet
// (MEA-113). An IPv4 address written as IPv6 is checked as IPv4: BlockList checks one such as
// ::ffff:127.0.0.1 itself, and refuseIPv4 refuses each range as NAT64 and 6to4 write it too.
const PRIVATE = new BlockList();

/** An IPv4 address as two groups of an IPv6 address: 10.0.0.5 is a00:5. */
function hexGroups(ipv4: string): string {
	const bits = ipv4.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
	return `${Math.floor(bits / 0x10000).toString(16)}:${(bits % 0x10000).toString(16)}`;
}

/**
 * Refuses an IPv4 range, and the same range through NAT64, whose gateway on an IPv6-only network
 * carries 64:ff9b::a00:5 to 10.0.0.5, and through 6to4, which tunnels 2002:a00:5:: to 10.0.0.5.
 */
function refuseIPv4(network: string, prefix: number): void {
	PRIVATE.addSubnet(network, prefix, 'ipv4');
	PRIVATE.addSubnet(`64:ff9b::${hexGroups(network)}`, 96 + prefix, 'ipv6');
	PRIVATE.addSubnet(`2002:${hexGroups(network)}::`, 16 + prefix, 'ipv6');
}

// "This network": 0.0.0.0 reaches this computer.
refuseIPv4('0.0.0.0', 8);
refuseIPv4('10.0.0.0', 8);
// Shared address space: private to a provider's network, as with carrier-grade NAT.
refuseIPv4('100.64.0.0', 10);
refuseIPv4('127.0.0.0', 8);
// Link-local, where clouds put their metadata service: 169.254.169.254.
refuseIPv4('169.254.0.0', 16);
refuseIPv4('172.16.0.0', 12);
// For protocols, such as NAT64's discovery.
refuseIPv4('192.0.0.0', 24);
// For documentation: TEST-NET-1.
refuseIPv4('192.0.2.0', 24);
refuseIPv4('192.168.0.0', 16);
// For benchmarking.
refuseIPv4('198.18.0.0', 15);
// For documentation: TEST-NET-2 and TEST-NET-3.
refuseIPv4('198.51.100.0', 24);
refuseIPv4('203.0.113.0', 24);
// Multicast.
refuseIPv4('224.0.0.0', 4);
// Reserved, up to the broadcast address, 255.255.255.255.
refuseIPv4('240.0.0.0', 4);
// Unspecified (::), loopback (::1) and IPv4-compatible, which IPv6 no longer uses.
PRIVATE.addSubnet('::', 96, 'ipv6');
// NAT64 for local use, whose networks can put the IPv4 address in more than one place.
PRIVATE.addSubnet('64:ff9b:1::', 48, 'ipv6');
// Discard-only.
PRIVATE.addSubnet('100::', 64, 'ipv6');
// For protocols, such as Teredo (2001::/32), which hides the IPv4 address it leads to.
PRIVATE.addSubnet('2001::', 23, 'ipv6');
// For documentation.
PRIVATE.addSubnet('2001:db8::', 32, 'ipv6');
PRIVATE.addSubnet('3fff::', 20, 'ipv6');
// Segment routing's identifiers (SRv6), for use within one network.
PRIVATE.addSubnet('5f00::', 16, 'ipv6');
// Unique local, for private networks, and link-local.
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');
// Multicast.
PRIVATE.addSubnet('ff00::', 8, 'ipv6');

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

/** What to ask for, and who's asking. */
export type LinkHeaders = { accept: string; 'user-agent': string };

/** Sends a GET, giving the response once its headers arrive. */
function get(url: URL, headers: LinkHeaders, signal: AbortSignal): Promise<IncomingMessage> {
	// A connection of its own, so its address is checked as it's made. Uncompressed, so the body
	// is read as it comes. Some servers compress it anyway (uncompress).
	const options = {
		agent: false,
		headers: { ...headers, 'accept-encoding': 'identity' },
		lookup: publicLookup,
		signal
	};
	return new Promise((resolve, reject) => {
		const request =
			url.protocol === 'https:'
				? https.get(url, options, resolve)
				: http.get(url, options, resolve);
		request.on('error', reject);
	});
}

/** The body, read until it ends or passes 5 MB. */
async function readBody(response: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of response as AsyncIterable<Buffer>) {
		bytes += chunk.length;
		// Leaving the loop closes the connection.
		if (bytes > MAX_BYTES) throw new Error(`The page is over ${MAX_BYTES} bytes`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

const gunzip = promisify(zlib.gunzip);

/**
 * The body as it was before the server compressed it, as some do though asked not to. Gzip is
 * unzipped up to 5 MB, so a small body can't unzip to fill the server (design 4.5).
 * Throws for any other compression.
 */
async function uncompress(body: Buffer, contentEncoding = 'identity'): Promise<Buffer> {
	if (contentEncoding === 'identity') return body;
	if (contentEncoding === 'gzip') return gunzip(body, { maxOutputLength: MAX_BYTES });
	throw new Error(`The page is compressed as ${contentEncoding}`);
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * What a link answers, unzipped, with its Content-Type. Redirects are followed one at a time,
 * up to 5, each checked as the link was. Throws if the link or a redirect isn't http or https or
 * reaches a private address, if it doesn't answer 200, if it takes over 10 seconds or 5 MB in
 * all, or if it's compressed other than with gzip or unzips to over 5 MB.
 */
export async function fetchLink(
	link: URL,
	headers: LinkHeaders
): Promise<{ body: Buffer; contentType: string | undefined }> {
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	let url = link;
	for (let redirects = 0; ; redirects += 1) {
		checkLink(url);
		const response = await get(url, headers, signal);
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
		const body = await uncompress(await readBody(response), response.headers['content-encoding']);
		return { body, contentType: response.headers['content-type'] };
	}
}
