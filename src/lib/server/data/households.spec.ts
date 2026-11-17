import { asc, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISH_REVISIONS } from '../../default-dishes.ts';
import { db } from '../db/index.ts';
import {
	dishes,
	dishRequests,
	households,
	invites,
	items,
	sessions,
	users
} from '../db/schema.ts';
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
import { addDinnerDish, dishSuggestions, getDay } from './dinners.ts';
import {
	findDishByName,
	getDish,
	getOwnRating,
	listDishes,
	rateDish,
	setDishArchived,
	updateDish
} from './dishes.ts';
import {
	addDefaultDishesToAllHouseholds,
	addDefaultDishPhotos,
	addStandardItemsToAllHouseholds,
	cancelInvite,
	createHousehold,
	createInvite,
	getHousehold,
	INVITE_LIMIT,
	joinHousehold,
	listHouseholds,
	listHouseholdsWithoutDefaultDishPhotos,
	listInvites,
	listMembers,
	removeMember,
	setupChoices,
	updateHousehold
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
import { addRestaurantRequest, completeRequest, listRequests } from './requests.ts';

beforeEach(freshDb);

const settings = { name: 'The Boyers', defaultServings: 4, timeZone: 'America/Chicago' };

const ADMIN = 'admin@example.com';

/** Someone signed in without a household, who hasn't joined or set one up yet (6.1). */
function signedInWithout(email: string): number {
	return db()
		.insert(users)
		.values({ googleSub: `g-${email}`, email, name: 'New', createdAt: 0 })
		.returning({ id: users.id })
		.get().id;
}

/** Someone signed in with an invite to start a household, who hasn't set it up yet. */
function newcomer(): number {
	createInvite(null, 'new@example.com', 0);
	return signedInWithout('new@example.com');
}

describe('households', () => {
	it('sets up a household once, for someone invited to start one, using up their invites', () => {
		const { householdId: other } = makeHousehold();
		createInvite(other, 'new@example.com', 0);
		const userId = newcomer();
		const householdId = createHousehold(userId, ADMIN, settings, 0);
		expect(listMembers(householdId).map((m) => m.email)).toEqual(['new@example.com']);
		expect(db().select().from(invites).all()).toEqual([]);
		expectHttpError(() => createHousehold(userId, ADMIN, settings, 0), 400);
	});

	it('sets up a household for the admin, without an invite', () => {
		const admin = signedInWithout(ADMIN);
		expect(setupChoices(admin, ADMIN)).toEqual({ invites: [], mayStart: true });
		const householdId = createHousehold(admin, ADMIN, settings, 0);
		expect(listMembers(householdId).map((m) => m.email)).toEqual([ADMIN]);
	});

	it('sets up no household for anyone else (MEA-112)', () => {
		const { householdId } = makeHousehold();
		createInvite(householdId, 'sam@example.com', 0);
		const sam = signedInWithout('sam@example.com');
		expect(setupChoices(sam, ADMIN).mayStart).toBe(false);
		expectHttpError(() => createHousehold(sam, ADMIN, settings, 0), 400);

		// Nor once their invite to start one is cancelled meanwhile.
		const pat = newcomer();
		cancelInvite(null, listInvites(null)[0]!.id);
		expect(setupChoices(pat, ADMIN)).toEqual({ invites: [], mayStart: false });
		expectHttpError(() => createHousehold(pat, ADMIN, settings, 0), 400);
		expect(db().select().from(households).all()).toHaveLength(1);
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

	it("can't remove someone from another household or change their ratings or requests", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		const omelet = makeDish(theirs.householdId, recipe('Omelet'));
		rateDish(theirs.householdId, omelet, theirs.userId, 4);
		for (const name of ['Diner', 'Cafe']) {
			addRestaurantRequest(theirs.householdId, theirs.userId, { name, note: null }, 0);
		}
		completeRequest(theirs.householdId, listRequests(theirs.householdId)[0]!.id, 1);
		const requests = db().select().from(dishRequests).all();
		removeMember(mine.householdId, mine.userId, theirs.userId);
		expect(listMembers(theirs.householdId).map((m) => m.id)).toEqual([theirs.userId]);
		expect(getOwnRating(theirs.householdId, omelet, theirs.userId)).toBe(4);
		expect(db().select().from(dishRequests).all()).toEqual(requests);
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

	it('leaves one of two members who remove each other at once (2.3, MEA-114)', () => {
		const { householdId, userId } = makeHousehold();
		const other = db()
			.insert(users)
			.values({ householdId, googleSub: 'g2', email: 'b@example.com', name: 'B', createdAt: 0 })
			.returning()
			.get();
		// Both were signed in when they sent Remove, and the first removal took the second's sender.
		removeMember(householdId, userId, other.id);
		expectHttpError(() => removeMember(householdId, other.id, userId), 404);
		expect(listMembers(householdId).map((m) => m.id)).toEqual([userId]);
	});

	it("sorts members by name ignoring case, so Émile sorts with the E's (MEA-88)", () => {
		const { householdId, userId } = makeHousehold();
		db().update(users).set({ name: 'Zoe' }).where(eq(users.id, userId)).run();
		for (const [i, name] of ['Émile', 'dana', 'Pat'].entries()) {
			db()
				.insert(users)
				.values({ householdId, googleSub: `g${i}`, email: `${i}@example.com`, name, createdAt: 0 })
				.run();
		}
		expect(listMembers(householdId).map((m) => m.name)).toEqual(['dana', 'Émile', 'Pat', 'Zoe']);
	});

	it('names members by first name, or whole name while another has it, ignoring case (6.1)', () => {
		const { householdId, userId } = makeHousehold();
		db().update(users).set({ name: 'Alex Smith' }).where(eq(users.id, userId)).run();
		const add = (name: string, i: number) =>
			db()
				.insert(users)
				.values({ householdId, googleSub: `n${i}`, email: `n${i}@example.com`, name, createdAt: 0 })
				.returning()
				.get();
		add('Robin Lee', 1);
		expect(listMembers(householdId).map((m) => m.displayName)).toEqual(['Alex', 'Robin']);
		const jones = add('alex Jones', 2);
		expect(listMembers(householdId)).toEqual([
			{ id: jones.id, name: 'alex Jones', email: 'n2@example.com', displayName: 'alex Jones' },
			expect.objectContaining({ id: userId, name: 'Alex Smith', displayName: 'Alex Smith' }),
			expect.objectContaining({ name: 'Robin Lee', displayName: 'Robin' })
		]);
		removeMember(householdId, userId, jones.id);
		expect(listMembers(householdId).map((m) => m.displayName)).toEqual(['Alex', 'Robin']);
	});

	it("sorts the admin's list of households by name, so Évora sorts with the E's (MEA-88)", () => {
		for (const name of ['Zhou', 'Évora', 'adams', 'Fischer']) {
			updateHousehold(makeHousehold().householdId, { ...settings, name });
		}
		expect(listHouseholds().map((h) => h.name)).toEqual(['adams', 'Évora', 'Fischer', 'Zhou']);
	});

	it("lists each household's members and invites waiting for the admin (MEA-112)", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		const quiet = makeHousehold();
		createInvite(mine.householdId, 'sam@example.com', 0);
		createInvite(mine.householdId, 'pat@example.com', 0);
		createInvite(theirs.householdId, 'sam@example.com', 0);
		createInvite(null, 'new@example.com', 0);
		const listed = (householdId: number) => listHouseholds().find((h) => h.id === householdId);
		expect(listed(mine.householdId)).toMatchObject({
			members: listMembers(mine.householdId)[0]!.email,
			invites: 'pat@example.com, sam@example.com'
		});
		expect(listed(theirs.householdId)?.invites).toBe('sam@example.com');
		expect(listed(quiet.householdId)?.invites).toBeNull();
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
			standardImageCheckedAt: null,
			archivedAt: null,
			createdAt: at
		}));
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
		const householdId = createHousehold(newcomer(), ADMIN, settings, NOW);
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
		const newer = createHousehold(newcomer(), ADMIN, settings, NOW);
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

		expect(() => createHousehold(userId, ADMIN, settings, NOW)).toThrow('Simulated failure');
		expect(db().select().from(households).all()).toEqual([]);
		expect(db().select().from(items).all()).toEqual([]);
		const person = db().select().from(users).where(eq(users.id, userId)).get();
		expect(person?.householdId).toBeNull();

		stopFailing();
		const householdId = createHousehold(userId, ADMIN, settings, LATER);
		expect(allItems(householdId)).toEqual(added(householdId, STANDARD_ITEMS, LATER));
	});
});

