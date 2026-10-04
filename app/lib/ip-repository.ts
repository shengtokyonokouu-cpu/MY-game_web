import type { Database, Prepared } from "./auth.ts";
import { franchises as seeds, type Franchise } from "./franchises.ts";
import type { NewsArticle, NewsFeed } from "./news.ts";
import { newsSources } from "./news-sources.ts";

// D1 and node:sqlite test adapters share first/batch. Column names are internal,
// never request parameters. Each prepared statement contains exactly one SQL.
export async function rows<T>(db: Database, sql: string, columns: string[], values: unknown[] = []): Promise<T[]> {
  const projection = columns.map((key) => "'" + key + "'," + key).join(",");
  const result = await db.prepare("SELECT COALESCE(json_group_array(json_object(" + projection + ")), '[]') AS data FROM (" + sql + ")").bind(...values).first<{ data: string }>();
  return JSON.parse(result?.data || "[]") as T[];
}
export async function batches(db: Database, statements: Prepared[]) {
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
}
export function stateStatement(db: Database, key: string, value: unknown, now: number) {
  return db.prepare("INSERT INTO ip_engine_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key, JSON.stringify(value), now);
}
export async function stateValue<T>(db: Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM ip_engine_state WHERE key=?").bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : null;
}
export function jobStatement(db: Database, kind: string, target: string, now: number, version = 0, suffix = "") {
  return db.prepare("INSERT INTO ip_jobs (id,kind,target,version,available_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(kind + ":" + target + ":" + version + suffix, kind, target, version, now, now);
}
export async function seedRegistry(db: Database, now = Date.now()) {
  // Existing subscription IDs survive migration. These are bootstrap entries,
  // not a limit, and runtime initialization does not modify the schema.
  await db.batch(seeds.map((ip) => db.prepare("INSERT INTO ip_registry (id,document,version,promoted_at,updated_at) VALUES (?,?,1,0,?) ON CONFLICT(id) DO NOTHING").bind(ip.id, JSON.stringify(ip), now)));
  for (const ip of seeds) await jobStatement(db, "scan", ip.id, now, 1).run();
}
export async function readRegistry(db: Database, stats = false, now = Date.now()): Promise<Franchise[]> {
  const result: Franchise[] = []; let cursor = "";
  do {
    const page = await rows<{ id: string; document: string; entity_id: string | null; version: number; promoted_at: number; updated_at: number }>(db, "SELECT * FROM ip_registry WHERE id>? ORDER BY id LIMIT 100", ["id", "document", "entity_id", "version", "promoted_at", "updated_at"], [cursor]);
    for (const row of page) result.push({ ...JSON.parse(row.document), id: row.id, entityId: row.entity_id || undefined, version: row.version, promotedAt: row.promoted_at, updatedAt: row.updated_at, discovered: row.promoted_at > now - 7 * 86400000 });
    if (page.length < 100) break; cursor = page.at(-1)!.id;
  } while (cursor);
  if (!stats) return result;
  const counts = await rows<{ ip_id: string; news: number; recent: number; previous: number; latest: number }>(db,
    "SELECT t.ip_id,COUNT(*) AS news,SUM(a.published_at>=?) AS recent,SUM(a.published_at>=? AND a.published_at<?) AS previous,MAX(a.published_at) AS latest FROM ip_article_tags t JOIN ip_articles a ON a.seq=t.article_seq WHERE a.published_at<=? GROUP BY t.ip_id",
    ["ip_id", "news", "recent", "previous", "latest"], [now - 86400000, now - 2 * 86400000, now - 86400000, now]);
  const followers = await rows<{ ip_id: string; count: number }>(db, "SELECT ip_id,COUNT(*) AS count FROM ip_subscriptions GROUP BY ip_id", ["ip_id", "count"]);
  const countMap = new Map(counts.map((c) => [c.ip_id, c])); const followMap = new Map(followers.map((c) => [c.ip_id, c.count]));
  return result.map((ip) => { const c = countMap.get(ip.id); return { ...ip, newsCount: c?.news || 0, recentCount: c?.recent || 0, previousCount: c?.previous || 0, followerCount: followMap.get(ip.id) || 0, updatedAt: c?.latest || ip.updatedAt, rising: !!c && c.recent >= 6 && c.recent >= Math.max(1, c.previous) * 2 }; });
}
export async function registeredIP(db: Database, id: string) {
  return !!await db.prepare("SELECT id FROM ip_registry WHERE id=?").bind(id).first();
}
export async function archivedNews(db: Database, ipId?: string, limit = 300, offset = 0): Promise<NewsFeed & { total: number }> {
  const where = ipId ? "WHERE EXISTS (SELECT 1 FROM ip_article_tags t WHERE t.article_seq=a.seq AND t.ip_id=?)" : "";
  const values = ipId ? [ipId] : [];
  const data = await rows<{ document: string; ids: string }>(db,
    "SELECT a.document,(SELECT json_group_array(ip_id) FROM ip_article_tags WHERE article_seq=a.seq) AS ids FROM ip_articles a " + where + " ORDER BY a.published_at DESC,a.seq DESC LIMIT ? OFFSET ?",
    ["document", "ids"], [...values, limit, offset]);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM ip_articles a " + where).bind(...values).first<{ count: number }>();
  const health = await rows<{ key: string; value: string; updated_at: number }>(db, "SELECT * FROM ip_engine_state WHERE key LIKE 'source:%'", ["key", "value", "updated_at"]);
  const sources = newsSources.map((s) => { const h = health.find((r) => r.key === "source:" + s.id); const value = h ? JSON.parse(h.value) : null; return { id: s.id, name: s.name, ok: !!value?.ok && h!.updated_at > Date.now() - 3600000, count: value?.count || 0 }; });
  const last = Math.max(0, ...health.filter((h) => JSON.parse(h.value).ok).map((h) => h.updated_at));
  return { items: data.map((a) => ({ ...JSON.parse(a.document) as NewsArticle, ipIds: JSON.parse(a.ids || "[]") })), total: count?.count || 0, fetchedAt: new Date(last || Date.now()).toISOString(), sources, stale: !last || Date.now() - last > 3600000 };
}
export async function engineStatus(db: Database) {
  const totals = await db.prepare("SELECT (SELECT COUNT(*) FROM ip_registry) AS channels,(SELECT COUNT(*) FROM ip_articles) AS articles,(SELECT COUNT(*) FROM ip_articles WHERE body_status='complete') AS bodies,(SELECT COUNT(*) FROM ip_articles WHERE body_status='blocked') AS blockedBodies,(SELECT COUNT(*) FROM ip_candidates WHERE status='pending') AS candidates,(SELECT COUNT(*) FROM ip_candidates WHERE status='verified') AS verified,(SELECT COUNT(*) FROM ip_jobs WHERE state IN ('pending','running')) AS pendingJobs,(SELECT COUNT(*) FROM ip_jobs WHERE state='failed') AS failedJobs").first();
  const heartbeat = await stateValue<{ at: number; error?: string }>(db, "heartbeat");
  const entityService = await stateValue<{ ok: boolean; retryAt: number }>(db, "entity-service");
  const scans = await rows<{ target: string; cursor: number; state: string; version: number }>(db, "SELECT target,cursor,state,version FROM ip_jobs WHERE kind='scan' AND state!='done' ORDER BY updated_at DESC LIMIT 10", ["target", "cursor", "state", "version"]);
  return { ...totals, heartbeat: heartbeat?.at || null, healthy: !!heartbeat && Date.now() - heartbeat.at < 10 * 60000, entityService, scans, threshold: { articles: 6, sources: 2, windowHours: 24 }, mode: "rule-ner+wikidata" };
}
