import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../csv.ts';
import { loadConfig } from './config.ts';
import {
	createItem,
	findItemByName,
	setItemArchived,
	setItemPhoto,
	setStandardImage,
	updateItem
} from './data/items.ts';
import { addNeed } from './data/needs.ts';
import { db } from './db/index.ts';
import { items } from './db/schema.ts';
import { householdOwnsPhoto, PHOTO_MAX_BYTES, photoPath, THUMB_MAX_BYTES } from './photos.ts';
import {
	assignAllStandardImages,
	assignStandardImages,
	checkLibrary,
	LIBRARY,
	libraryName
} from './standard-images.ts';
import { STANDARD_ITEMS } from './standard-items.ts';
import { TEST_ENV, expectHttpError, freshDb, makeHousehold } from './testing.ts';

// Real files unless a test says otherwise.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return { ...fs, existsSync: vi.fn(fs.existsSync) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs/promises')>();
	return { ...fs, readFile: vi.fn(fs.readFile) };
});

const NOW = Date.UTC(2026, 10, 5, 17, 0);
const LATER = NOW + 24 * 60 * 60 * 1000;
const KEY = '0123456789abcdef0123456789abcdef';

/** The width and height a JPEG's frame header gives. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
	let at = 2;
	while (at < bytes.length) {
		const marker = bytes[at + 1]!;
		// Start of frame: baseline, extended or progressive.
		if (marker >= 0xc0 && marker <= 0xc2) {
			return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
		}
		at += 2 + bytes.readUInt16BE(at + 2);
	}
	throw new Error('No frame header');
}

describe('the library', () => {
	it("has each standard item's photo and thumbnail, and its credits", () => {
		const files = STANDARD_ITEMS.flatMap((name) => [
			`${libraryName(name)}.jpg`,
			`${libraryName(name)}-thumb.jpg`
		]);
		// Sorted the same way, which also shows that no two items share a name.
		expect(readdirSync(LIBRARY).sort()).toEqual([...files, 'credits.csv'].sort());
	});

	it('names them after the item, without case, accents or punctuation', () => {
		expect(libraryName('Apples')).toBe('apples');
		expect(libraryName('Jalapeños')).toBe('jalapenos');
		expect(libraryName('Half-and-Half')).toBe('half-and-half');
		expect(libraryName('BBQ Sauce')).toBe('bbq-sauce');
	});

	it('stores them as Items stores an image: square JPEGs, the thumbnail 400 px (MEA-50)', () => {
		for (const name of STANDARD_ITEMS) {
			const photo = readFileSync(join(LIBRARY, `${libraryName(name)}.jpg`));
			const thumb = readFileSync(join(LIBRARY, `${libraryName(name)}-thumb.jpg`));
			for (const bytes of [photo, thumb]) expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
			expect(photo.length).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
			expect(thumb.length).toBeLessThanOrEqual(THUMB_MAX_BYTES);
			const { width, height } = jpegSize(photo);
			expect(width, name).toBe(height);
			expect(width, name).toBeGreaterThanOrEqual(400);
			expect(width, name).toBeLessThanOrEqual(800);
			expect(jpegSize(thumb), name).toEqual({ width: 400, height: 400 });
		}
	});

	it('credits each photo: where it came from, who took it and a license needing no credit', () => {
		const csv = parseCsv(readFileSync(join(LIBRARY, 'credits.csv'), 'utf8'));
		if (csv.kind !== 'rows') throw new Error('Not CSV');
		const [header, ...rows] = csv.rows;
		expect(header).toEqual(['Item', 'Source', 'Author', 'License']);
		expect(rows.map((row) => row[0])).toEqual([...STANDARD_ITEMS]);
		for (const [item, source, author, license] of rows) {
			expect(source, item).toMatch(/^https:\/\/\S+$/);
			expect(author, item).not.toBe('');
			expect(['CC0', 'Public domain', 'Pixabay Content License'], item).toContain(license);
		}
	});
});

describe('checkLibrary', () => {
	it('passes when every photo is there', () => {
		expect(() => checkLibrary()).not.toThrow();
	});

	it('throws when one is missing, as when the library was left out of the app', () => {
		const missing = join(LIBRARY, 'kale-thumb.jpg');
		const exists = vi.mocked(existsSync).getMockImplementation()!;
		vi.mocked(existsSync).mockImplementation((path) => path !== missing && exists(path));
		try {
			expect(() => checkLibrary()).toThrow(`The standard image ${missing} is missing`);
		} finally {
			vi.mocked(existsSync).mockImplementation(exists);
		}
	});
});

describe('assignStandardImages', () => {
	let dataDir: string;
	let householdId: number;

	beforeEach(() => {
		freshDb();
		({ householdId } = makeHousehold());
		dataDir = mkdtempSync(join(tmpdir(), 'meals-standard-images-'));
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

	function item(name: string, household = householdId) {
		const found = findItemByName(household, name);
		if (!found) throw new Error(`No ${name}`);
		const { checkedAt } = db()
			.select({ checkedAt: items.standardImageCheckedAt })
			.from(items)
			.where(eq(items.id, found.id))
			.get()!;
		return { ...found, checkedAt };
	}

	/** The item's image, checking it's a copy of the library's photo for `standard`. */
	function copyOf(name: string, standard: string, household = householdId): string {
		const key = item(name, household).photoKey;
		if (key === null) throw new Error(`${name} has no image`);
		const library = libraryName(standard);
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

	/** Makes recording that an item was checked fail, as a full disk would. */
	function failToRecord(): void {
		db().run(
			sql.raw(`create trigger fail_to_record before update of standard_image_checked_at on items
				begin select raise(abort, 'Simulated failure'); end`)
		);
	}

	it('gives each standard item, archived or not, a copy of its photo, matching names ignoring case', async () => {
		createItem(householdId, 'Apples', 0);
		createItem(householdId, 'JALAPEÑOS', 0);
		setItemArchived(householdId, createItem(householdId, 'milk', 0).id, true, 0);
		createItem(householdId, 'Oat milk', 0);

		await assignStandardImages(householdId, NOW);

		const keys = [
			copyOf('Apples', 'Apples'),
			copyOf('JALAPEÑOS', 'Jalapeños'),
			copyOf('milk', 'Milk')
		];
		expect(new Set(keys).size).toBe(3);
		expect(storedFiles()).toEqual(filesFor(...keys));
		expect(item('milk').archivedAt).toBe(0);
		expect(item('Oat milk').photoKey).toBeNull();
		for (const name of ['Apples', 'JALAPEÑOS', 'milk', 'Oat milk']) {
			expect(item(name).checkedAt).toBe(NOW);
		}
	});

	it('keeps an image an item already has', async () => {
		const bananas = createItem(householdId, 'Bananas', 0).id;
		setItemPhoto(householdId, bananas, KEY);

		await assignStandardImages(householdId, NOW);

		expect(item('Bananas')).toMatchObject({ photoKey: KEY, checkedAt: NOW });
		expect(storedFiles()).toEqual([]);
	});

	it('checks each item once, so an image removed, replaced or renamed stays as it is', async () => {
		for (const name of ['Apples', 'Bananas', 'Kale', 'Muesli']) createItem(householdId, name, 0);
		await assignStandardImages(householdId, NOW);
		const kale = item('Kale');
		// Apples' image removed, Bananas' replaced, Kale renamed, and an item that isn't standard
		// renamed to a standard name.
		setItemPhoto(householdId, item('Apples').id, null);
		setItemPhoto(householdId, item('Bananas').id, KEY);
		updateItem(householdId, kale.id, { name: 'Lacinato kale', notes: null });
		updateItem(householdId, item('Muesli').id, { name: 'Granola', notes: null });
		const files = storedFiles();

		// As when the app starts again.
		await assignAllStandardImages(LATER);

		expect(item('Apples')).toMatchObject({ photoKey: null, checkedAt: NOW });
		expect(item('Bananas')).toMatchObject({ photoKey: KEY, checkedAt: NOW });
		expect(item('Lacinato kale')).toMatchObject({ photoKey: kale.photoKey, checkedAt: NOW });
		expect(item('Granola')).toMatchObject({ photoKey: null, checkedAt: NOW });
		expect(storedFiles()).toEqual(files);
	});

	it('gives an item made later its image, as when a standard name is free again', async () => {
		createItem(householdId, 'Apples', 0);
		await assignStandardImages(householdId, NOW);
		const gala = item('Apples');
		updateItem(householdId, gala.id, { name: 'Gala apples', notes: null });
		addNeed(
			householdId,
			{ itemName: 'apples', quantity: 6, unit: null, store: 'none', resolution: 'none' },
			LATER
		);

		await assignStandardImages(householdId, LATER);

		const apples = copyOf('apples', 'Apples');
		expect(apples).not.toBe(gala.photoKey);
		expect(item('apples').checkedAt).toBe(LATER);
		expect(item('Gala apples')).toMatchObject({ photoKey: gala.photoKey, checkedAt: NOW });
	});

	it("gives each household its own copies, and checks only the one it's given", async () => {
		const other = makeHousehold().householdId;
		createItem(householdId, 'Kale', 0);
		createItem(other, 'Kale', 0);

		await assignStandardImages(householdId, NOW);
		const ours = copyOf('Kale', 'Kale');
		expect(item('Kale', other)).toMatchObject({ photoKey: null, checkedAt: null });

		await assignAllStandardImages(LATER);
		const theirs = copyOf('Kale', 'Kale', other);
		expect(theirs).not.toBe(ours);
		expect(householdOwnsPhoto(householdId, theirs)).toBe(false);
		expect(householdOwnsPhoto(other, ours)).toBe(false);
	});

	it("stops at a photo it can't read, keeping what it did, and finishes the next time", async () => {
		for (const name of ['Apples', 'Bananas', 'Carrots']) createItem(householdId, name, 0);
		failToRead('bananas.jpg', new Error('ENOENT: no such file'));

		await expect(assignStandardImages(householdId, NOW)).rejects.toThrow('ENOENT');
		const apples = copyOf('Apples', 'Apples');
		expect(item('Bananas')).toMatchObject({ photoKey: null, checkedAt: null });
		expect(item('Carrots')).toMatchObject({ photoKey: null, checkedAt: null });
		expect(storedFiles()).toEqual(filesFor(apples));

		vi.mocked(readFile).mockReset();
		await assignStandardImages(householdId, LATER);
		expect(item('Apples').checkedAt).toBe(NOW);
		expect(storedFiles()).toEqual(
			filesFor(apples, copyOf('Bananas', 'Bananas'), copyOf('Carrots', 'Carrots'))
		);
	});

	it("stores nothing from a library photo that isn't a JPEG", async () => {
		createItem(householdId, 'Apples', 0);
		const read = vi.mocked(readFile).getMockImplementation()!;
		vi.mocked(readFile).mockImplementation((path, options) =>
			path === join(LIBRARY, 'apples.jpg')
				? Promise.resolve(Buffer.from('<html>Not a photo</html>'))
				: read(path, options)
		);

		await expect(assignStandardImages(householdId, NOW)).rejects.toMatchObject({ status: 400 });
		expect(item('Apples')).toMatchObject({ photoKey: null, checkedAt: null });
		expect(storedFiles()).toEqual([]);
	});

	it("stores nothing when the photos folder can't be written", async () => {
		createItem(householdId, 'Apples', 0);
		// A file where the folder would go.
		writeFileSync(join(dataDir, 'photos'), '');

		await expect(assignStandardImages(householdId, NOW)).rejects.toThrow();
		expect(item('Apples')).toMatchObject({ photoKey: null, checkedAt: null });
	});

	it('deletes its copy when recording it fails, and tries again next time', async () => {
		createItem(householdId, 'Apples', 0);
		failToRecord();

		await expect(assignStandardImages(householdId, NOW)).rejects.toThrow('Simulated failure');
		expect(item('Apples')).toMatchObject({ photoKey: null, checkedAt: null });
		expect(storedFiles()).toEqual([]);

		db().run(sql.raw('drop trigger fail_to_record'));
		await assignStandardImages(householdId, LATER);
		expect(storedFiles()).toEqual(filesFor(copyOf('Apples', 'Apples')));
	});

	it('keeps an image the item got while its copy was being stored, and deletes the copy', async () => {
		const apples = createItem(householdId, 'Apples', 0).id;
		const read = vi.mocked(readFile).getMockImplementation()!;
		vi.mocked(readFile).mockImplementationOnce((path, options) => {
			// Someone saves an image on Items meanwhile.
			setItemPhoto(householdId, apples, KEY);
			return read(path, options);
		});

		await assignStandardImages(householdId, NOW);

		expect(item('Apples')).toMatchObject({ photoKey: KEY, checkedAt: NOW });
		expect(storedFiles()).toEqual([]);
	});
});

