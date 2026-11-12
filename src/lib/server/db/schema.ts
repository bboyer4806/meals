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
		createdAt: integer('created_at').notNull(),
		// When its catalog got the standard items, which happens once; empty until then
		// (design 6.13).
		standardItemsAddedAt: integer('standard_items_added_at')
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
		createdAt: integer('created_at').notNull(),
		// The version, such as "1.5", of the newest release they've seen on What's new (design 7).
		whatsNewSeen: text('whats_new_seen'),
		// When they finished or skipped the first-time tour; empty until then (design 7, "Tour").
		tourSeen: integer('tour_seen')
	},
	// Requests and ratings point at their member through this key (design 4.5, MEA-70).
	(t) => [unique('users_household_id').on(t.householdId, t.id)]
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
	// Never reused after an invite is cancelled or used, so a page that still shows it can't
	// cancel a newer invite (6.1).
	id: integer('id').primaryKey({ autoIncrement: true }),
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
		// Random; the image files are named after it, as a recipe's photo is (photos.ts, MEA-50).
		photoKey: text('photo_key'),
		// When it was checked for a standard image, which happens once; empty until then
		// (design 6.14).
		standardImageCheckedAt: integer('standard_image_checked_at'),
		archivedAt: integer('archived_at'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('items_household_id').on(t.householdId, t.id),
		uniqueIndex('items_household_name').on(t.householdId, sql`lower(${t.name})`),
		uniqueIndex('items_photo_key').on(t.photoKey),
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
		// Never reused after a line is deleted, so a page that still shows a deleted line can't
		// change a newer one (6.11).
		id: integer('id').primaryKey({ autoIncrement: true }),
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

// A named shopping list for a party, kept apart from the grocery list (design 6.15).
export const partyLists = sqliteTable(
	'party_lists',
	{
		// Never reused after a list is deleted, so a page that still shows it can't reach a newer one
		// (6.11).
		id: integer('id').primaryKey({ autoIncrement: true }),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		name: text('name').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('party_lists_household_id').on(t.householdId, t.id),
		uniqueIndex('party_lists_household_name').on(t.householdId, sql`lower(${t.name})`)
	]
);

// Something a party needs, from the household's items, with the quantity it needs in its own unit
// (6.15). Deleting its list deletes it.
export const partyItems = sqliteTable(
	'party_items',
	{
		// Never reused after it's removed, so a page that still shows it can't change a newer one.
		id: integer('id').primaryKey({ autoIncrement: true }),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		partyListId: integer('party_list_id').notNull(),
		itemId: integer('item_id').notNull(),
		quantity: real('quantity').notNull(),
		unit: text('unit'),
		// How much was checked off on the party list itself rather than received on Groceries, in its
		// unit. What Groceries received is in party_allocations.
		boughtQuantity: real('bought_quantity').notNull().default(0),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique('party_items_household_id').on(t.householdId, t.id),
		foreignKey({
			columns: [t.householdId, t.partyListId],
			foreignColumns: [partyLists.householdId, partyLists.id]
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.householdId, t.itemId],
			foreignColumns: [items.householdId, items.id]
		}),
		uniqueIndex('party_items_list_item').on(t.partyListId, t.itemId),
		index('party_items_item').on(t.itemId),
		check('party_items_quantity', sql`${t.quantity} > 0`),
		check('party_items_bought', sql`${t.boughtQuantity} >= 0`)
	]
);

// The part of a grocery line that's for a party item, in the party item's unit, which converts to
// the line's (6.15). It's received when its line is. Lines add allocations in the order the
// quantities were added to Groceries, which is the order of their ids. Removing the party item or
// deleting the line deletes it.
export const partyAllocations = sqliteTable(
	'party_allocations',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		partyItemId: integer('party_item_id').notNull(),
		needId: integer('need_id').notNull(),
		quantity: real('quantity').notNull()
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.partyItemId],
			foreignColumns: [partyItems.householdId, partyItems.id]
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.householdId, t.needId],
			foreignColumns: [groceryNeeds.householdId, groceryNeeds.id]
		}).onDelete('cascade'),
		index('party_allocations_party_item').on(t.partyItemId),
		index('party_allocations_need').on(t.needId),
		check('party_allocations_quantity', sql`${t.quantity} > 0`)
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
		// Whether the household has made it yet, set on the recipe page (section 7, "Recipe").
		tried: integer('tried', { mode: 'boolean' }).notNull().default(false),
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

