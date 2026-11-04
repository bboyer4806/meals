// A stand-in for Jira's create-issue and attachment APIs, so the browser tests can send feedback
// (design 7, "Feedback"). playwright.config.ts starts it next to the app, on the port in PORT,
// and points JIRA_URL at it.
//   POST /rest/api/3/issue                    records the ticket and answers like Jira
//   POST /rest/api/3/issue/<key>/attachments  records the file on that ticket
//   GET  /tickets                             the tickets received, oldest first, with their files
//   POST /fail?match=<text>                   fails the next ticket whose request contains the
//                                             text, so tests running at the same time don't fail
//                                             each other's tickets
//   POST /fail-attachment?match=<text>        fails the next file attached to a ticket whose
//                                             request contained the text
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';

type Attachment = {
	authorization: string | undefined;
	atlassianToken: string | undefined;
	name: string;
	type: string;
	size: number;
	/** The SHA-256 of the file's bytes, in hex. */
	sha256: string;
};

type Ticket = {
	key: string;
	authorization: string | undefined;
	fields: unknown;
	attachments: Attachment[];
};

const tickets: Ticket[] = [];
const failures = new Set<string>();
const attachmentFailures = new Set<string>();

async function body(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

/** Removes and returns the first of the texts that `text` contains. */
function takeMatch(texts: Set<string>, text: string): string | undefined {
	const match = [...texts].find((candidate) => text.includes(candidate));
	if (match !== undefined) texts.delete(match);
	return match;
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
	if (request.method === 'POST' && url.pathname === '/fail-attachment') {
		attachmentFailures.add(url.searchParams.get('match') ?? '');
		response.end();
		return;
	}
	if (request.method === 'POST' && url.pathname === '/rest/api/3/issue') {
		const text = (await body(request)).toString();
		if (takeMatch(failures, text) !== undefined) {
			response.statusCode = 503;
			response.end('Unavailable');
			return;
		}
		const key = `MEA-${1001 + tickets.length}`;
		tickets.push({
			key,
			authorization: request.headers.authorization,
			fields: JSON.parse(text).fields,
			attachments: []
		});
		response.statusCode = 201;
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ id: String(10_000 + tickets.length), key }));
		return;
	}
	const attachment = /^\/rest\/api\/3\/issue\/([^/]+)\/attachments$/.exec(url.pathname);
	if (request.method === 'POST' && attachment) {
		const ticket = tickets.find((candidate) => candidate.key === attachment[1]);
		const bytes = await body(request);
		if (!ticket) {
			response.statusCode = 404;
			response.end('Issue does not exist');
			return;
		}
		if (takeMatch(attachmentFailures, JSON.stringify(ticket.fields)) !== undefined) {
			response.statusCode = 503;
			response.end('Unavailable');
			return;
		}
		const form = await new Response(new Uint8Array(bytes), {
			headers: { 'content-type': request.headers['content-type'] ?? '' }
		}).formData();
		const file = form.get('file');
		if (!(file instanceof File)) {
			response.statusCode = 400;
			response.end('No file');
			return;
		}
		ticket.attachments.push({
			authorization: request.headers.authorization,
			atlassianToken: request.headers['x-atlassian-token'] as string | undefined,
			name: file.name,
			type: file.type,
			size: file.size,
			sha256: createHash('sha256')
				.update(new Uint8Array(await file.arrayBuffer()))
				.digest('hex')
		});
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify([{ filename: file.name, size: file.size }]));
		return;
	}
	response.statusCode = 404;
	response.end();
});

server.listen(Number(process.env.PORT));
