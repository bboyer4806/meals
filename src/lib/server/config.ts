import { z } from 'zod';

// Read from the environment when the server starts, not at build time, so building the image
// needs no secrets. The server refuses to start if any of these is missing.
const schema = z.object({
	GOOGLE_CLIENT_ID: z.string().min(1),
	GOOGLE_CLIENT_SECRET: z.string().min(1),
	// The site admin's Google account email; it can invite new households.
	ADMIN_EMAIL: z.email().transform((email) => email.toLowerCase()),
	// An existing directory that holds the database.
	DATA_DIR: z.string().min(1)
});

export type Config = z.output<typeof schema>;

let loaded: Config | undefined;

export function loadConfig(env: Record<string, string | undefined>): Config {
	const result = schema.safeParse(env);
	if (!result.success) {
		const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
		throw new Error(`Invalid environment variables:\n${problems.join('\n')}`);
	}
	loaded = result.data;
	return loaded;
}

export function config(): Config {
	if (!loaded) throw new Error('The configuration has not been loaded');
	return loaded;
}
