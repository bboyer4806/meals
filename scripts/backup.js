// Nightly backup, run by Dokku cron (see app.json). Copies the database into
// $DATA_DIR/backups/<YYYY-MM-DD>/ and keeps the newest 14 of those folders.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const KEEP = 14;

const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR is not set');
const database = join(dataDir, 'meals.db');
if (!existsSync(database)) throw new Error(`${database} does not exist`);

const backups = join(dataDir, 'backups');
const target = join(backups, new Date().toISOString().slice(0, 10));

// Running twice on the same day replaces that day's backup.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

// SQLite's online backup is consistent even while the app is writing.
const db = new Database(database, { fileMustExist: true });
await db.backup(join(target, 'meals.db'));
db.close();

const dated = readdirSync(backups)
	.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
	.sort();
for (const old of dated.slice(0, -KEEP)) {
	rmSync(join(backups, old), { recursive: true, force: true });
}

console.log(`Backed up ${database} to ${target}`);