// The dishes every household's Recipes starts with (design 6.18).
describe('default dishes', () => {
	// Sat 2026-10-03 12:00 in Chicago, and a day later.
	const NOW = Date.UTC(2026, 9, 3, 17, 0);
	const LATER = NOW + 24 * 60 * 60 * 1000;
	const RELEASED = DEFAULT_DISH_REVISIONS.length;
	const DEFAULT_DISHES = DEFAULT_DISH_REVISIONS.flat();
	// Recipes as it opens.
	const ACTIVE = { search: '', tags: [], archived: false, sort: 'name' as const };

	afterEach(() => {
		// Takes back a revision a test released.
		(DEFAULT_DISH_REVISIONS as string[][]).splice(RELEASED);
	});

	/** Adds a revision of the default dishes, as a later version of the app would. */
	function release(names: string[]): void {
		(DEFAULT_DISH_REVISIONS as string[][]).push(names);
	}

	/** Every dish in the household, archived ones included, in the order they were added. */
	function allDishes(householdId: number) {
		return db()
			.select()
			.from(dishes)
			.where(eq(dishes.householdId, householdId))
			.orderBy(asc(dishes.id))
			.all();
	}

	/** Dishes as the default dishes add them: active, with a name, servings and nothing else. */
	function added(householdId: number, names: readonly string[], servings: number, at: number) {
		return names.map((name) => ({
			id: expect.any(Number),
			householdId,
			name,
			servings,
			prepMinutes: null,
			cookMinutes: null,
			steps: null,
			notes: null,
			source: null,
			photoKey: null,
			calories: null,
			proteinG: null,
			carbsG: null,
			fatG: null,
			tried: false,
			archivedAt: null,
			createdAt: at,
			updatedAt: at
		}));
	}

	it('gives a new household every one, by name only, at its usual servings', () => {
		const servings = { ...settings, defaultServings: 3 };
		const householdId = createHousehold(newcomer(), ADMIN, servings, NOW);
		expect(allDishes(householdId)).toEqual(added(householdId, DEFAULT_DISHES, 3, NOW));
		expect(getHousehold(householdId).defaultDishesRevision).toBe(RELEASED);
		// Recipes lists them all, each labeled "No recipe" (2.1.1).
		const recipes = listDishes(householdId, ACTIVE);
		expect(recipes).toHaveLength(80);
		expect(recipes.filter((dish) => dish.hasRecipe)).toEqual([]);
	});

	it('adds what an existing household lacks when the app starts, keeping what it has', () => {
		const { householdId } = makeHousehold();
		// Hamburgers in other case with a recipe, an archived Pizza, and a dish not among them.
		makeDish(householdId, recipe('hamburgers', { steps: 'Grill them.' }), 1);
		setDishArchived(householdId, makeDish(householdId, recipe('Pizza'), 1), true, 2);
		makeDish(householdId, recipe('Tuna Casserole'), 1);
		const before = allDishes(householdId);

		addDefaultDishesToAllHouseholds(NOW);

		const had = ['Hamburgers', 'Pizza'];
		expect(allDishes(householdId)).toEqual([
			...before,
			...added(householdId, DEFAULT_DISHES.filter((name) => !had.includes(name)), 4, NOW)
		]);
		const archived = listDishes(householdId, { ...ACTIVE, archived: true });
		expect(archived.map((dish) => dish.name)).toEqual(['Pizza']);
		expect(getHousehold(householdId).defaultDishesRevision).toBe(RELEASED);
	});

	it('adds them once, so ones renamed or archived afterward stay that way', () => {
		const { householdId } = makeHousehold();
		addDefaultDishesToAllHouseholds(NOW);
		const id = (name: string) => findDishByName(householdId, name)!.id;
		updateDish(householdId, id('Hot Dogs'), recipe('Corn Dogs'), 'keep', [], LATER);
		setDishArchived(householdId, id('Pizza'), true, LATER);
		const before = allDishes(householdId);

		// The app starting again. Hot Dogs is missing, and stays missing.
		addDefaultDishesToAllHouseholds(LATER);

		expect(allDishes(householdId)).toEqual(before);
	});

	it("adds only a newer revision's dishes to a household that had the earlier ones", () => {
		const { householdId } = makeHousehold();
		addDefaultDishesToAllHouseholds(NOW);
		const hotDogs = findDishByName(householdId, 'Hot Dogs')!.id;
		updateDish(householdId, hotDogs, recipe('Corn Dogs'), 'keep', [], NOW);
		// Meatballs as someone typed it, archived.
		setDishArchived(householdId, makeDish(householdId, recipe('meatballs'), NOW), true, NOW);
		const before = allDishes(householdId);

		release(['Meatballs', "Shepherd's Pie"]);
		addDefaultDishesToAllHouseholds(LATER);

		expect(allDishes(householdId)).toEqual([
			...before,
			...added(householdId, ["Shepherd's Pie"], 4, LATER)
		]);
		expect(getHousehold(householdId).defaultDishesRevision).toBe(RELEASED + 1);
	});

	it('gives each household its own, and leaves alone one that has had them', () => {
		const older = makeHousehold().householdId;
		const other = makeHousehold().householdId;
		// Tacos of the older household's own, archived, which is no other household's.
		setDishArchived(older, makeDish(older, recipe('Tacos'), 0), true, 0);
		const newer = createHousehold(newcomer(), ADMIN, settings, NOW);
		updateDish(newer, findDishByName(newer, 'Pizza')!.id, recipe('Pizza night'), 'keep', [], NOW);
		const olderDishes = allDishes(older);
		const newerDishes = allDishes(newer);

		addDefaultDishesToAllHouseholds(LATER);

		expect(allDishes(older)).toEqual([
			...olderDishes,
			...added(older, DEFAULT_DISHES.filter((name) => name !== 'Tacos'), 4, LATER)
		]);
		expect(allDishes(other)).toEqual(added(other, DEFAULT_DISHES, 4, LATER));
		expect(allDishes(newer)).toEqual(newerDishes);
	});

	it('rolls back a household whose dishes fail to add, and adds them at the next start', () => {
		const first = makeHousehold().householdId;
		const second = makeHousehold().householdId;
		// So only the second adds Waffles, which fails partway through its dishes, as a full disk
		// would.
		makeDish(first, recipe('Waffles'));
		makeDish(second, recipe('Lasagna'));
		db().run(
			sql.raw(
				`create trigger fail_to_add before insert on dishes when new.name = 'Waffles'
				begin select raise(abort, 'Simulated failure'); end`
			)
		);

		expect(() => addDefaultDishesToAllHouseholds(NOW)).toThrow('Simulated failure');
		// The first finished before the second started.
		expect(allDishes(first)).toHaveLength(80);
		expect(getHousehold(first).defaultDishesRevision).toBe(RELEASED);
		expect(allDishes(second).map((dish) => dish.name)).toEqual(['Lasagna']);
		expect(getHousehold(second).defaultDishesRevision).toBe(0);

		db().run(sql.raw('drop trigger fail_to_add'));
		addDefaultDishesToAllHouseholds(LATER);
		expect(allDishes(second)).toHaveLength(80);
		expect(getHousehold(second).defaultDishesRevision).toBe(RELEASED);
	});

	it('makes ordinary dishes, planned, given a recipe and archived like any other', () => {
		const householdId = createHousehold(newcomer(), ADMIN, settings, NOW);
		const id = (name: string) => findDishByName(householdId, name)!.id;
		// The Menu's dish field suggests them, and picks one by name, ignoring case (6.9).
		expect(dishSuggestions(householdId)).toHaveLength(80);
		const result = addDinnerDish(householdId, '2026-10-05', null, { name: 'tacos' }, 'main', LATER);
		expect(result).toEqual({ kind: 'added' });
		expect(getDay(householdId, '2026-10-05')[0]?.dishes).toEqual([
			{ dishId: id('Tacos'), name: 'Tacos', role: 'main', archived: false }
		]);
		// A recipe written for one, and another archived (6.10).
		updateDish(householdId, id('Chili'), recipe('Chili', { steps: 'Simmer.' }), 'keep', [], LATER);
		setDishArchived(householdId, id('Pizza'), true, LATER);
		const recipes = listDishes(householdId, ACTIVE);
		expect(recipes).toHaveLength(79);
		expect(recipes.filter((dish) => dish.hasRecipe).map((dish) => dish.name)).toEqual(['Chili']);
		const archived = listDishes(householdId, { ...ACTIVE, archived: true });
		expect(archived.map((dish) => dish.name)).toEqual(['Pizza']);
	});
});