describe('setStandardImage', () => {
	beforeEach(freshDb);

	it("gives the image only the first time, and only to an item that hasn't one", () => {
		const { householdId } = makeHousehold();
		const apples = createItem(householdId, 'Apples', 0).id;
		const pears = createItem(householdId, 'Pears', 0).id;
		setItemPhoto(householdId, pears, KEY);

		expect(setStandardImage(householdId, apples, 'a'.repeat(32), NOW)).toBe(true);
		expect(setStandardImage(householdId, apples, 'b'.repeat(32), LATER)).toBe(false);
		expect(setStandardImage(householdId, pears, 'c'.repeat(32), NOW)).toBe(false);

		expect(findItemByName(householdId, 'Apples')?.photoKey).toBe('a'.repeat(32));
		expect(findItemByName(householdId, 'Pears')?.photoKey).toBe(KEY);
	});

	it("is not found for another household's item, which stays unchecked", () => {
		const { householdId } = makeHousehold();
		const other = makeHousehold().householdId;
		const theirs = createItem(other, 'Apples', 0).id;

		expectHttpError(() => setStandardImage(householdId, theirs, KEY, NOW), 404);
		expect(setStandardImage(other, theirs, null, NOW)).toBe(false);
		expect(findItemByName(other, 'Apples')?.photoKey).toBeNull();
	});
});
