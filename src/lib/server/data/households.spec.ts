import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { households, items, sessions, users } from '../db/schema.ts';
import { createSession } from '../auth/session.ts';
import { signIn } from '../auth/sign-in.ts';
import { STANDARD_ITEMS } from '../standard-items.ts';
import {
	expectHttpError,
	freshDb,
	makeDish,
	makeHousehold,
	makeStore,
	recipe
} from '../testing.ts';
import { getOwnRating, rateDish } from './dishes.ts';
import {
	addStandardItemsToAllHouseholds,
	cancelInvite,
	createHousehold,
	createInvite,
	getHousehold,
	listInvites,
	listMembers,
	removeMember
} from './households.ts';
import {
	createItem,
	findItemByName,
	listCatalog,
	listPickerItems,
	setItemArchived,
	setItemPhoto,
	updateItem
} from './items.ts';
import { addNeed, listActiveLines, listHistory, markReceived } from './needs.ts';

beforeEach(freshDb);

const settings = { name: 'The Boyers', defaultServings: 4, timeZone: 'America/Chicago' };

describe('households', () => {
	it('sets up a household once for a person without one', () => {
		const user = db()
			.insert(users)
			.values({ googleSub: 'g', email: 'a@example.com', name: 'A', createdAt: 0 })
			.returning()
			.get();
		const householdId = createHousehold(user.id, settings, 0);
		expect(listMembers(householdId).map((m) => m.email)).toEqual(['a@example.com']);
		expectHttpError(() => createHousehold(user.id, settings, 0), 400);
	});

	it('lets members remove others but not themselves', () => {
		const { householdId, userId } = makeHousehold();
		const other = db()
			.insert(users)
			.values({ householdId, googleSub: 'g2', email: 'b@example.com', name: 'B', createdAt: 0 })
			.returning()
			.get();
		createSession(other.id, 0);
		expectHttpError(() => removeMember(householdId, userId, userId), 400);
		removeMember(householdId, userId, other.id);
		expect(listMembers(householdId)).toHaveLength(1);
		expect(db().select().from(sessions).all()).toHaveLength(0);
	});

	it("can't remove someone from another household or change their ratings", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		const omelet = makeDish(theirs.householdId, recipe('Omelet'));
		rateDish(theirs.householdId, omelet, theirs.userId, 4);
		removeMember(mine.householdId, mine.userId, theirs.userId);
		expect(listMembers(theirs.householdId).map((m) => m.id)).toEqual([theirs.userId]);
		expect(getOwnRating(theirs.householdId, omelet, theirs.userId)).toBe(4);
	});

	it('counts a member someone else already removed as removed (6.1)', () => {
		const { householdId, userId } = makeHousehold();
		const other = db()
			.insert(users)
			.values({ householdId, googleSub: 'g2', email: 'b@example.com', name: 'B', createdAt: 0 })
			.returning()
			.get();
		removeMember(householdId, userId, other.id);
		// A page that still shows them.
		removeMember(householdId, userId, other.id);
		expect(listMembers(householdId).map((m) => m.id)).toEqual([userId]);
	});
});

