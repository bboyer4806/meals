import { createHash, randomBytes } from 'node:crypto';
import { test as base } from '@playwright/test';
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

	person: async ({ db, context, baseURL }, use, testInfo) => {
		counter += 1;
		const tag = `${testInfo.workerIndex}-${counter}-${Date.now()}`;
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
		await signInAs(db, context, baseURL, userId);
		await use({ userId, householdId, email });
	}
});

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
