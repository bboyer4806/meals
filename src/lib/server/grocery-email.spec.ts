import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createItem, findItemByName } from './data/items.ts';
import { db } from './db/index.ts';
import { groceryNeeds, households } from './db/schema.ts';
import { groceryListEmail } from './grocery-email.ts';
import { freshDb, makeHousehold, makeStore } from './testing.ts';

const NOW = Date.UTC(2026, 10, 11, 17, 0);

/**
 * A grocery line written straight to the database: 1 of the item, To Order, with no unit, store
 * or note unless `fields` sets them.
 */
function makeLine(
	householdId: number,
	itemName: string,
	fields: Partial<typeof groceryNeeds.$inferInsert> = {}
): void {
	const item = findItemByName(householdId, itemName) ?? createItem(householdId, itemName, NOW);
	db()
		.insert(groceryNeeds)
		.values({
			householdId,
			itemId: item.id,
			quantity: 1,
			status: 'to_order',
			createdAt: NOW,
			...fields
		})
		.run();
}

let householdId: number;
let walmart: number;
let aldi: number;

beforeEach(() => {
	freshDb();
	({ householdId } = makeHousehold());
	db().update(households).set({ name: 'The Smiths' }).where(eq(households.id, householdId)).run();
	walmart = makeStore(householdId, 'Walmart');
	aldi = makeStore(householdId, 'Aldi');
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('groceryListEmail', () => {
	it('names the household in the subject (design 6.16)', () => {
		expect(groceryListEmail(householdId).subject).toBe('Meals Grocery List: The Smiths');
	});

	it('lists what is To Order by store, No store first, with the same text in HTML', () => {
		makeLine(householdId, 'Milk', {
			quantity: 2,
			unit: 'gal',
			storeId: walmart,
			note: 'Get the big one'
		});
		makeLine(householdId, 'Eggs', { quantity: 12, storeId: walmart });
		makeLine(householdId, 'Coffee', { unit: 'bag', storeId: aldi });
		makeLine(householdId, 'Tea', { quantity: 1 / 3, unit: 'lb' });
		makeLine(householdId, 'Bananas', { quantity: 6 });
		const email = groceryListEmail(householdId);
		expect(email.text).toBe(
			[
				'No store',
				'- Bananas: 6',
				'- Tea: 0.33 lb',
				'',
				'Aldi',
				'- Coffee: 1 bag',
				'',
				'Walmart',
				'- Eggs: 12',
				'- Milk: 2 gal',
				'  Note: Get the big one'
			].join('\n')
		);
		expect(email.html).toBe(
			[
				'<h2>No store</h2>',
				'<ul>',
				'<li>Bananas: 6</li>',
				'<li>Tea: 0.33 lb</li>',
				'</ul>',
				'<h2>Aldi</h2>',
				'<ul>',
				'<li>Coffee: 1 bag</li>',
				'</ul>',
				'<h2>Walmart</h2>',
				'<ul>',
				'<li>Eggs: 12</li>',
				'<li>Milk: 2 gal<br>Note: Get the big one</li>',
				'</ul>'
			].join('\n')
		);
	});

	it('leaves out Ordered and Received lines', () => {
		makeLine(householdId, 'Milk', { storeId: walmart });
		makeLine(householdId, 'Butter', { storeId: walmart, status: 'ordered', orderedAt: NOW });
		makeLine(householdId, 'Bread', { storeId: aldi, status: 'received', receivedAt: NOW });
		const email = groceryListEmail(householdId);
		expect(email.text).toBe('Walmart\n- Milk: 1');
		expect(email.html).toBe('<h2>Walmart</h2>\n<ul>\n<li>Milk: 1</li>\n</ul>');
	});

	it("never lists another household's lines", () => {
		const other = makeHousehold();
		makeLine(other.householdId, 'Milk', { storeId: makeStore(other.householdId, 'Costco') });
		makeLine(householdId, 'Eggs');
		expect(groceryListEmail(householdId).text).toBe('No store\n- Eggs: 1');
		expect(groceryListEmail(other.householdId).text).toBe('Costco\n- Milk: 1');
	});

	it('says there are no items to order when nothing is To Order', () => {
		makeLine(householdId, 'Butter', { storeId: walmart, status: 'ordered', orderedAt: NOW });
		expect(groceryListEmail(householdId)).toEqual({
			subject: 'Meals Grocery List: The Smiths',
			html: '<p>There are no items to order.</p>',
			text: 'There are no items to order.'
		});
	});

	it('escapes names, units and notes in the HTML, and shows them as typed in the text', () => {
		const store = makeStore(householdId, 'Bob & Sons <Market>');
		makeLine(householdId, '<b>Tea</b>', {
			unit: '"big" box',
			storeId: store,
			note: "<script>alert('hi')</script>"
		});
		const email = groceryListEmail(householdId);
		expect(email.html).toBe(
			[
				'<h2>Bob &amp; Sons &lt;Market&gt;</h2>',
				'<ul>',
				'<li>&lt;b&gt;Tea&lt;/b&gt;: 1 &quot;big&quot; box<br>Note: &lt;script&gt;alert(&#39;hi&#39;)&lt;/script&gt;</li>',
				'</ul>'
			].join('\n')
		);
		expect(email.text).toBe(
			[
				'Bob & Sons <Market>',
				'- <b>Tea</b>: 1 "big" box',
				"  Note: <script>alert('hi')</script>"
			].join('\n')
		);
	});

	it('sends nothing and leaves the list as it was', () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		makeLine(householdId, 'Milk', { storeId: walmart, note: 'Get the big one' });
		makeLine(householdId, 'Butter', { storeId: walmart, status: 'ordered', orderedAt: NOW });
		const before = db().select().from(groceryNeeds).all();
		groceryListEmail(householdId);
		expect(db().select().from(groceryNeeds).all()).toEqual(before);
		expect(fetch).not.toHaveBeenCalled();
	});
});
