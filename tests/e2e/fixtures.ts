import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test as base, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

export { expect } from '@playwright/test';

type Person = { userId: number; householdId: number; email: string };

type Fixtures = {
	/** Writes rows straight into the test server's database. */
	db: Database.Database;
	/** A household with one signed-in member, unique to the test. */
	person: Person;
};

let counter = 0;

export const test = base.extend<Fixtures>({
	db: async ({}, use) => {
		const db = new Database('.e2e-data/meals.db');
		db.pragma('busy_timeout = 5000');
		db.pragma('foreign_keys = ON');
		await use(db);
		db.close();
	},

	person: async ({ db, context, baseURL }, use) => {
		const person = addPerson(db);
		await signInAs(db, context, baseURL, person.userId);
		await use(person);
	}
});

/** A household with one member, not signed in. Usual servings 4. */
export function addPerson(db: Database.Database): Person {
	counter += 1;
	const tag = `${test.info().workerIndex}-${counter}-${Date.now()}`;
	const now = Date.now();
	const householdId = Number(
		db
			.prepare(
				'insert into households (name, default_servings, time_zone, created_at) values (?, 4, ?, ?)'
			)
			.run(`Household ${tag}`, 'America/Chicago', now).lastInsertRowid
	);
	const email = `person-${tag}@example.com`;
	const userId = Number(
		db
			.prepare(
				'insert into users (household_id, google_sub, email, name, created_at) values (?, ?, ?, ?, ?)'
			)
			.run(householdId, `sub-${tag}`, email, `Person ${counter}`, now).lastInsertRowid
	);
	return { userId, householdId, email };
}

/** Creates a session the same way the app does and puts its cookie in the browser. */
export async function signInAs(
	db: Database.Database,
	context: import('@playwright/test').BrowserContext,
	baseURL: string | undefined,
	userId: number
) {
	const token = randomBytes(20).toString('base64url');
	const id = createHash('sha256').update(token).digest('hex');
	db.prepare('insert into sessions (id, user_id, expires_at) values (?, ?, ?)').run(
		id,
		userId,
		Date.now() + 24 * 60 * 60 * 1000
	);
	await context.addCookies([{ name: 'session', value: token, url: baseURL }]);
}

export function addStore(db: Database.Database, householdId: number, name: string): number {
	return Number(
		db.prepare('insert into stores (household_id, name) values (?, ?)').run(householdId, name)
			.lastInsertRowid
	);
}

/** The household's item with this name (ignoring case), added if it's new. */
export function addItem(
	db: Database.Database,
	householdId: number,
	name: string,
	fields: { defaultStoreId?: number | null; alwaysHave?: boolean } = {}
): number {
	const existing = db
		.prepare('select id from items where household_id = ? and lower(name) = lower(?)')
		.pluck()
		.get(householdId, name) as number | undefined;
	if (existing !== undefined) return existing;
	return Number(
		db
			.prepare(
				'insert into items (household_id, name, default_store_id, always_have, created_at) values (?, ?, ?, ?, ?)'
			)
			.run(householdId, name, fields.defaultStoreId ?? null, fields.alwaysHave ? 1 : 0, Date.now())
			.lastInsertRowid
	);
}

export type RecipeSeed = {
	name: string;
	servings?: number;
	prepMinutes?: number | null;
	cookMinutes?: number | null;
	steps?: string | null;
	notes?: string | null;
	tags?: string[];
	ingredients?: {
		item: string;
		amount?: number | null;
		unit?: string | null;
		prepNote?: string | null;
		section?: string | null;
	}[];
	photoKey?: string | null;
	archived?: boolean;
};

/** Writes a recipe straight into the database, adding its items, and returns its id. */
export function addRecipe(db: Database.Database, householdId: number, recipe: RecipeSeed): number {
	const now = Date.now();
	const dishId = Number(
		db
			.prepare(
				`insert into dishes (household_id, name, servings, prep_minutes, cook_minutes, steps, notes,
					photo_key, archived_at, created_at, updated_at)
				values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				householdId,
				recipe.name,
				recipe.servings ?? 4,
				recipe.prepMinutes ?? null,
				recipe.cookMinutes ?? null,
				recipe.steps ?? null,
				recipe.notes ?? null,
				recipe.photoKey ?? null,
				recipe.archived ? now : null,
				now,
				now
			).lastInsertRowid
	);
	for (const tag of recipe.tags ?? []) {
		db.prepare('insert into dish_tags (household_id, dish_id, tag) values (?, ?, ?)').run(
			householdId,
			dishId,
			tag
		);
	}
	const addIngredient = db.prepare(
		`insert into dish_ingredients (household_id, dish_id, position, section, amount, unit, item_id, prep_note)
		values (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	(recipe.ingredients ?? []).forEach((row, position) => {
		addIngredient.run(
			householdId,
			dishId,
			position,
			row.section ?? null,
			row.amount ?? null,
			row.unit ?? null,
			addItem(db, householdId, row.item),
			row.prepNote ?? null
		);
	});
	return dishId;
}

/**
 * A real JPEG, drawn on a canvas in the browser: a warm background with a plate on it. Works on
 * any page, including about:blank.
 */
export async function makeJpeg(
	page: Page,
	size: { width: number; height: number; hue?: number }
): Promise<Buffer> {
	const base64 = await page.evaluate(({ width, height, hue }) => {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('No canvas');
		const background = context.createLinearGradient(0, 0, width, height);
		background.addColorStop(0, `hsl(${hue} 70% 62%)`);
		background.addColorStop(1, `hsl(${hue + 25} 55% 32%)`);
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);
		const radius = Math.min(width, height) * 0.36;
		context.fillStyle = '#fbf3e4';
		context.beginPath();
		context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = `hsl(${hue + 10} 65% 45%)`;
		context.beginPath();
		context.arc(width / 2, height / 2, radius * 0.6, 0, Math.PI * 2);
		context.fill();
		return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
	}, { hue: 20, ...size });
	const bytes = Buffer.from(base64, 'base64');
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Not a JPEG');
	return bytes;
}

/** Stores a photo and its thumbnail where the server keeps them, and returns the new key. */
export function addPhotoFiles(photo: Buffer, thumb: Buffer): string {
	const key = randomBytes(16).toString('hex');
	mkdirSync('.e2e-data/photos', { recursive: true });
	writeFileSync(photoFile(key, 'full'), photo);
	writeFileSync(photoFile(key, 'thumb'), thumb);
	return key;
}

export function photoFile(key: string, size: 'full' | 'thumb'): string {
	return `.e2e-data/photos/${key}${size === 'thumb' ? '-thumb' : ''}.jpg`;
}