// One person's 1 to 5 stars for a dish, set on the recipe page (section 7, "Recipe").
export const dishRatings = sqliteTable(
	'dish_ratings',
	{
		id: integer('id').primaryKey(),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		dishId: integer('dish_id').notNull(),
		// Who rated. Empty once they're removed from the household, so the rating still counts.
		// removeMember empties it, since a composite key's SET NULL would empty household_id too.
		userId: integer('user_id'),
		stars: integer('stars').notNull()
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		foreignKey({
			columns: [t.householdId, t.userId],
			foreignColumns: [users.householdId, users.id]
		}),
		uniqueIndex('dish_ratings_dish_user').on(t.dishId, t.userId),
		index('dish_ratings_household').on(t.householdId),
		index('dish_ratings_user').on(t.userId),
		check('dish_ratings_stars', sql`${t.stars} between 1 and 5`)
	]
);

// A date's dinners, in the order they were added (by id); up to 5, and labeled only when there's
// more than one (6.9). A date with no row isn't planned.
export const dinners = sqliteTable(
	'dinners',
	{
		// Never reused after a dinner is cleared, so a page that still shows a cleared dinner's id
		// can't reach a newer dinner (Copy a dinner posts the id it showed).
		id: integer('id').primaryKey({ autoIncrement: true }),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		// YYYY-MM-DD in the household's time zone.
		date: text('date').notNull(),
		// Set on every dinner of a date with more than one, and only then; the data layer keeps it so.
		label: text('label'),
		type: text('type', { enum: DINNER_TYPES }).notNull(),
		// The restaurant, as typed or as requested. Only on Eating out dinners, and optional there;
		// the data layer keeps it so (6.9).
		restaurantName: text('restaurant_name'),
		note: text('note'),
		// Starts at the household's usual servings (Q28).
		servings: integer('servings').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [
		unique('dinners_household_id').on(t.householdId, t.id),
		index('dinners_household_date').on(t.householdId, t.date),
		check('dinners_type', sql`${t.type} in ('cook', 'eat_out', 'going', 'leftovers')`),
		check('dinners_servings', sql`${t.servings} >= 1`)
	]
);

// Only Cooking at home and Bringing a dish dinners have dishes (Q26); the data layer keeps it so.
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

export const REQUEST_KINDS = ['dish', 'restaurant'] as const;

// A dish or a restaurant someone asked for. It's active until someone completes it, by hand or by
// adding it to a date, which keeps it in the completed history, or removes it, which deletes it
// (design 6.12).
export const dishRequests = sqliteTable(
	'dish_requests',
	{
		// Never reused after a request is removed, so a page that still shows it can't remove,
		// complete or add a newer one (6.12).
		id: integer('id').primaryKey({ autoIncrement: true }),
		householdId: integer('household_id')
			.notNull()
			.references(() => households.id),
		// Who asked. Removing them from the household removes their active requests and empties it on
		// their completed ones, which asked_by still names them on. removeMember empties it, since a
		// composite key's SET NULL would empty household_id too.
		userId: integer('user_id'),
		// Requests made before restaurant requests are dish requests.
		kind: text('kind', { enum: REQUEST_KINDS }).notNull().default('dish'),
		// As typed, or the dish's name when requested from its recipe's page, until someone edits
		// it. Kept when the linked dish is renamed or archived.
		name: text('name').notNull(),
		note: text('note'),
		// Only on a dish request: the recipe the name matched when it was asked for or last edited,
		// the one the request or the edit made, or the one whose page it was requested from. Only
		// an edit that changes the name changes it (MEA-251).
		dishId: integer('dish_id'),
		createdAt: integer('created_at').notNull(),
		// When someone completed it, by hand or by adding it to a date; empty while it's active.
		completedAt: integer('completed_at'),
		// Who asked, by name as it was when it was completed, so its history still names them after
		// they're removed; empty while it's active.
		askedBy: text('asked_by')
	},
	(t) => [
		foreignKey({
			columns: [t.householdId, t.userId],
			foreignColumns: [users.householdId, users.id]
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.householdId, t.dishId],
			foreignColumns: [dishes.householdId, dishes.id]
		}),
		index('dish_requests_household').on(t.householdId),
		index('dish_requests_user').on(t.userId),
		index('dish_requests_dish').on(t.dishId),
		check('dish_requests_kind', sql`${t.kind} in ('dish', 'restaurant')`),
		check('dish_requests_kind_dish', sql`(${t.kind} = 'dish') = (${t.dishId} is not null)`),
		// Only a completed request names who asked, and only one can outlast them.
		check('dish_requests_asked_by', sql`(${t.completedAt} is null) = (${t.askedBy} is null)`),
		check('dish_requests_asker', sql`${t.completedAt} is not null or ${t.userId} is not null`)
	]
);

