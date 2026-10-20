import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/index.ts';
import { dishRequests, dishes, users } from '../db/schema.ts';
import { expectHttpError, freshDb, makeDish, makeHousehold, recipe } from '../testing.ts';
import { setDishArchived, updateDish } from './dishes.ts';
import { removeMember } from './households.ts';
import { addRequest, listRequests, removeRequest } from './requests.ts';

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
	addRequest(householdId, user, { name, note }, now);
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

describe('addRequest', () => {
	it('stores the asker, name and note, and creates no dish', () => {
		ask('  Chicken   pot pie ', 'With the flaky crust');
		expect(listRequests(householdId)).toEqual([
			{
				id: expect.any(Number),
				name: 'Chicken pot pie',
				note: 'With the flaky crust',
				dishId: null,
				askedBy: 'Person 1'
			}
		]);
		expect(dishCount()).toBe(1);
	});

	it('links to an active dish with the same name, ignoring case', () => {
		ask('LASAGNA');
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'LASAGNA',
			dishId: lasagna
		});
	});

	it("doesn't link to an archived dish or another household's", () => {
		setDishArchived(householdId, lasagna, true, NOW);
		makeDish(otherId, recipe('Curry'));
		ask('Lasagna');
		ask('Curry');
		expect(listRequests(householdId).map((request) => request.dishId)).toEqual([null, null]);
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

	it('stays plain text after a dish with its name is added', () => {
		ask('Tacos');
		makeDish(householdId, recipe('Tacos'));
		expect(listRequests(householdId)[0]).toMatchObject({
			name: 'Tacos',
			dishId: null
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
	it('removes the request', () => {
		ask('Soup');
		const [request] = listRequests(householdId);
		removeRequest(householdId, request!.id);
		expect(listRequests(householdId)).toEqual([]);
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
