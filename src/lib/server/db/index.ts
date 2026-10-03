import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type DB = BetterSQLite3Database<typeof schema>;

let instance: DB | undefined;

/**
 * Opens the database file at `path`, applies any new migrations from ./drizzle, and makes the
 * database available through `db()`. Called once when the server starts, and by tests.
 */
export function openDb(path: string): DB {
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');

	// Migrations that rebuild a table need foreign keys off, and SQLite ignores that pragma inside
	// the migration's transaction. So migrate with them off, then check nothing was left broken.
	sqlite.pragma('foreign_keys = OFF');
	const database = drizzle(sqlite, { schema });
	migrate(database, { migrationsFolder: 'drizzle' });
	const violations = sqlite.pragma('foreign_key_check') as unknown[];
	if (violations.length > 0) {
		throw new Error(`Foreign key violations after migrating: ${JSON.stringify(violations)}`);
	}
	sqlite.pragma('foreign_keys = ON');

	instance = database;
	return database;
}

export function db(): DB {
	if (!instance) throw new Error('The database has not been opened');
	return instance;
}
