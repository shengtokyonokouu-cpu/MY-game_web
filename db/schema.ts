import { integer, sqliteTable, text, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

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
}, (table) => [primaryKey({ columns: [table.userId, table.ipId] }), index("idx_ip_subscriptions_ip").on(table.ipId)]);
export const ipNotifications = sqliteTable("ip_notifications", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  articleId: text("article_id").notNull(),
  article: text("article").notNull(),
  ipIds: text("ip_ids").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
  readAt: integer("read_at"),
}, (table) => [primaryKey({ columns: [table.userId, table.articleId] }), index("idx_ip_notifications_user_created").on(table.userId, table.createdAt)]);

export const ipRegistry = sqliteTable("ip_registry", {
  id: text("id").primaryKey(), entityId: text("entity_id"), document: text("document").notNull(),
  version: integer("version").notNull(), promotedAt: integer("promoted_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_ip_registry_entity").on(t.entityId)]);
export const ipArticles = sqliteTable("ip_articles", {
  seq: integer("seq").primaryKey({ autoIncrement: true }), id: text("id").notNull(), document: text("document").notNull(),
  body: text("body").notNull().default(""), bodyStatus: text("body_status").notNull().default("pending"),
  contentHash: text("content_hash").notNull(), publishedAt: integer("published_at").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_ip_articles_id").on(t.id), index("idx_ip_articles_published").on(t.publishedAt)]);
export const ipCandidates = sqliteTable("ip_candidates", {
  key: text("key").primaryKey(), name: text("name").notNull(), language: text("language").notNull(),
  entityId: text("entity_id"), evidence: text("evidence"), status: text("status").notNull().default("pending"),
  firstSeen: integer("first_seen").notNull(), lastSeen: integer("last_seen").notNull(),
}, (t) => [index("idx_ip_candidates_entity").on(t.entityId), index("idx_ip_candidates_status").on(t.status, t.lastSeen)]);
export const ipCandidateMentions = sqliteTable("ip_candidate_mentions", {
  candidateKey: text("candidate_key").notNull().references(() => ipCandidates.key, { onDelete: "cascade" }),
  articleSeq: integer("article_seq").notNull().references(() => ipArticles.seq, { onDelete: "cascade" }),
  publishedAt: integer("published_at").notNull(), sourceId: text("source_id").notNull(),
}, (t) => [primaryKey({ columns: [t.candidateKey, t.articleSeq] }), index("idx_ip_mentions_window").on(t.publishedAt, t.candidateKey)]);
export const ipArticleTags = sqliteTable("ip_article_tags", {
  articleSeq: integer("article_seq").notNull().references(() => ipArticles.seq, { onDelete: "cascade" }),
  ipId: text("ip_id").notNull().references(() => ipRegistry.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), evidence: text("evidence").notNull(),
}, (t) => [primaryKey({ columns: [t.articleSeq, t.ipId] }), index("idx_ip_tags_ip_article").on(t.ipId, t.articleSeq)]);
export const ipJobs = sqliteTable("ip_jobs", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), target: text("target").notNull(), version: integer("version").notNull().default(0),
  cursor: integer("cursor").notNull().default(0), state: text("state").notNull().default("pending"),
  owner: text("owner"), leaseUntil: integer("lease_until").notNull().default(0), attempts: integer("attempts").notNull().default(0),
  availableAt: integer("available_at").notNull(), error: text("error"), updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_ip_jobs_ready").on(t.state, t.availableAt), index("idx_ip_jobs_lease").on(t.state, t.leaseUntil)]);
export const ipEngineState = sqliteTable("ip_engine_state", {
  key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: integer("updated_at").notNull(),
});