// The standard items every household's catalog starts with (design 6.13).
describe('standard items', () => {
	const TZ = 'America/Chicago';
	// Sat 2026-10-03 12:00 in Chicago, and a day later.
	const NOW = Date.UTC(2026, 9, 3, 17, 0);
	const LATER = NOW + 24 * 60 * 60 * 1000;
	const KEY = '0123456789abcdef0123456789abcdef';

	/** Every item in the household, archived ones included, in the order they were added. */
	function allItems(householdId: number) {
		return db()
			.select()
			.from(items)
			.where(eq(items.householdId, householdId))
			.orderBy(asc(items.id))
			.all();
	}

	/** Items as the standard items add them: active, with nothing filled in. */
	function added(householdId: number, names: readonly string[], at: number) {
		return names.map((name) => ({
			id: expect.any(Number),
			householdId,
			name,
			notes: null,
			defaultStoreId: null,
			alwaysHave: false,
			photoKey: null,
			archivedAt: null,
			createdAt: at
		}));
	}

	/** Someone signed in who hasn't set up a household yet. */
	function newcomer(): number {
		return db()
			.insert(users)
			.values({ googleSub: 'g-new', email: 'new@example.com', name: 'New', createdAt: 0 })
			.returning({ id: users.id })
			.get().id;
	}

	/** Makes adding an item with this name fail, as a full disk would. */
	function failToAdd(name: string): void {
		db().run(
			sql.raw(
				`create trigger fail_to_add before insert on items when new.name = '${name}'
				begin select raise(abort, 'Simulated failure'); end`
			)
		);
	}

	function stopFailing(): void {
		db().run(sql.raw('drop trigger fail_to_add'));
	}

	it('gives a new household every one, ready to find and pick, and nothing on the list', () => {
		const householdId = createHousehold(newcomer(), settings, NOW);
		expect(allItems(householdId)).toEqual(added(householdId, STANDARD_ITEMS, NOW));
		expect(getHousehold(householdId).standardItemsAddedAt).toBe(NOW);
		expect(listCatalog(householdId, false, '')).toHaveLength(288);
		expect(listCatalog(householdId, false, 'jalape').map((item) => item.name)).toEqual([
			'Jalapeños'
		]);
		expect(listPickerItems(householdId)).toHaveLength(288);
		expect(listActiveLines(householdId, TZ, NOW)).toEqual([]);
	});

	it('adds what an existing household lacks when the app starts, keeping what it has', () => {
		const { householdId } = makeHousehold(TZ);
		const walmart = makeStore(householdId, 'Walmart');
		// Milk as someone typed it, with notes, an image, a usual store and history.
		addNeed(
			householdId,
			{ itemName: 'milk', quantity: 1, unit: 'gal', store: walmart, resolution: 'none' },
			1
		);
		const milk = findItemByName(householdId, 'milk')!.id;
		updateItem(householdId, milk, { name: 'milk', notes: 'Whole' });
		setItemPhoto(householdId, milk, KEY);
		markReceived(householdId, listActiveLines(householdId, TZ, 1)[0]!.id, walmart, 2);
		// A standard name in other case with its accent, an archived one, and one not standard.
		createItem(householdId, 'JALAPEÑOS', 0);
		setItemArchived(householdId, createItem(householdId, 'Bananas', 0).id, true, 0);
		createItem(householdId, 'Oat milk', 0);
		const before = allItems(householdId);
		const history = listHistory(householdId, '', 10);

		addStandardItemsToAllHouseholds(NOW);

		const had = ['Milk', 'Jalapeños', 'Bananas'];
		expect(allItems(householdId)).toEqual([
			...before,
			...added(householdId, STANDARD_ITEMS.filter((name) => !had.includes(name)), NOW)
		]);
		expect(listCatalog(householdId, true, '').map((item) => item.name)).toEqual(['Bananas']);
		expect(listHistory(householdId, '', 10)).toEqual(history);
		expect(getHousehold(householdId).standardItemsAddedAt).toBe(NOW);
	});

	it('adds them once, so ones renamed, archived or removed afterward stay that way', () => {
		const { householdId } = makeHousehold(TZ);
		addStandardItemsToAllHouseholds(NOW);
		const id = (name: string) => findItemByName(householdId, name)!.id;
		updateItem(householdId, id('Apples'), { name: 'Honeycrisp apples', notes: null });
		setItemArchived(householdId, id('Bananas'), true, LATER);
		db().delete(items).where(eq(items.id, id('Kale'))).run();
		const before = allItems(householdId);

		// The app starting again. Apples and Kale are missing, as a name added to the list later
		// would be, and stay missing.
		addStandardItemsToAllHouseholds(LATER);

		expect(allItems(householdId)).toEqual(before);
		expect(getHousehold(householdId).standardItemsAddedAt).toBe(NOW);
	});

	it('gives each household its own, and leaves alone one that has had them', () => {
		const older = makeHousehold(TZ).householdId;
		const newer = createHousehold(newcomer(), settings, NOW);
		const apples = findItemByName(newer, 'Apples')!.id;
		updateItem(newer, apples, { name: 'Gala apples', notes: null });
		const newerItems = allItems(newer);

		addStandardItemsToAllHouseholds(LATER);

		expect(allItems(older)).toEqual(added(older, STANDARD_ITEMS, LATER));
		expect(allItems(newer)).toEqual(newerItems);
	});

	it('rolls back a household whose items fail to add, and adds them at the next start', () => {
		const first = makeHousehold(TZ).householdId;
		const second = makeHousehold(TZ).householdId;
		// So only the second adds Pears, which fails partway through its items.
		createItem(first, 'Pears', 0);
		createItem(second, 'Milk', 0);
		failToAdd('Pears');

		expect(() => addStandardItemsToAllHouseholds(NOW)).toThrow('Simulated failure');
		// The first finished before the second started.
		expect(allItems(first)).toHaveLength(288);
		expect(getHousehold(first).standardItemsAddedAt).toBe(NOW);
		expect(allItems(second).map((item) => item.name)).toEqual(['Milk']);
		expect(getHousehold(second).standardItemsAddedAt).toBeNull();

		stopFailing();
		addStandardItemsToAllHouseholds(LATER);
		expect(allItems(first)).toHaveLength(288);
		expect(allItems(second)).toHaveLength(288);
		expect(getHousehold(second).standardItemsAddedAt).toBe(LATER);
	});

	it('sets up no household when its standard items fail to add', () => {
		const userId = newcomer();
		failToAdd('Pears');

		expect(() => createHousehold(userId, settings, NOW)).toThrow('Simulated failure');
		expect(db().select().from(households).all()).toEqual([]);
		expect(db().select().from(items).all()).toEqual([]);
		const person = db().select().from(users).where(eq(users.id, userId)).get();
		expect(person?.householdId).toBeNull();

		stopFailing();
		const householdId = createHousehold(userId, settings, LATER);
		expect(allItems(householdId)).toEqual(added(householdId, STANDARD_ITEMS, LATER));
	});
});

