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
import { DINNER_TYPES, DISH_ROLES } from '../../menu.ts';

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
		// Left off pantry checklists, like water or salt (addition 2.2.1).
		alwaysHave: integer('always_have', { mode: 'boolean' }).notNull().default(false),
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

// Dishes and recipes are one record; the recipe details are optional (Q2).
export const dishes = sqliteTable(
	'dishes',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		name: text('name').notNull(),
		servings: integer('servings').notNull(),
		prepMinutes: integer('prep_minutes'),
		cookMinutes: integer('cook_minutes'),
		// One step per line.
		steps: text('steps'),
		notes: text('notes'),
		// A URL or a book.
		source: text('source'),
		// Random; the photo files are named after it (photos.ts).
		photoKey: text('photo_key'),
		// Per serving, entered by hand (Q31b).
		calories: real('calories'),
		proteinG: real('protein_g'),
		carbsG: real('carbs_g'),
		fatG: real('fat_g'),
		archivedAt: integer('archived_at'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [
		unique('dishes_household_id').on(t.householdId, t.id),
		uniqueIndex('dishes_household_name').on(t.householdId, sql`lower(${t.name})`),
		uniqueIndex('dishes_photo_key').on(t.photoKey),
		check('dishes_servings', sql`${t.servings} >= 1`),
		check('dishes_prep_minutes', sql`${t.prepMinutes} >= 0`),
		check('dishes_cook_minutes', sql`${t.cookMinutes} >= 0`),
		check(
			'dishes_nutrition',
			sql`${t.calories} >= 0 and ${t.proteinG} >= 0 and ${t.carbsG} >= 0 and ${t.fatG} >= 0`
		)
	]
);

export const dishTags = sqliteTable(
	'dish_tags',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		dishId: integer('dish_id').notNull(),
		tag: text('tag').notNull()
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		uniqueIndex('dish_tags_dish_tag').on(t.dishId, sql`lower(${t.tag})`),
		index('dish_tags_household').on(t.householdId)
	]
);

export const dishIngredients = sqliteTable(
	'dish_ingredients',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		dishId: integer('dish_id').notNull(),
		position: integer('position').notNull(),
		// An optional heading such as "For the sauce" (Q31).
		section: text('section'),
		// Empty means no amount, which is never scaled (Q33).
		amount: real('amount'),
		// A known unit code from units.ts or custom text, and only with an amount (Q32b).
		unit: text('unit'),
		itemId: integer('item_id').notNull(),
		// Such as "diced".
		prepNote: text('prep_note')
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		foreignKey({
			columns: [t.householdId, t.itemId],
			foreignColumns: [items.householdId, items.id]
		}),
		uniqueIndex('dish_ingredients_dish_position').on(t.dishId, t.position),
		index('dish_ingredients_item').on(t.itemId),
		check('dish_ingredients_amount', sql`${t.amount} > 0`),
		check('dish_ingredients_unit', sql`${t.unit} is null or ${t.amount} is not null`)
	]
);

// One dinner per date (Q26). A date with no row isn't planned.
export const dinners = sqliteTable(
	'dinners',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		// YYYY-MM-DD in the household's time zone.
		date: text('date').notNull(),
		type: text('type', { enum: DINNER_TYPES }).notNull(),
		note: text('note'),
		// Starts at the household's usual servings (Q28).
		servings: integer('servings').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [
		unique('dinners_household_id').on(t.householdId, t.id),
		uniqueIndex('dinners_household_date').on(t.householdId, t.date),
		check('dinners_type', sql`${t.type} in ('cook', 'eat_out', 'going', 'leftovers')`),
		check('dinners_servings', sql`${t.servings} >= 1`)
	]
);

// Only Cooking at home and Going somewhere dinners have dishes (Q26); the data layer keeps it so.
export const dinnerDishes = sqliteTable(
	'dinner_dishes',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		dinnerId: integer('dinner_id').notNull(),
		dishId: integer('dish_id').notNull(),
		role: text('role', { enum: DISH_ROLES }).notNull()
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.dinnerId],
			foreignColumns: [dinners.householdId, dinners.id]
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		uniqueIndex('dinner_dishes_dinner_dish').on(t.dinnerId, t.dishId),
		index('dinner_dishes_dish').on(t.dishId),
		check('dinner_dishes_role', sql`${t.role} in ('main', 'side', 'dessert', 'other')`)
	]
);

// At most one per household, shared by its members (Q35). It comes from one recipe at some
// servings, or from a range of menu dates.
export const pantryChecklists = sqliteTable(
	'pantry_checklists',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.unique()
			.references(() => households.id),
		dishId: integer('dish_id'),
		servings: integer('servings'),
		startDate: text('start_date'),
		endDate: text('end_date'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('pantry_checklists_household_id').on(t.householdId, t.id),
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		check(
			'pantry_checklists_source',
			sql`(${t.dishId} is not null and ${t.servings} is not null and ${t.startDate} is null and ${t.endDate} is null)
				or (${t.dishId} is null and ${t.servings} is null and ${t.startDate} is not null and ${t.endDate} is not null)`
		),
		check('pantry_checklists_servings', sql`${t.servings} >= 1`),
		check('pantry_checklists_dates', sql`${t.startDate} <= ${t.endDate}`)
	]
);

export const PANTRY_MARK_STATES = ['have', 'need'] as const;
export type PantryMarkState = (typeof PANTRY_MARK_STATES)[number];

export const pantryMarks = sqliteTable(
	'pantry_marks',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		checklistId: integer('checklist_id').notNull(),
		itemId: integer('item_id').notNull(),
		state: text('state', { enum: PANTRY_MARK_STATES }).notNull(),
		// The grocery line that Need created. Deleting that line deletes the mark.
		needId: integer('need_id')
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.checklistId],
			foreignColumns: [pantryChecklists.householdId, pantryChecklists.id]
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.householdId, t.itemId],
			foreignColumns: [items.householdId, items.id]
		}),
		foreignKey({
			columns: [t.householdId, t.needId],
			foreignColumns: [groceryNeeds.householdId, groceryNeeds.id]
		}).onDelete('cascade'),
		uniqueIndex('pantry_marks_checklist_item').on(t.checklistId, t.itemId),
		index('pantry_marks_need').on(t.needId),
		check('pantry_marks_state', sql`${t.state} in ('have', 'need')`),
		check('pantry_marks_need_line', sql`(${t.state} = 'need') = (${t.needId} is not null)`)
	]
);
