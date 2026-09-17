import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_sessions_expiry").on(table.expiresAt)]);
export const oauthStates = sqliteTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  verifier: text("verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_oauth_states_expiry").on(table.expiresAt)]);
export const libraries = sqliteTable("libraries", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  document: text("document").notNull().default("{}"),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
export const authLimits = sqliteTable("auth_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_auth_limits_expiry").on(table.expiresAt)]);

export const ipSubscriptions = sqliteTable("ip_subscriptions", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ipId: text("ip_id").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.ipId] })]);
export const ipNotifications = sqliteTable("ip_notifications", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  articleId: text("article_id").notNull(),
  article: text("article").notNull(),
  ipIds: text("ip_ids").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
  readAt: integer("read_at"),
}, (table) => [primaryKey({ columns: [table.userId, table.articleId] }), index("idx_ip_notifications_user_created").on(table.userId, table.createdAt)]);
