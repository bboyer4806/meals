import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../csv.ts';
import { loadConfig } from './config.ts';
import { findDishByName, getDish, setDishArchived, updateDish } from './data/dishes.ts';
import { addDefaultDishesToAllHouseholds, getHousehold } from './data/households.ts';
import { db } from './db/index.ts';
import {
	assignAllDefaultDishPhotos,
	assignDefaultDishPhotos,
	checkDefaultDishPhotos,
	DISHES_WITH_PHOTOS,
	LIBRARY
} from './default-dish-photos.ts';
import { householdOwnsPhoto, PHOTO_MAX_BYTES, photoPath, THUMB_MAX_BYTES } from './photos.ts';
import { libraryName } from './standard-images.ts';
import { TEST_ENV, freshDb, jpegSize, makeDish, makeHousehold, recipe } from './testing.ts';

// Real files unless a test says otherwise.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return { ...fs, existsSync: vi.fn(fs.existsSync) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs/promises')>();
	return { ...fs, readFile: vi.fn(fs.readFile) };
});

const NOW = Date.UTC(2026, 10, 16, 17, 0);
const LATER = NOW + 24 * 60 * 60 * 1000;
const KEY = '0123456789abcdef0123456789abcdef';

describe('the library', () => {
	it('has a photo and thumbnail for each original default dish but Sloppy Joes, and credits', () => {
		expect(DISHES_WITH_PHOTOS).toHaveLength(79);
		expect(DISHES_WITH_PHOTOS).not.toContain('Sloppy Joes');
		const files = DISHES_WITH_PHOTOS.flatMap((name) => [
			`${libraryName(name)}.jpg`,
			`${libraryName(name)}-thumb.jpg`
		]);
		// Sorted the same way, which also shows that no two dishes share a name.
		expect(readdirSync(LIBRARY).sort()).toEqual([...files, 'credits.csv'].sort());
	});

	it('stores them as the recipe editor stores a photo: 4:3 JPEGs, the thumbnail 400 px (2.3)', () => {
		for (const name of DISHES_WITH_PHOTOS) {
			const photo = readFileSync(join(LIBRARY, `${libraryName(name)}.jpg`));
			const thumb = readFileSync(join(LIBRARY, `${libraryName(name)}-thumb.jpg`));
			for (const bytes of [photo, thumb]) expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
			expect(photo.length).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
			expect(thumb.length).toBeLessThanOrEqual(THUMB_MAX_BYTES);
			const { width, height } = jpegSize(photo);
			expect(width * 3, name).toBe(height * 4);
			expect(width, name).toBeGreaterThanOrEqual(800);
			expect(width, name).toBeLessThanOrEqual(1200);
			expect(jpegSize(thumb), name).toEqual({ width: 400, height: 300 });
		}
	});

	it('credits each photo: where it came from, who took it and a license needing no credit', () => {
		const csv = parseCsv(readFileSync(join(LIBRARY, 'credits.csv'), 'utf8'));
		if (csv.kind !== 'rows') throw new Error('Not CSV');
		const [header, ...rows] = csv.rows;
		expect(header).toEqual(['Dish', 'Source', 'Author', 'License']);
		expect(rows.map((row) => row[0])).toEqual([...DISHES_WITH_PHOTOS]);
		for (const [dish, source, author, license] of rows) {
			expect(source, dish).toMatch(/^https:\/\/\S+$/);
			expect(author, dish).not.toBe('');
			expect(['CC0', 'Public domain', 'Pixabay Content License'], dish).toContain(license);
		}
	});
});

describe('checkDefaultDishPhotos', () => {
	it('passes when every photo is there', () => {
		expect(() => checkDefaultDishPhotos()).not.toThrow();
	});

	it('throws when one is missing, as when the library was left out of the app', () => {
		const missing = join(LIBRARY, 'chili-thumb.jpg');
		const exists = vi.mocked(existsSync).getMockImplementation()!;
		vi.mocked(existsSync).mockImplementation((path) => path !== missing && exists(path));
		try {
			expect(() => checkDefaultDishPhotos()).toThrow(
				`The default dish photo ${missing} is missing`
			);
		} finally {
			vi.mocked(existsSync).mockImplementation(exists);
		}
	});
});

