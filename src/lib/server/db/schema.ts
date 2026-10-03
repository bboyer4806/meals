import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	real,
	sqliteTable,
	text,
	unique,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

// Timestamps are milliseconds since 1970 (UTC). Household-owned tables that other tables point
// at have a unique key on (household_id, id), and references to them are composite foreign keys,
// so the database rejects a row in one household that points at another household's row.

export const households = sqliteTable(
	'households',
	{
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
		defaultServings: integer('default_servings').notNull(),
		timeZone: text('time_zone').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [check('households_default_servings', sql`${t.defaultServings} >= 1`)]
);

export const users = sqliteTable(
	'users',
	{
		id: integer('id').primaryKey(),
		// Empty only until the household setup page is done.
		householdId: integer('household_id').references(() => households.id),
		googleSub: text('google_sub').notNull().unique(),
		email: text('email').notNull().unique(),
		name: text('name').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('users_household').on(t.householdId)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		// SHA-256 of the token in the cookie.
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at').notNull()
	},
	(t) => [index('sessions_user').on(t.userId)]
);

export const invites = sqliteTable('invites', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	// Empty means the person creates a new household.
	householdId: integer('household_id').references(() => households.id),
	createdAt: integer('created_at').notNull()
});

export const stores = sqliteTable(
	'stores',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		name: text('name').notNull(),
		archivedAt: integer('archived_at')
	},
	(t) => [
		unique('stores_household_id').on(t.householdId, t.id),
		uniqueIndex('stores_household_name').on(t.householdId, sql`lower(${t.name})`)
	]
);

export const items = sqliteTable(
	'items',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		name: text('name').notNull(),
		notes: text('notes'),
		// The store the item was last ordered or bought from.
		defaultStoreId: integer('default_store_id'),
		archivedAt: integer('archived_at'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('items_household_id').on(t.householdId, t.id),
		uniqueIndex('items_household_name').on(t.householdId, sql`lower(${t.name})`),
		foreignKey({
			columns: [t.householdId, t.defaultStoreId],
			foreignColumns: [stores.householdId, stores.id]
		})
	]
);

export const NEED_STATUSES = ['to_order', 'ordered', 'received'] as const;
export type NeedStatus = (typeof NEED_STATUSES)[number];

export const groceryNeeds = sqliteTable(
	'grocery_needs',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		itemId: integer('item_id').notNull(),
		quantity: real('quantity').notNull(),
		unit: text('unit'),
		storeId: integer('store_id'),
		status: text('status', { enum: NEED_STATUSES }).notNull(),
		note: text('note'),
		createdAt: integer('created_at').notNull(),
		orderedAt: integer('ordered_at'),
		receivedAt: integer('received_at')
	},
	(t) => [
		unique('grocery_needs_household_id').on(t.householdId, t.id),
		foreignKey({
			columns: [t.householdId, t.itemId],
			foreignColumns: [items.householdId, items.id]
		}),
		foreignKey({
			columns: [t.householdId, t.storeId],
			foreignColumns: [stores.householdId, stores.id]
		}),
		index('grocery_needs_household_status').on(t.householdId, t.status),
		index('grocery_needs_item').on(t.itemId),
		check('grocery_needs_quantity', sql`${t.quantity} > 0`),
		check('grocery_needs_status', sql`${t.status} in ('to_order', 'ordered', 'received')`),
		check('grocery_needs_store', sql`${t.status} = 'to_order' or ${t.storeId} is not null`),
		check('grocery_needs_ordered', sql`${t.status} != 'ordered' or ${t.orderedAt} is not null`),
		check('grocery_needs_to_order', sql`${t.status} != 'to_order' or ${t.orderedAt} is null`),
		check(
			'grocery_needs_received',
			sql`(${t.status} = 'received') = (${t.receivedAt} is not null)`
		)
	]
);
