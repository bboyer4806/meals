import { sql } from 'drizzle-orm';
import { text } from '@sveltejs/kit';
import { version } from '$app/env';
import { db } from '#lib/server/db/index.ts';

// Dokku waits for this before switching traffic to a new version. It answers with the commit the
// app was built from (vite.config.ts), so the deploy can check the new version is the one
// answering (4.2).
export function GET() {
	db().get(sql`select 1`);
	return text(version);
}