describe('assignDefaultDishPhotos', () => {
	let dataDir: string;
	let householdId: number;

	beforeEach(() => {
		freshDb();
		({ householdId } = makeHousehold());
		dataDir = mkdtempSync(join(tmpdir(), 'meals-default-dish-photos-'));
		loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
		vi.mocked(readFile).mockReset();
	});

	function storedFiles(): string[] {
		const dir = join(dataDir, 'photos');
		return existsSync(dir) ? readdirSync(dir).sort() : [];
	}

	function filesFor(...keys: string[]): string[] {
		return keys.flatMap((key) => [`${key}-thumb.jpg`, `${key}.jpg`]).sort();
	}

	function dishId(name: string, household = householdId): number {
		const found = findDishByName(household, name);
		if (!found) throw new Error(`No ${name}`);
		return found.id;
	}

	function photoOf(name: string, household = householdId): string | null {
		return getDish(household, dishId(name, household)).photoKey;
	}

	/** The dish's photo, checking it's the household's own copy of the library's photo for `dish`. */
	function copyOf(name: string, dish: string, household = householdId): string {
		const key = photoOf(name, household);
		if (key === null) throw new Error(`${name} has no photo`);
		const library = libraryName(dish);
		expect(readFileSync(photoPath(key, 'full'))).toEqual(readFileSync(join(LIBRARY, `${library}.jpg`)));
		expect(readFileSync(photoPath(key, 'thumb'))).toEqual(
			readFileSync(join(LIBRARY, `${library}-thumb.jpg`))
		);
		expect(householdOwnsPhoto(household, key)).toBe(true);
		return key;
	}

	/** Makes reading the library's file named this fail, as a missing or unreadable file would. */
	function failToRead(file: string, error: Error): void {
		const read = vi.mocked(readFile).getMockImplementation()!;
		vi.mocked(readFile).mockImplementation((path, options) =>
			path === join(LIBRARY, file) ? Promise.reject(error) : read(path, options)
		);
	}

	it('gives every default dish but Sloppy Joes a copy of its own photo', async () => {
		addDefaultDishesToAllHouseholds(NOW);

		await assignDefaultDishPhotos(householdId, NOW);

		const keys = DISHES_WITH_PHOTOS.map((name) => copyOf(name, name));
		expect(new Set(keys).size).toBe(79);
		expect(photoOf('Sloppy Joes')).toBeNull();
		expect(storedFiles()).toEqual(filesFor(...keys));
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});

	it('matches names ignoring case, archived dishes included, and keeps them archived', async () => {
		makeDish(householdId, recipe('hamburgers', { steps: 'Grill them.' }));
		setDishArchived(householdId, makeDish(householdId, recipe('PIZZA')), true, 0);
		// A dish of its own, as a later revision of the default dishes could add: no photo.
		makeDish(householdId, recipe('Tuna Casserole'));

		await assignDefaultDishPhotos(householdId, NOW);

		const keys = [copyOf('hamburgers', 'Hamburgers'), copyOf('PIZZA', 'Pizza')];
		expect(storedFiles()).toEqual(filesFor(...keys));
		expect(findDishByName(householdId, 'Pizza')?.archivedAt).toBe(0);
		expect(photoOf('Tuna Casserole')).toBeNull();
	});

	it('keeps a photo a dish already has', async () => {
		makeDish(householdId, recipe('Waffles'), 0, KEY);

		await assignDefaultDishPhotos(householdId, NOW);

		expect(photoOf('Waffles')).toBe(KEY);
		expect(storedFiles()).toEqual([]);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});

	it('gives them once, so a photo removed or replaced afterward stays that way', async () => {
		for (const name of ['Hamburgers', 'Pancakes']) makeDish(householdId, recipe(name));
		await assignDefaultDishPhotos(householdId, NOW);
		// In the recipe editor, Hamburgers' photo removed and Pancakes' replaced, and Tacos added.
		updateDish(householdId, dishId('Hamburgers'), recipe('Hamburgers'), { photoKey: null }, [], NOW);
		updateDish(householdId, dishId('Pancakes'), recipe('Pancakes'), { photoKey: KEY }, [], NOW);
		makeDish(householdId, recipe('Tacos'), NOW);
		const files = storedFiles();

		// As when the app starts again, and a second try at once.
		await assignAllDefaultDishPhotos(LATER);
		await assignDefaultDishPhotos(householdId, LATER);

		expect(photoOf('Hamburgers')).toBeNull();
		expect(photoOf('Pancakes')).toBe(KEY);
		expect(photoOf('Tacos')).toBeNull();
		expect(storedFiles()).toEqual(files);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});

	it("gives each household its own copies, and gives only the one it's given", async () => {
		const other = makeHousehold().householdId;
		makeDish(householdId, recipe('Chili'));
		makeDish(other, recipe('Chili'));

		await assignDefaultDishPhotos(householdId, NOW);
		const ours = copyOf('Chili', 'Chili');
		expect(photoOf('Chili', other)).toBeNull();
		expect(getHousehold(other).defaultDishPhotosAddedAt).toBeNull();

		await assignAllDefaultDishPhotos(LATER);
		const theirs = copyOf('Chili', 'Chili', other);
		expect(theirs).not.toBe(ours);
		expect(householdOwnsPhoto(householdId, theirs)).toBe(false);
		expect(householdOwnsPhoto(other, ours)).toBe(false);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});

	it("gives none when a photo can't be read, deleting its copies, and all the next time", async () => {
		const names = ['Hamburgers', 'Hot Dogs', 'Pizza'];
		for (const name of names) makeDish(householdId, recipe(name));
		failToRead('hot-dogs.jpg', new Error('ENOENT: no such file'));

		await expect(assignDefaultDishPhotos(householdId, NOW)).rejects.toThrow('ENOENT');
		for (const name of names) expect(photoOf(name)).toBeNull();
		expect(storedFiles()).toEqual([]);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBeNull();

		vi.mocked(readFile).mockReset();
		await assignDefaultDishPhotos(householdId, LATER);
		expect(storedFiles()).toEqual(filesFor(...names.map((name) => copyOf(name, name))));
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(LATER);
	});

	it("gives none when the photos folder can't be written", async () => {
		makeDish(householdId, recipe('Pizza'));
		// A file where the folder would go.
		writeFileSync(join(dataDir, 'photos'), '');

		await expect(assignDefaultDishPhotos(householdId, NOW)).rejects.toThrow();
		expect(photoOf('Pizza')).toBeNull();
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBeNull();
	});

	it('deletes its copies when recording them fails, and gives them the next time', async () => {
		makeDish(householdId, recipe('Pizza'));
		db().run(
			sql.raw(`create trigger fail_to_record before update of default_dish_photos_added_at
				on households begin select raise(abort, 'Simulated failure'); end`)
		);

		await expect(assignDefaultDishPhotos(householdId, NOW)).rejects.toThrow('Simulated failure');
		expect(photoOf('Pizza')).toBeNull();
		expect(storedFiles()).toEqual([]);

		db().run(sql.raw('drop trigger fail_to_record'));
		await assignDefaultDishPhotos(householdId, LATER);
		expect(storedFiles()).toEqual(filesFor(copyOf('Pizza', 'Pizza')));
	});

	it('keeps a photo a dish got while its copy was being stored, and deletes the copy', async () => {
		const pizza = makeDish(householdId, recipe('Pizza'));
		const read = vi.mocked(readFile).getMockImplementation()!;
		vi.mocked(readFile).mockImplementationOnce((path, options) => {
			// Someone saves a photo in the recipe editor meanwhile.
			updateDish(householdId, pizza, recipe('Pizza'), { photoKey: KEY }, [], NOW);
			return read(path, options);
		});

		await assignDefaultDishPhotos(householdId, NOW);

		expect(photoOf('Pizza')).toBe(KEY);
		expect(storedFiles()).toEqual([]);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});
});
