// Nightly backup, run by Dokku cron (see app.json). Copies the database into
// $DATA_DIR/backups/<YYYY-MM-DD>/ and keeps the newest 14 of those folders.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const KEEP = 14;
const DATED = /^\d{4}-\d{2}-\d{2}$/;

const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR is not set');
const database = join(dataDir, 'meals.db');
if (!existsSync(database)) throw new Error(`${database} does not exist`);

const backups = join(dataDir, 'backups');
const date = new Date().toISOString().slice(0, 10);
const target = join(backups, date);
// Copy into a folder the date pattern doesn't match, and move it into place only once the copy
// is complete, so a failed run never replaces or hides a good backup.
const partial = join(backups, `partial-${date}`);
mkdirSync(backups, { recursive: true });
for (const name of readdirSync(backups)) {
	if (name.startsWith('partial-')) rmSync(join(backups, name), { recursive: true, force: true });
}
mkdirSync(partial);

// SQLite's online backup is consistent even while the app is writing.
const db = new Database(database, { fileMustExist: true });
await db.backup(join(partial, 'meals.db'));
db.close();

rmSync(target, { recursive: true, force: true });
renameSync(partial, target);

const dated = readdirSync(backups)
	.filter((name) => DATED.test(name))
	.sort();
for (const old of dated.slice(0, -KEEP)) {
	rmSync(join(backups, old), { recursive: true, force: true });
}

console.log(`Backed up ${database} to ${target}`);