// AI assistants (design 6.17). These tables belong to the integration, not to a household, and
// no assistant can read them.

export const AI_PLATFORMS = ['chatgpt', 'claude'] as const;
export type AiPlatform = (typeof AI_PLATFORMS)[number];

// An AI assistant's connection: the OAuth client ChatGPT or Claude registered (RFC 7591), which
// can be used once the admin allows it. Revoking it deletes it, with its tokens and proposals.
export const aiConnections = sqliteTable(
	'ai_connections',
	{
		// Never reused, so a revoked connection's id never names a newer one.
		id: integer('id').primaryKey({ autoIncrement: true }),
		// The client_id it registered with: random, and not a secret.
		clientId: text('client_id').notNull().unique(),
		// SHA-256 of its client secret; empty for a client registered without one.
		secretHash: text('secret_hash'),
		// Which assistant it is, from the redirect URIs it registered.
		platform: text('platform', { enum: AI_PLATFORMS }).notNull(),
		// The redirect URIs it registered, as a JSON list.
		redirectUris: text('redirect_uris').notNull(),
		createdAt: integer('created_at').notNull(),
		// The admin who allowed it, and when; empty until then.
		userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
		authorizedAt: integer('authorized_at'),
		lastUsedAt: integer('last_used_at')
	},
	(t) => [
		check('ai_connections_platform', sql`${t.platform} in ('chatgpt', 'claude')`),
		check('ai_connections_authorized', sql`(${t.userId} is null) = (${t.authorizedAt} is null)`)
	]
);

export const AI_TOKEN_KINDS = ['code', 'access', 'refresh'] as const;

// A connection's authorization codes, access tokens and refresh tokens. As for sessions, only a
// SHA-256 hash of each is stored.
export const aiTokens = sqliteTable(
	'ai_tokens',
	{
		id: text('id').primaryKey(),
		connectionId: integer('connection_id')
			.notNull()
			.references(() => aiConnections.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: AI_TOKEN_KINDS }).notNull(),
		expiresAt: integer('expires_at').notNull(),
		// A code's redirect URI and PKCE challenge, which exchanging it must match.
		redirectUri: text('redirect_uri'),
		codeChallenge: text('code_challenge')
	},
	(t) => [
		index('ai_tokens_connection').on(t.connectionId),
		check('ai_tokens_kind', sql`${t.kind} in ('code', 'access', 'refresh')`),
		check(
			'ai_tokens_code',
			sql`(${t.kind} = 'code') = (${t.redirectUri} is not null and ${t.codeChallenge} is not null)`
		)
	]
);

export const AI_PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'failed'] as const;

// Changes an assistant proposed, which happen only when the admin approves them (design 6.17).
export const aiProposals = sqliteTable(
	'ai_proposals',
	{
		// Never reused, so a link to a proposal that's gone never opens a newer one.
		id: integer('id').primaryKey({ autoIncrement: true }),
		connectionId: integer('connection_id')
			.notNull()
			.references(() => aiConnections.id, { onDelete: 'cascade' }),
		// The changes and what the confirmation page shows of each, as JSON. Never changed once
		// saved: approving sends back its SHA-256, which must match.
		content: text('content').notNull(),
		status: text('status', { enum: AI_PROPOSAL_STATUSES }).notNull(),
		// Why applying it failed, on a failed proposal.
		error: text('error'),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull(),
		// When the admin approved or rejected it, or approving it failed.
		decidedAt: integer('decided_at')
	},
	(t) => [
		index('ai_proposals_connection').on(t.connectionId),
		check(
			'ai_proposals_status',
			sql`${t.status} in ('pending', 'approved', 'rejected', 'failed')`
		),
		check('ai_proposals_decided', sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
		check('ai_proposals_error', sql`(${t.status} = 'failed') = (${t.error} is not null)`)
	]
);
