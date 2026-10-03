import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './index.ts';

/** A copy of ./drizzle with one more migration appended. */
function foldersWith(extraSql: string): string {
	const folder = mkdtempSync(join(tmpdir(), 'meals-migrations-'));
	cpSync('drizzle', folder, { recursive: true });
	const journalPath = join(folder, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
	const last = journal.entries.at(-1);
	journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_extra' });
	writeFileSync(journalPath, JSON.stringify(journal));
	writeFileSync(join(folder, '9999_extra.sql'), extraSql);
	return folder;
}

function applied(sqlite: Database.Database): number {
	return sqlite.prepare('select count(*) from "__drizzle_migrations"').pluck().get() as number;
}

describe('migrate', () => {
	it('applies pending migrations once', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, 'drizzle');
		migrate(sqlite, 'drizzle');
		expect(applied(sqlite)).toBe(1);
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('rolls back a migration that leaves a broken reference, instead of recording it', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, 'drizzle');
		sqlite
			.prepare(
				"insert into households (name, default_servings, time_zone, created_at) values ('A', 2, 'UTC', 0)"
			)
			.run();
		const broken = foldersWith(
			"insert into items (household_id, name, default_store_id, created_at) values (1, 'Ghost', 99, 0);"
		);
		expect(() => migrate(sqlite, broken)).toThrow(/Foreign key violations/);
		expect(applied(sqlite)).toBe(1);
		expect(sqlite.prepare('select count(*) from items').pluck().get()).toBe(0);
	});
});
