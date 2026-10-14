import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// Compatibility aliases for verified Sites visitors whose dispatch currently
// supplies email without its Site-scoped ID. Records retain an opaque user key.
export const identityAliases = sqliteTable('identity_aliases', {
  alias: text('alias').primaryKey(), userId: text('user_id').notNull(),
  platformId: text('platform_id'), createdAt: text('created_at').notNull(),
}, (t) => [index('identity_platform').on(t.platformId)]);

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull(),
  city: text('city').notNull().default('Москва'), theme: text('theme').notNull().default('light'),
  recipeFavorites: text('recipe_favorites').notNull().default('[]'), createdAt: text('created_at').notNull(),
});
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(), createdAt: text('created_at').notNull(),
});
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), groupId: text('group_id').notNull().references(() => groups.id),
  userId: text('user_id').notNull(), name: text('name').notNull(), role: text('role').notNull(),
}, (t) => [index('members_user').on(t.userId)]);
export const invites = sqliteTable('invites', {
  hash: text('hash').primaryKey(), groupId: text('group_id').notNull().references(() => groups.id),
  role: text('role').notNull(), expiresAt: text('expires_at').notNull(), revoked: integer('revoked').notNull().default(0),
});
export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), groupId: text('group_id').references(() => groups.id),
  name: text('name').notNull(), icon: text('icon').notNull().default('🛒'), budget: integer('budget').notNull().default(0),
  date: text('date'), favorite: integer('favorite').notNull().default(0), archived: integer('archived').notNull().default(0),
  example: integer('example').notNull().default(0), revision: integer('revision').notNull().default(0), createdAt: text('created_at').notNull(),
}, (t) => [index('lists_owner').on(t.owner), index('lists_group').on(t.groupId)]);
export const items = sqliteTable('items', {
  id: text('id').primaryKey(), listId: text('list_id').notNull().references(() => lists.id), name: text('name').notNull(),
  quantity: real('quantity').notNull().default(1), unit: text('unit').notNull().default('шт'), price: integer('price'),
  category: text('category').notNull().default('Продукты'), note: text('note').notNull().default(''),
  bought: integer('bought').notNull().default(0), boughtAt: text('bought_at'), important: integer('important').notNull().default(0),
  favorite: integer('favorite').notNull().default(0), deleted: integer('deleted').notNull().default(0),
  barcode: text('barcode'), store: text('store'), sourceUrl: text('source_url'), revision: integer('revision').notNull().default(0),
}, (t) => [index('items_list').on(t.listId)]);
export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), data: text('data').notNull(), createdAt: text('created_at').notNull(),
});
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), store: text('store').notNull(), city: text('city').notNull(),
  url: text('url').notNull(), enabled: integer('enabled').notNull().default(1), lastAttempt: text('last_attempt'),
  lastSuccess: text('last_success'), status: text('status').notNull().default('waiting'), message: text('message').notNull().default('Ожидает обновления'),
});
// Resumable public catalogue draft, isolated from personal shopping lists.
export const catalogJobs=sqliteTable('catalog_jobs',{sourceId:text('source_id').primaryKey().references(()=>sources.id),data:text('data').notNull(),startedAt:text('started_at').notNull(),updatedAt:text('updated_at').notNull()});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), sourceId: text('source_id').notNull().references(() => sources.id),
  store: text('store').notNull(), city: text('city').notNull(), name: text('name').notNull(), price: integer('price').notNull(),
  unit: text('unit').notNull().default('шт'), barcode: text('barcode'), image: text('image'), url: text('url').notNull(),
  category: text('category').notNull().default('Продукты'), updatedAt: text('updated_at').notNull(),
  foodId: text('food_id'), packQuantity: real('pack_quantity'), regularPrice: integer('regular_price'), minPacks: integer('min_packs').notNull().default(1),
  minQuantity: real('min_quantity'), quantityStep: real('quantity_step'),
  loyaltyRequired: integer('loyalty_required').notNull().default(0), validFrom: text('valid_from'), validTo: text('valid_to'),
  priceKind: text('price_kind').notNull().default('catalog'), regionVerified: integer('region_verified').notNull().default(0),
}, (t) => [index('products_owner').on(t.owner)]);

export const familySettings = sqliteTable('family_settings', {
  owner: text('owner').primaryKey(), data: text('data').notNull(), revision: integer('revision').notNull().default(0), updatedAt: text('updated_at').notNull(),
});
export const mealPlans = sqliteTable('meal_plans', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(), startDate: text('start_date').notNull(),
  data: text('data').notNull(), status: text('status').notNull().default('draft'), revision: integer('revision').notNull().default(0),
  listId: text('list_id').references(() => lists.id), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('meal_plans_owner').on(t.owner)]);
export const aiCredentials = sqliteTable('ai_credentials', {
  owner: text('owner').primaryKey(), encryptedKey: text('encrypted_key').notNull(), model: text('model').notNull().default('deepseek-flash'),
  lastRequestAt: text('last_request_at'), checkedAt: text('checked_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const aiRequests = sqliteTable('ai_requests', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0), outputTokens: integer('output_tokens').notNull().default(0),
}, (t) => [index('ai_requests_owner').on(t.owner,t.createdAt)]);
export const priceOffers = sqliteTable('price_offers', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), foodId: text('food_id').notNull(), store: text('store').notNull(), city: text('city').notNull(),
  name: text('name').notNull(), packQuantity: real('pack_quantity').notNull(), price: integer('price').notNull(), regularPrice: integer('regular_price'),
  minPacks: integer('min_packs').notNull().default(1), loyaltyRequired: integer('loyalty_required').notNull().default(0),
  compositionConfirmed: integer('composition_confirmed').notNull().default(0), validFrom: text('valid_from'), validTo: text('valid_to'),
  url: text('url'), kind: text('kind').notNull().default('manual'), verifiedAt: text('verified_at').notNull(), disabled: integer('disabled').notNull().default(0),
}, (t) => [index('price_offers_owner').on(t.owner)]);
