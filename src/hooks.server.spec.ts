import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getHousehold } from '#lib/server/data/households.ts';
import { listCatalog } from '#lib/server/data/items.ts';
import { openDb } from '#lib/server/db/index.ts';
import { TEST_ENV, makeHousehold } from '#lib/server/testing.ts';
import { init } from './hooks.server.ts';

// Real files unless a test says otherwise.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return { ...fs, existsSync: vi.fn(fs.existsSync) };
});

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'meals-start-'));
});

function useEnv() {
	for (const [name, value] of Object.entries({ ...TEST_ENV, DATA_DIR: dataDir })) {
		vi.stubEnv(name, value);
	}
}

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dataDir, { recursive: true, force: true });
});

it('adds the standard items and their images to older households when the app starts', async () => {
	// A household set up before them, which the migration leaves without them.
	openDb(join(dataDir, 'meals.db'));
	const { householdId } = makeHousehold();
	useEnv();

	await init();

	// 6.13 and 6.14.
	const catalog = listCatalog(householdId, false, '');
	expect(catalog).toHaveLength(288);
	expect(getHousehold(householdId).standardItemsAddedAt).not.toBeNull();
	const keys = new Set(catalog.map((item) => item.photoKey));
	expect(keys.size).toBe(288);
	expect(keys.has(null)).toBe(false);
	expect(readdirSync(join(dataDir, 'photos'))).toHaveLength(576);

	// Starting again adds nothing.
	await init();
	expect(readdirSync(join(dataDir, 'photos'))).toHaveLength(576);
});

it("doesn't start without the standard images, as when they weren't packaged with the app", async () => {
	useEnv();
	const exists = vi.mocked(existsSync).getMockImplementation()!;
	const missing = join('standard-images', 'salt.jpg');
	vi.mocked(existsSync).mockImplementation((path) => path !== missing && exists(path));

	try {
		await expect(init()).rejects.toThrow(`The standard image ${missing} is missing`);
		// Before it opens the database.
		expect(readdirSync(dataDir)).toEqual([]);
	} finally {
		vi.mocked(existsSync).mockImplementation(exists);
	}
});
