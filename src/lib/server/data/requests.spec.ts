import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';
import { expectHttpError, freshDb, makeDish, makeHousehold, recipe } from '../testing.ts';
import { setDishArchived, updateDish } from './dishes.ts';
import { removeMember } from './households.ts';
import { addRequest, listRequests, removeRequest, restoreAndAddRequest } from './requests.ts';

const NOW = Date.UTC(2026, 9, 7, 17, 0);

let householdId: number;
let userId: number;
let otherId: number;
let otherUserId: number;
let lasagna: number;

beforeEach(() => {
	freshDb();
	({ householdId, userId } = makeHousehold());
	({ householdId: otherId, userId: otherUserId } = makeHousehold());
	lasagna = makeDish(householdId, recipe('Lasagna'));
});

function ask(name: string, note: string | null = null, now = NOW, user = userId) {
	return addRequest(householdId, user, { name, note }, now);
}

function dishCount(): number {
	return db().select().from(dishes).all().length;
}

/** The message a refusal shows the person. */
function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		if (isHttpError(e, 400)) return e.body.message;
		throw e;
	}
	return expect.fail('expected a refusal, but nothing was thrown');
}

function dishNamed(name: string) {
	return db().select().from(dishes).where(eq(dishes.name, name)).get();
}

describe('addRequest', () => {
	it('adds a new name to Recipes at the usual servings, and links to it', () => {
		expect(ask('  Shrimp   boil ', 'With corn')).toEqual({ kind: 'added' });
		const dish = dishNamed('Shrimp boil');
		expect(dish).toMatchObject({ householdId, servings: 4, archivedAt: null, createdAt: NOW });
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				name: 'Shrimp boil',
				note: 'With corn',
				dishId: dish!.id,
				askedBy: 'Person 1'
			}
		]);
		expect(dishCount()).toBe(2);
	});

	it('links to an active dish with the same name, ignoring case, and adds nothing', () => {
		ask('LASAGNA');
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'LASAGNA',
			dishId: lasagna
		});
		expect(dishCount()).toBe(1);
	});

	it("makes its own dish for a name only another household's dish has", () => {
		const curry = makeDish(otherId, recipe('Curry'));
		ask('Curry');
		const [request] = listRequests(householdId);
		expect(request!.dishId).not.toBe(curry);
		expect(dishCount()).toBe(3);
	});

	it("offers to restore an archived dish's name and changes nothing", () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(ask('lasagna')).toEqual({ kind: 'archived', dishId: lasagna, name: 'Lasagna' });
		expect(listRequests(householdId)).toEqual([]);
		expect(dishCount()).toBe(1);
	});

	it('keeps the link and the name as typed after the dish is renamed or archived', () => {
		ask('lasagna');
		updateDish(householdId, lasagna, recipe('Veggie lasagna'), [], NOW);
		setDishArchived(householdId, lasagna, true, NOW);
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'lasagna',
			dishId: lasagna
		});
	});

	it('refuses a blank name and anything too long', () => {
		expect(refusal(() => ask('   '))).toBe('Enter a dish name');
		expect(refusal(() => ask('a'.repeat(81)))).toBe('Keep a dish name under 80 characters');
		expect(refusal(() => ask('Pie', 'a'.repeat(201)))).toBe('Keep the note under 200 characters');
		ask('a'.repeat(80), 'a'.repeat(200));
		expect(listRequests(householdId)).toHaveLength(1);
	});
});

describe('restoreAndAddRequest', () => {
	it('restores the dish and adds the request linked to it, with the name as typed', () => {
		setDishArchived(householdId, lasagna, true, NOW);
		restoreAndAddRequest(householdId, userId, lasagna, { name: ' LASAGNA ', note: 'Extra' }, NOW);
		expect(dishNamed('Lasagna')!.archivedAt).toBeNull();
		expect(listRequests(householdId)).toEqual([
			expect.objectContaining({ name: 'LASAGNA', note: 'Extra', dishId: lasagna })
		]);
	});

	it("refuses another household's dish with a 404 and adds nothing", () => {
		const curry = makeDish(otherId, recipe('Curry'));
		setDishArchived(otherId, curry, true, NOW);
		expectHttpError(
			() => restoreAndAddRequest(householdId, userId, curry, { name: 'Curry', note: null }, NOW),
			404
		);
		expect(dishNamed('Curry')!.archivedAt).toBe(NOW);
		expect(listRequests(householdId)).toEqual([]);
	});

	it('refuses a blank name and restores nothing', () => {
		setDishArchived(householdId, lasagna, true, NOW);
		expect(
			refusal(() =>
				restoreAndAddRequest(householdId, userId, lasagna, { name: ' ', note: null }, NOW)
			)
		).toBe('Enter a dish name');
		expect(dishNamed('Lasagna')!.archivedAt).toBe(NOW);
	});
});

describe('listRequests', () => {
	it("lists the household's own requests, oldest first", () => {
		ask('Soup', null, NOW + 2);
		ask('Pie', null, NOW);
		ask('Stew', null, NOW + 1);
		addRequest(otherId, otherUserId, { name: 'Curry', note: null }, NOW);
		expect(listRequests(householdId).map((request) => request.name)).toEqual([
			'Pie',
			'Stew',
			'Soup'
		]);
		expect(listRequests(otherId).map((request) => request.name)).toEqual(['Curry']);
	});
});

describe('removeRequest', () => {
	it('removes the request and keeps its recipe', () => {
		ask('Soup');
		const [request] = listRequests(householdId);
		removeRequest(householdId, request!.id);
		expect(listRequests(householdId)).toEqual([]);
		expect(dishNamed('Soup')).toBeDefined();
	});

	it("refuses another household's request with a 404", () => {
		addRequest(otherId, otherUserId, { name: 'Curry', note: null }, NOW);
		const [request] = listRequests(otherId);
		expectHttpError(() => removeRequest(householdId, request!.id), 404);
		expect(listRequests(otherId)).toHaveLength(1);
	});
});

it("removing a member removes their requests and keeps everyone else's", () => {
	const memberId = db()
		.insert(users)
		.values({
			householdId,
			googleSub: 'sub-member',
			email: 'm@example.com',
			name: 'Sam',
			createdAt: 0
		})
		.returning({ id: users.id })
		.get().id;
	ask('Soup', null, NOW, memberId);
	ask('Pie');
	removeMember(householdId, userId, memberId);
	expect(listRequests(householdId).map((request) => request.name)).toEqual(['Pie']);
});

it('the database rejects a dish from another household', () => {
	const curry = makeDish(otherId, recipe('Curry'));
	expect(() =>
		db()
			.insert(dishRequests)
			.values({
				householdId,
				userId,
				name: 'Curry',
				note: null,
				dishId: curry,
				createdAt: NOW
			})
			.run()
	).toThrow(/FOREIGN KEY/);
});
