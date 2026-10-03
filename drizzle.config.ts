import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from the schema into ./drizzle. The app applies them at startup.
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	strict: true,
	verbose: true
});
