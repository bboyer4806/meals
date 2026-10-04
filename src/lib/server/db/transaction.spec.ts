import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDb, transaction } from './index.ts';

it('takes the write lock as soon as a transaction begins', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'meals-db-')), 'meals.db');
	openDb(path);
	// Another connection, such as a second app container, that gives up instead of waiting.
	const other = new Database(path, { timeout: 0 });
	const write = other.prepare(
		"insert into households (name, default_servings, time_zone, created_at) values ('A', 2, 'UTC', 0)"
	);
	transaction(() => {
		expect(() => write.run()).toThrow('database is locked');
	});
	expect(write.run().changes).toBe(1);
	other.close();
});
