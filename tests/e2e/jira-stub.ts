// A stand-in for Jira's create-issue API, so the browser tests can send feedback (design 7,
// "Feedback"). playwright.config.ts starts it next to the app, on the port in PORT, and points
// JIRA_URL at it.
//   POST /rest/api/3/issue   records the ticket and answers like Jira
//   GET  /tickets            the tickets received, oldest first
//   POST /fail?match=<text>  fails the next ticket whose request contains the text, so tests
//                            running at the same time don't fail each other's tickets
import { createServer, type IncomingMessage } from 'node:http';

type Ticket = { authorization: string | undefined; fields: unknown };

const tickets: Ticket[] = [];
const failures = new Set<string>();

async function body(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString();
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', 'http://localhost');
	if (request.method === 'GET' && url.pathname === '/tickets') {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(tickets));
		return;
	}
	if (request.method === 'POST' && url.pathname === '/fail') {
		failures.add(url.searchParams.get('match') ?? '');
		response.end();
		return;
	}
	if (request.method === 'POST' && url.pathname === '/rest/api/3/issue') {
		const text = await body(request);
		const failure = [...failures].find((match) => text.includes(match));
		if (failure !== undefined) {
			failures.delete(failure);
			response.statusCode = 503;
			response.end('Unavailable');
			return;
		}
		tickets.push({ authorization: request.headers.authorization, fields: JSON.parse(text).fields });
		response.statusCode = 201;
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ key: `MEA-${1000 + tickets.length}` }));
		return;
	}
	response.statusCode = 404;
	response.end();
});

server.listen(Number(process.env.PORT));
