import { sql } from 'drizzle-orm';
import { text } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';

// Dokku waits for this before switching traffic to a new version.
export function GET() {
	db().get(sql`select 1`);
	return text('ok');
}