describe('invites', () => {
	it('refuses members and people already invited', () => {
		const { householdId } = makeHousehold();
		const member = listMembers(householdId)[0]!;
		expect(createInvite(householdId, member.email.toUpperCase(), 0)).toEqual({ kind: 'member' });
		expect(createInvite(householdId, 'new@example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(null, 'NEW@example.com', 0)).toEqual({ kind: 'invited-already' });
	});

	it('adds someone who signed in but never set up a household (design 6.1)', () => {
		const { householdId } = makeHousehold();
		const stranded = db()
			.insert(users)
			.values({ googleSub: 'g-dana', email: 'dana@example.com', name: 'Dana', createdAt: 0 })
			.returning()
			.get();
		expect(createInvite(null, 'dana@example.com', 0)).toEqual({ kind: 'member' });
		expect(createInvite(householdId, 'Dana@Example.com', 0)).toEqual({ kind: 'joined' });
		expect(listMembers(householdId).map((m) => m.id)).toContain(stranded.id);
	});

	it("keeps each household's invites to itself", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		createInvite(mine.householdId, 'a@example.com', 0);
		createInvite(null, 'b@example.com', 0);
		expect(listInvites(mine.householdId).map((i) => i.email)).toEqual(['a@example.com']);
		expect(listInvites(null).map((i) => i.email)).toEqual(['b@example.com']);
		const invite = listInvites(mine.householdId)[0]!;
		cancelInvite(theirs.householdId, invite.id);
		cancelInvite(null, invite.id);
		expect(listInvites(mine.householdId)).toEqual([invite]);
		cancelInvite(mine.householdId, invite.id);
		expect(listInvites(mine.householdId)).toHaveLength(0);
	});

	it('cancels nothing for a cancelled invite once a newer one is made', () => {
		const { householdId } = makeHousehold();
		createInvite(householdId, 'a@example.com', 0);
		const [cancelled] = listInvites(householdId);
		cancelInvite(householdId, cancelled!.id);
		createInvite(householdId, 'b@example.com', 0);
		cancelInvite(householdId, cancelled!.id);
		expect(listInvites(householdId).map((invite) => invite.email)).toEqual(['b@example.com']);
	});

	it('counts an invite that was used or cancelled meanwhile as cancelled (6.1)', () => {
		const { householdId } = makeHousehold();
		createInvite(householdId, 'sam@example.com', 0);
		createInvite(null, 'pat@example.com', 0);
		const [sam] = listInvites(householdId);
		const [pat] = listInvites(null);
		// Sam signs in, which uses the invite, and the admin cancels Pat's in another tab.
		signIn({ sub: 'g-sam', email: 'sam@example.com', name: 'Sam' }, 'admin@example.com', 0);
		cancelInvite(null, pat!.id);
		// Pages that still show them.
		cancelInvite(householdId, sam!.id);
		cancelInvite(null, pat!.id);
		expect(listInvites(householdId)).toEqual([]);
		expect(listInvites(null)).toEqual([]);
		expect(listMembers(householdId).map((m) => m.name)).toContain('Sam');
	});
});
