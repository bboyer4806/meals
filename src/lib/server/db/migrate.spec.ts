import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './index.ts';

/** A copy of ./drizzle with one more migration appended. */
function foldersWith(extraSql: string): string {
	const folder = mkdtempSync(join(tmpdir(), 'meals-migrations-'));
	cpSync('drizzle', folder, { recursive: true });
	const journalPath = join(folder, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
	const last = journal.entries.at(-1);
	journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: '9999_extra' });
	writeFileSync(journalPath, JSON.stringify(journal));
	writeFileSync(join(folder, '9999_extra.sql'), extraSql);
	return folder;
}

/** A copy of ./drizzle that stops just before the migration tagged `tag`. */
function foldersBefore(tag: string): string {
	const folder = mkdtempSync(join(tmpdir(), 'meals-migrations-'));
	cpSync('drizzle', folder, { recursive: true });
	const journalPath = join(folder, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
	const index = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag);
	if (index === -1) throw new Error(`No migration tagged ${tag}`);
	journal.entries = journal.entries.slice(0, index);
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

function applied(sqlite: Database.Database): number {
	return sqlite.prepare('select count(*) from "__drizzle_migrations"').pluck().get() as number;
}

/** How many migrations the repo has. */
const MIGRATIONS = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.length;

describe('migrate', () => {
	it('applies pending migrations once', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, 'drizzle');
		migrate(sqlite, 'drizzle');
		expect(applied(sqlite)).toBe(MIGRATIONS);
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('rolls back a migration that leaves a broken reference, instead of recording it', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, 'drizzle');
		sqlite
			.prepare(
				"insert into households (name, default_servings, time_zone, created_at) values ('A', 2, 'UTC', 0)"
			)
			.run();
		const broken = foldersWith(
			"insert into items (household_id, name, default_store_id, created_at) values (1, 'Ghost', 99, 0);"
		);
		expect(() => migrate(sqlite, broken)).toThrow(/Foreign key violations/);
		expect(applied(sqlite)).toBe(MIGRATIONS);
		expect(sqlite.prepare('select count(*) from items').pluck().get()).toBe(0);
	});
});