describe('default dish photos', () => {
	const NOW = Date.UTC(2026, 10, 16, 17, 0);
	const LATER = NOW + 24 * 60 * 60 * 1000;
	const A = 'a'.repeat(32);
	const B = 'b'.repeat(32);
	const C = 'c'.repeat(32);
	const D = 'd'.repeat(32);

	it('gives each dish its photo if it still has none, once, and returns the keys left over', () => {
		const { householdId } = makeHousehold();
		const pizza = makeDish(householdId, recipe('Pizza'));
		const tacos = makeDish(householdId, recipe('Tacos'), 0, A);
		const photo = (dishId: number) => getDish(householdId, dishId).photoKey;

		const photos = new Map([
			[pizza, B],
			[tacos, C]
		]);
		expect(addDefaultDishPhotos(householdId, photos, NOW)).toEqual([C]);
		expect([photo(pizza), photo(tacos)]).toEqual([B, A]);
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);

		// Pizza's photo removed in the recipe editor stays removed (6.19).
		updateDish(householdId, pizza, recipe('Pizza'), { photoKey: null }, [], NOW);
		expect(addDefaultDishPhotos(householdId, new Map([[pizza, D]]), LATER)).toEqual([D]);
		expect(photo(pizza)).toBeNull();
		expect(getHousehold(householdId).defaultDishPhotosAddedAt).toBe(NOW);
	});

	it("is not found for another household's dish, and changes nothing", () => {
		const mine = makeHousehold().householdId;
		const theirs = makeHousehold().householdId;
		const ours = makeDish(mine, recipe('Pizza'));
		const pizza = makeDish(theirs, recipe('Pizza'));
		const photos = new Map([
			[ours, A],
			[pizza, B]
		]);

		expectHttpError(() => addDefaultDishPhotos(mine, photos, NOW), 404);
		expect(getDish(mine, ours).photoKey).toBeNull();
		expect(getDish(theirs, pizza).photoKey).toBeNull();
		expect(getHousehold(mine).defaultDishPhotosAddedAt).toBeNull();
	});

	it("lists the households that haven't had them, oldest first", () => {
		const first = makeHousehold().householdId;
		const second = makeHousehold().householdId;
		const third = makeHousehold().householdId;
		addDefaultDishPhotos(second, new Map(), NOW);

		expect(listHouseholdsWithoutDefaultDishPhotos()).toEqual([first, third]);
	});
});

