import { execFile, execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
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

	it('links the photos into the backup instead of copying them', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'));
		const photos = join(dataDir, 'photos');
		mkdirSync(photos);
		writeFileSync(join(photos, 'a.jpg'), 'photo');
		writeFileSync(join(photos, 'a-thumb.jpg'), 'thumbnail');
		mkdirSync(join(photos, 'not-a-photo'));

		runBackup(dataDir);

		const today = new Date().toISOString().slice(0, 10);
		const backedUp = join(dataDir, 'backups', today, 'photos');
		expect(readdirSync(backedUp).sort()).toEqual(['a-thumb.jpg', 'a.jpg']);
		for (const name of ['a.jpg', 'a-thumb.jpg']) {
			// The same file under a second name, so it takes no extra space.
			expect(statSync(join(backedUp, name)).ino).toBe(statSync(join(photos, name)).ino);
		}
	});

	it('keeps a replaced photo in the older backup', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'));
		const photos = join(dataDir, 'photos');
		mkdirSync(photos);
		writeFileSync(join(photos, 'old.jpg'), 'old photo');
		runBackup(dataDir);
		// That backup becomes an older one.
		const today = new Date().toISOString().slice(0, 10);
		renameSync(join(dataDir, 'backups', today), join(dataDir, 'backups', '2020-01-01'));

		// The app replaces a photo by saving the new one under a new key and deleting the old one.
		writeFileSync(join(photos, 'new.jpg'), 'new photo');
		rmSync(join(photos, 'old.jpg'));
		runBackup(dataDir);

		expect(readFileSync(join(dataDir, 'backups', '2020-01-01', 'photos', 'old.jpg'), 'utf8')).toBe(
			'old photo'
		);
		expect(readdirSync(join(dataDir, 'backups', today, 'photos'))).toEqual(['new.jpg']);
	});

	it('waits for a save in progress, so the photos it links match the database it copied', async () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'));
		const app = new Database(join(dataDir, 'meals.db'));
		// A save that has begun: the app writes a photo's files, then commits the key, then deletes
		// the old photo's files.
		app.exec('BEGIN IMMEDIATE');
		const run = promisify(execFile)('node', ['scripts/backup.js'], {
			env: { ...process.env, DATA_DIR: dataDir }
		});
		// The script makes this folder just before it takes the lock.
		const backups = join(dataDir, 'backups');
		const started = () => readdirSync(backups).some((name) => name.startsWith('partial-'));
		while (!existsSync(backups) || !started()) {
			await sleep(10);
		}
		await sleep(300);
		app
			.prepare(
				"insert into households (name, default_servings, time_zone, created_at) values ('Saved', 2, 'UTC', 0)"
			)
			.run();
		app.exec('COMMIT');
		app.close();
		await run;

		const today = new Date().toISOString().slice(0, 10);
		const copy = new Database(join(dataDir, 'backups', today, 'meals.db'), { readonly: true });
		expect(copy.prepare('select name from households').pluck().all()).toEqual(['Saved']);
		copy.close();
	});

	it('works before there are any photos, and still makes the photos folder', () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'meals-backup-'));
		openDb(join(dataDir, 'meals.db'));

		runBackup(dataDir);

		const today = new Date().toISOString().slice(0, 10);
		expect(existsSync(join(dataDir, 'backups', today, 'meals.db'))).toBe(true);
		expect(readdirSync(join(dataDir, 'backups', today, 'photos'))).toEqual([]);
		expect(existsSync(join(dataDir, 'photos'))).toBe(false);
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