// The one-time change that links every old request to a recipe (design 6.12).
describe('link-requests', () => {
	it('links each unlinked request to a dish with its name, or a new one', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, foldersBefore('0009_link-requests'));
		const run = (statement: string, ...values: unknown[]) =>
			Number(sqlite.prepare(statement).run(...values).lastInsertRowid);
		const household = (servings: number) =>
			run(
				"insert into households (name, default_servings, time_zone, created_at) values ('H', ?, 'UTC', 0)",
				servings
			);
		const user = (householdId: number) =>
			run(
				"insert into users (household_id, google_sub, email, name, created_at) values (?, ?, ?, 'P', 0)",
				householdId,
				`sub-${householdId}`,
				`p${householdId}@example.com`
			);
		const dish = (householdId: number, name: string, archivedAt: number | null) =>
			run(
				'insert into dishes (household_id, name, servings, archived_at, created_at, updated_at) values (?, ?, 2, ?, 0, 0)',
				householdId,
				name,
				archivedAt
			);
		const ask = (householdId: number, userId: number, name: string, at: number) =>
			run(
				'insert into dish_requests (household_id, user_id, name, note, dish_id, created_at) values (?, ?, ?, null, null, ?)',
				householdId,
				userId,
				name,
				at
			);

		const home = household(4);
		const other = household(6);
		const homeUser = user(home);
		const otherUser = user(other);
		const chili = dish(home, 'Chili', null);
		const lasagna = dish(home, 'Lasagna', 5);
		const otherGumbo = dish(other, 'Gumbo', null);
		const active = ask(home, homeUser, 'CHILI', 1);
		const archived = ask(home, homeUser, 'lasagna', 2);
		// The later spelling comes first by id, so only the date can pick the oldest.
		const later = ask(home, homeUser, 'éclairs', 4);
		const oldest = ask(home, homeUser, 'Éclairs', 3);
		const gumbo = ask(home, homeUser, 'Gumbo', 5);
		const elsewhere = ask(other, otherUser, 'Pho', 6);
		const elsewhereGumbo = ask(other, otherUser, 'gumbo', 7);

		migrate(sqlite, 'drizzle');

		const linkOf = (requestId: number) =>
			sqlite.prepare('select name, dish_id from dish_requests where id = ?').get(requestId) as {
				name: string;
				dish_id: number;
			};
		const dishById = (dishId: number) =>
			sqlite
				.prepare(
					'select household_id, name, servings, archived_at, created_at from dishes where id = ?'
				)
				.get(dishId);

		expect(linkOf(active)).toEqual({ name: 'CHILI', dish_id: chili });
		expect(linkOf(archived)).toEqual({ name: 'lasagna', dish_id: lasagna });
		expect(dishById(lasagna)).toMatchObject({ archived_at: 5 });
		expect(linkOf(elsewhereGumbo)).toEqual({ name: 'gumbo', dish_id: otherGumbo });

		const eclairs = linkOf(oldest).dish_id;
		expect(linkOf(later)).toEqual({ name: 'éclairs', dish_id: eclairs });
		expect(dishById(eclairs)).toEqual({
			household_id: home,
			name: 'Éclairs',
			servings: 4,
			archived_at: null,
			created_at: 3
		});
		// Its own Gumbo, not the other household's.
		expect(dishById(linkOf(gumbo).dish_id)).toMatchObject({ household_id: home, name: 'Gumbo' });
		expect(dishById(linkOf(elsewhere).dish_id)).toMatchObject({
			household_id: other,
			name: 'Pho',
			servings: 6
		});
		// Chili, Lasagna, the other Gumbo, and the new Éclairs, Gumbo and Pho.
		expect(sqlite.prepare('select count(*) from dishes').pluck().get()).toBe(6);
	});
});

// The change that adds restaurant requests, in request-kind and restaurant-requests (design 6.12).
describe('restaurant-requests', () => {
	it('keeps every older request as a dish request, linked as before', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, foldersBefore('0011_request-kind'));
		const run = (statement: string, ...values: unknown[]) =>
			Number(sqlite.prepare(statement).run(...values).lastInsertRowid);
		const household = run(
			"insert into households (name, default_servings, time_zone, created_at) values ('H', 4, 'UTC', 0)"
		);
		const user = run(
			"insert into users (household_id, google_sub, email, name, created_at) values (?, 'sub', 'p@example.com', 'P', 0)",
			household
		);
		const dish = (name: string, archivedAt: number | null) =>
			run(
				'insert into dishes (household_id, name, servings, archived_at, created_at, updated_at) values (?, ?, 2, ?, 0, 0)',
				household,
				name,
				archivedAt
			);
		const ask = (name: string, note: string | null, dishId: number, at: number) =>
			run(
				'insert into dish_requests (household_id, user_id, name, note, dish_id, created_at) values (?, ?, ?, ?, ?, ?)',
				household,
				user,
				name,
				note,
				dishId,
				at
			);
		const chili = dish('Chili', null);
		const lasagna = dish('Lasagna', 5);
		const first = ask('CHILI', 'Extra beans', chili, 1);
		const second = ask('lasagna', null, lasagna, 2);

		migrate(sqlite, 'drizzle');

		expect(
			sqlite
				.prepare(
					'select id, user_id, kind, name, note, dish_id, created_at from dish_requests order by id'
				)
				.all()
		).toEqual([
			{
				id: first,
				user_id: user,
				kind: 'dish',
				name: 'CHILI',
				note: 'Extra beans',
				dish_id: chili,
				created_at: 1
			},
			{
				id: second,
				user_id: user,
				kind: 'dish',
				name: 'lasagna',
				note: null,
				dish_id: lasagna,
				created_at: 2
			}
		]);
	});
});

