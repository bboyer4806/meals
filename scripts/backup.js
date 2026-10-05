// Nightly backup, run by Dokku cron (see app.json). Copies the database into
// $DATA_DIR/backups/<YYYY-MM-DD>/, hard-links the photos into its photos/ folder, and keeps the
// newest 14 of those folders.
import { existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
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

// A hard link is the same file under a second name, so a photo that hasn't changed takes no extra
// space. The app never changes a photo file (a new photo gets a new key), so a replaced or deleted
// photo stays in the older backups. The folder is made even with no photos yet, so every backup
// restores the same way (README).
const photos = join(dataDir, 'photos');
mkdirSync(join(partial, 'photos'));
let linked = 0;
if (existsSync(photos)) {
	for (const entry of readdirSync(photos, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		try {
			linkSync(join(photos, entry.name), join(partial, 'photos', entry.name));
			linked += 1;
		} catch (error) {
			// Deleted since the folder was read. Skipped, so it doesn't fail the whole backup.
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
	}
}

rmSync(target, { recursive: true, force: true });
renameSync(partial, target);

const dated = readdirSync(backups)
	.filter((name) => DATED.test(name))
	.sort();
for (const old of dated.slice(0, -KEEP)) {
	rmSync(join(backups, old), { recursive: true, force: true });
}

console.log(`Backed up ${database} and ${linked} photo files to ${target}`);
