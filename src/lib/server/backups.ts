import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The date of the newest nightly backup folder (YYYY-MM-DD), or null if there are none. */
export function latestBackupDate(dataDir: string): string | null {
	const dir = join(dataDir, 'backups');
	if (!existsSync(dir)) return null;
	const dates = readdirSync(dir)
		.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
		.sort();
	return dates.at(-1) ?? null;
}