// The change that gives an Eating out dinner its restaurant (design 6.9).
describe('restaurant-name', () => {
	it('keeps every dinner and its dishes as they were, with no restaurant', () => {
		const sqlite = new Database(':memory:');
		migrate(sqlite, foldersBefore('0013_restaurant-name'));
		const run = (statement: string, ...values: unknown[]) =>
			Number(sqlite.prepare(statement).run(...values).lastInsertRowid);
		const household = run(
			"insert into households (name, default_servings, time_zone, created_at) values ('H', 4, 'UTC', 0)"
		);
		const tacos = run(
			"insert into dishes (household_id, name, servings, created_at, updated_at) values (?, 'Tacos', 2, 0, 0)",
			household
		);
		const dinner = (date: string, type: string, label: string | null, note: string | null) =>
			run(
				'insert into dinners (household_id, date, label, type, note, servings, created_at, updated_at) values (?, ?, ?, ?, ?, 3, 1, 2)',
				household,
				date,
				label,
				type,
				note
			);
		const kids = dinner('2026-10-01', 'cook', 'Kids', 'Busy');
		dinner('2026-10-01', 'eat_out', 'Adults', 'Thai place');
		dinner('2026-10-02', 'going', null, null);
		dinner('2026-10-03', 'leftovers', null, 'Soup');
		run(
			"insert into dinner_dishes (household_id, dinner_id, dish_id, role) values (?, ?, ?, 'main')",
			household,
			kids,
			tacos
		);
		const dinners = () => sqlite.prepare('select * from dinners order by id').all();
		const before = dinners() as Record<string, unknown>[];

		migrate(sqlite, 'drizzle');

		expect(dinners()).toEqual(before.map((row) => ({ ...row, restaurant_name: null })));
		expect(sqlite.prepare('select dinner_id, dish_id, role from dinner_dishes').all()).toEqual([
			{ dinner_id: kids, dish_id: tacos, role: 'main' }
		]);
	});
});

// The change that records the newest release someone has seen on What's new by its version
// instead of its date (design 7, MEA-25).
describe('whats-new-seen-version', () => {
	/** A database from just before the change, with one person per saved value, in order. */
	function savedBefore(values: (string | null)[]): Database.Database {
		const sqlite = new Database(':memory:');
		migrate(sqlite, foldersBefore('0014_whats-new-seen-version'));
		const household = sqlite
			.prepare(
				"insert into households (name, default_servings, time_zone, created_at) values ('H', 4, 'UTC', 0)"
			)
			.run().lastInsertRowid;
		values.forEach((value, i) => {
			sqlite
				.prepare(
					"insert into users (household_id, google_sub, email, name, created_at, whats_new_seen) values (?, ?, ?, 'P', 0, ?)"
				)
				.run(household, `sub-${i}`, `p${i}@example.com`, value);
		});
		return sqlite;
	}

	const seen = (sqlite: Database.Database) =>
		sqlite.prepare('select whats_new_seen from users order by id').pluck().all();

	it('changes each saved date to the newest release that day, and keeps empty ones', () => {
		const sqlite = savedBefore([
			'2026-10-14',
			'2026-10-20',
			'2026-10-21',
			null,
			'2026-10-24',
			'2026-10-26',
			'2026-11-02'
		]);
		migrate(sqlite, 'drizzle');
		// 1.3, 1.4 and 1.5 all came out on 2026-10-21.
		expect(seen(sqlite)).toEqual(['1.1', '1.2', '1.5', null, '1.6', '1.7', '1.8']);
	});

	it('stops at a date that no release has, changing nothing', () => {
		const sqlite = savedBefore(['2026-10-21', '2026-10-22']);
		const before = applied(sqlite);
		expect(() => migrate(sqlite, 'drizzle')).toThrow(
			'whats_new_seen has a date that no release has'
		);
		expect(seen(sqlite)).toEqual(['2026-10-21', '2026-10-22']);
		expect(applied(sqlite)).toBe(before);
	});
});
