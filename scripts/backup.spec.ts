import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { latestBackupDate } from '../src/lib/server/backups.ts';
import { openDb } from '../src/lib/server/db/index.ts';
import { households } from '../src/lib/server/db/schema.ts';

function runBackup(dataDir: string) {
	execFileSync('node', ['scripts/backup.js'], { env: { ...process.env, DATA_DIR: dataDir } });
}

describe('backup script', () => {
	it('copies the database into a dated folder and keeps the newest 14', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'))
			.insert(households)
			.values({ name: 'Kept', defaultServings: 2, timeZone: 'UTC', createdAt: 0 })
			.run();
		for (let day = 1; day <= 20; day++) {
			mkdirSync(join(dataDir, 'backups', `2020-01-${String(day).padStart(2, '0')}`), {
				recursive: true
			});
		}

		runBackup(dataDir);

		const today = new Date().toISOString().slice(0, 10);
		const copy = new Database(join(dataDir, 'backups', today, 'meals.db'), { readonly: true });
		expect(copy.prepare('select name from households').pluck().all()).toEqual(['Kept']);
		copy.close();
		const folders = readdirSync(join(dataDir, 'backups')).sort();
		expect(folders).toHaveLength(14);
		expect(folders.at(-1)).toBe(today);
		expect(existsSync(join(dataDir, 'backups', '2020-01-01'))).toBe(false);
	});

	it('keeps the existing backup when a run fails', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'));
		runBackup(dataDir);
		const today = new Date().toISOString().slice(0, 10);

		// Make the next copy fail: the database path becomes a folder.
		renameSync(join(dataDir, 'meals.db'), join(dataDir, 'moved.db'));
		mkdirSync(join(dataDir, 'meals.db'));
		expect(() => runBackup(dataDir)).toThrow();

		expect(existsSync(join(dataDir, 'backups', today, 'meals.db'))).toBe(true);
		expect(latestBackupDate(dataDir)).toBe(today);
	});

	it('only reports complete backups', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		mkdirSync(join(dataDir, 'backups', '2026-01-01'), { recursive: true });
		writeFileSync(join(dataDir, 'backups', '2026-01-01', 'meals.db'), '');
		mkdirSync(join(dataDir, 'backups', '2026-01-02'), { recursive: true });
		expect(latestBackupDate(dataDir)).toBe('2026-01-01');
	});

	it('refuses to run without a database', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		expect(() => runBackup(dataDir)).toThrow(/does not exist/);
	});
});
