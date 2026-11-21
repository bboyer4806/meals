// Stands in front of the Docker image when the browser tests run against it (playwright.config.ts),
// as nginx stands in front of the app in production, but over http. It passes each request on to
// the image, on TARGET_PORT, saying in X-Forwarded-Proto that it came over http: adapter-node takes
// a request as https unless the header PROTOCOL_HEADER names says otherwise. The browser can't say
// so itself on every request, since Chromium sends a download without Playwright's extra headers.
import { createServer, request } from 'node:http';

const target = Number(process.env.TARGET_PORT);

const server = createServer((incoming, outgoing) => {
	const forwarded = request(
		{
			host: '127.0.0.1',
			port: target,
			method: incoming.method,
			path: incoming.url,
			headers: { ...incoming.headers, 'x-forwarded-proto': 'http' }
		},
		(response) => {
			outgoing.writeHead(response.statusCode ?? 502, response.rawHeaders);
			response.pipe(outgoing);
		}
	);
	// Such as before the image answers, which Playwright waits out.
	forwarded.on('error', () => outgoing.destroy());
	incoming.pipe(forwarded);
});

server.listen(Number(process.env.PORT));
