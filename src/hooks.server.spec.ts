import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getHousehold } from '#lib/server/data/households.ts';
import { listCatalog } from '#lib/server/data/items.ts';
import { openDb } from '#lib/server/db/index.ts';
import { TEST_ENV, makeHousehold } from '#lib/server/testing.ts';
import { init } from './hooks.server.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'meals-start-'));

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dataDir, { recursive: true, force: true });
});

it('adds the standard items to older households when the app starts (6.13)', async () => {
	// A household set up before them, which the migration leaves without them.
	openDb(join(dataDir, 'meals.db'));
	const { householdId } = makeHousehold();
	for (const [name, value] of Object.entries({ ...TEST_ENV, DATA_DIR: dataDir })) {
		vi.stubEnv(name, value);
	}

	await init();

	expect(listCatalog(householdId, false, '')).toHaveLength(288);
	expect(getHousehold(householdId).standardItemsAddedAt).not.toBeNull();
});