describe('invites', () => {
	it("refuses members and people the household already invited, but not another's (MEA-112)", () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		const member = listMembers(mine.householdId)[0]!;
		expect(createInvite(mine.householdId, member.email.toUpperCase(), 0)).toEqual({
			kind: 'member'
		});
		expect(createInvite(theirs.householdId, member.email, 0)).toEqual({ kind: 'member' });
		expect(createInvite(null, member.email, 0)).toEqual({ kind: 'member' });

		expect(createInvite(mine.householdId, 'new@example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(mine.householdId, 'NEW@example.com', 0)).toEqual({
			kind: 'invited-already'
		});
		// Each household's invite stands on its own, and so does the admin's to start one.
		expect(createInvite(theirs.householdId, 'new@example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(null, 'new@example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(null, 'New@example.com', 0)).toEqual({ kind: 'invited-already' });
		for (const owner of [mine.householdId, theirs.householdId, null]) {
			expect(listInvites(owner).map((invite) => invite.email)).toEqual(['new@example.com']);
		}
	});

	it('leaves someone signed in without a household to choose on the setup page (MEA-112)', () => {
		const { householdId } = makeHousehold();
		const dana = signedInWithout('dana@example.com');
		expect(createInvite(householdId, 'Dana@Example.com', 0)).toEqual({ kind: 'invited' });
		expect(createInvite(null, 'dana@example.com', 0)).toEqual({ kind: 'invited' });
		expect(listMembers(householdId).map((m) => m.id)).not.toContain(dana);
		const [invite] = listInvites(householdId);
		expect(setupChoices(dana, ADMIN)).toEqual({
			invites: [{ id: invite!.id, householdName: getHousehold(householdId).name }],
			mayStart: true
		});
	});

	it('keeps at most 20 invites waiting for a household, and for the admin (MEA-112)', () => {
		expect(INVITE_LIMIT).toBe(20);
		const mine = makeHousehold();
		const theirs = makeHousehold();
		for (let i = 0; i < INVITE_LIMIT; i += 1) {
			expect(createInvite(mine.householdId, `p${i}@example.com`, 0)).toEqual({ kind: 'invited' });
			expect(createInvite(null, `p${i}@example.com`, 0)).toEqual({ kind: 'invited' });
		}
		expect(createInvite(mine.householdId, 'more@example.com', 0)).toEqual({ kind: 'full' });
		expect(createInvite(null, 'more@example.com', 0)).toEqual({ kind: 'full' });
		// Another household's invites don't count against it.
		expect(createInvite(theirs.householdId, 'more@example.com', 0)).toEqual({ kind: 'invited' });
		// Cancelling one makes room.
		cancelInvite(mine.householdId, listInvites(mine.householdId)[0]!.id);
		expect(createInvite(mine.householdId, 'more@example.com', 0)).toEqual({ kind: 'invited' });
		expect(listInvites(mine.householdId)).toHaveLength(INVITE_LIMIT);
	});

	it('joins a household that invited them, which uses up all their invites (MEA-112)', () => {
		const mine = makeHousehold();
		const theirs = makeHousehold();
		updateHousehold(mine.householdId, { ...settings, name: 'Zhou' });
		updateHousehold(theirs.householdId, { ...settings, name: 'Évora' });
		createInvite(mine.householdId, 'sam@example.com', 0);
		createInvite(theirs.householdId, 'sam@example.com', 0);
		createInvite(null, 'sam@example.com', 0);
		createInvite(mine.householdId, 'pat@example.com', 0);
		const sam = signedInWithout('sam@example.com');

		const { invites: choices, mayStart } = setupChoices(sam, ADMIN);
		expect(choices.map((choice) => choice.householdName)).toEqual(['Évora', 'Zhou']);
		expect(mayStart).toBe(true);
		expect(joinHousehold(sam, choices[0]!.id)).toBe(theirs.householdId);
		expect(listMembers(theirs.householdId).map((m) => m.id)).toContain(sam);
		// Every invite for Sam is used up, whichever household it's from, and Pat's stays.
		expect(listInvites(mine.householdId).map((invite) => invite.email)).toEqual([
			'pat@example.com'
		]);
		expect(listInvites(theirs.householdId)).toEqual([]);
		expect(listInvites(null)).toEqual([]);
		expectHttpError(() => joinHousehold(sam, choices[1]!.id), 400);
		expectHttpError(() => setupChoices(sam, ADMIN), 400);
	});

	it("can't join with an invite that was cancelled, someone else's or one to start a household", () => {
		const { householdId } = makeHousehold();
		createInvite(householdId, 'sam@example.com', 0);
		createInvite(householdId, 'pat@example.com', 0);
		createInvite(null, 'sam@example.com', 0);
		const sam = signedInWithout('sam@example.com');
		const [pats, sams] = listInvites(householdId);
		const start = listInvites(null)[0]!;

		expectHttpError(() => joinHousehold(sam, pats!.id), 400);
		expectHttpError(() => joinHousehold(sam, start.id), 400);
		cancelInvite(householdId, sams!.id);
		expectHttpError(() => joinHousehold(sam, sams!.id), 400);
		expect(setupChoices(sam, ADMIN)).toEqual({ invites: [], mayStart: true });
		expect(listMembers(householdId)).toHaveLength(1);
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
