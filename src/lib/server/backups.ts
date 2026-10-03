import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The date (YYYY-MM-DD) of the newest complete nightly backup, or null if there are none. */
export function latestBackupDate(dataDir: string): string | null {
	const dir = join(dataDir, 'backups');
	if (!existsSync(dir)) return null;
	const dates = readdirSync(dir)
		.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && existsSync(join(dir, name, 'meals.db')))
		.sort();
	return dates.at(-1) ?? null;
}
