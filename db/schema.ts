import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

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
