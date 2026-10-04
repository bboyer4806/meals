import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { foldCase } from '../../text.ts';
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
	// SQLite's lower() only folds A-Z, so name matching and search use this instead. It is used
	// in queries only, never in the schema, so other tools can still read and write the file.
	sqlite.function('fold', { deterministic: true }, (value: unknown) =>
		typeof value === 'string' ? foldCase(value) : value
	);
	migrate(sqlite, 'drizzle');
	instance = drizzle(sqlite, { schema });
	return instance;
}

export function db(): DB {
	if (!instance) throw new Error('The database has not been opened');
	return instance;
}

/**
 * Runs `fn` in a transaction that takes the write lock when it begins. A transaction that reads
 * before it writes would otherwise fail at once (SQLITE_BUSY_SNAPSHOT) if another connection
 * wrote in between, such as the next app container during a deploy. This one waits its turn.
 */
export function transaction<T>(fn: () => T): T {
	return db().transaction(fn, { behavior: 'immediate' });
}

/**
 * Applies new migrations from `folder` in one transaction and checks foreign keys before it
 * commits, so a migration that breaks them rolls back instead of being recorded. Keeps the same
 * bookkeeping table as Drizzle's own migrator.
 */
export function migrate(sqlite: Database.Database, folder: string): void {
	sqlite.exec(
		'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
	);
	const last = sqlite
		.prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1')
		.pluck()
		.get() as number | undefined;
	const pending = readMigrationFiles({ migrationsFolder: folder }).filter(
		(migration) => last === undefined || Number(last) < migration.folderMillis
	);

	// Rebuilding a table needs foreign keys off, and SQLite ignores that pragma inside a
	// transaction, so it's set around it.
	sqlite.pragma('foreign_keys = OFF');
	sqlite.transaction(() => {
		for (const migration of pending) {
			for (const statement of migration.sql) sqlite.exec(statement);
			sqlite
				.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
				.run(migration.hash, migration.folderMillis);
		}
		const violations = sqlite.pragma('foreign_key_check') as unknown[];
		if (violations.length > 0) {
			throw new Error(`Foreign key violations after migrating: ${JSON.stringify(violations)}`);
		}
	})();
	sqlite.pragma('foreign_keys = ON');
}
