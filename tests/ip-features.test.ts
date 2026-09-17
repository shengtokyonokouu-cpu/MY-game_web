import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hash, token, type AppEnv, type Database, type Prepared } from "../app/lib/auth.ts";
import { accountIPState, collectIPNotifications, handleIPAccount } from "../app/lib/ip-account-api.ts";
import { articleCategories, articleFranchises, articlePlatforms, gameFranchises, ipTimeline, majorNewsReason, matchFranchises, suggestFranchises } from "../app/lib/franchises.ts";
import { buildIPHub } from "../app/lib/ip-hub.ts";
import { curatedGames, type CatalogGame } from "../app/lib/catalog.ts";
import type { NewsArticle, NewsFeed } from "../app/lib/news.ts";

const site = "https://release-signal.pages.dev";
const now = Date.parse("2026-09-17T09:00:00Z");
function article(title: string, extra: Partial<NewsArticle> = {}): NewsArticle { return { id: `${site}/${encodeURIComponent(title)}`, url: `https://blog.playstation.com/${encodeURIComponent(title)}`, title, excerpt: "", sourceId: "playstation", sourceName: "PlayStation Blog", sourceKind: "official", topic: "news", language: "英文", publishedAt: new Date(now - 1000).toISOString(), ...extra }; }
function feed(items: NewsArticle[]): NewsFeed { return { items, fetchedAt: new Date(now).toISOString(), sources: [{ id: "playstation", name: "PlayStation Blog", ok: true, count: items.length }] }; }
function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../drizzle/", import.meta.url); for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  const db: Database = { prepare(sql) {
    const statement = sqlite.prepare(sql); let values: (string | number | null)[] = [];
    const prepared: Prepared = { bind(...next) { values = next as typeof values; return prepared; }, async first<T>() { return (statement.get(...values) || null) as T | null; }, async run() { return statement.run(...values); } }; return prepared;
  }, async batch(statements) { sqlite.exec("BEGIN"); try { const result = []; for (const item of statements) result.push(await item.run()); sqlite.exec("COMMIT"); return result; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  return { db, sqlite };
}
async function user(db: Database, id: string) {
  const raw = token(); await db.batch([
    db.prepare("INSERT INTO users (id, login, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, id, id, now, now),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await hash(raw), id, Date.now() + 600000),
  ]);
  return { Cookie: `__Host-release-session=${raw}`, Origin: site, "Content-Type": "application/json", "X-CSRF-Token": await hash(`csrf:${raw}`) };
}
test("IP aliases map Chinese, Japanese and English work names without broad homonym matching", () => {
  for (const value of ["TotK", "王国之泪", "Tears of the Kingdom", "ゼルダの伝説"]) assert.equal(suggestFranchises(value)[0].id, "zelda");
  for (const value of ["宝可梦", "寶可夢", "ポケモン", "Pokémon", "Pokemon"]) assert.equal(matchFranchises(value)[0].id, "pokemon");
  assert.equal(matchFranchises("薬屋のひとりごと ～偽りの皇弟～")[0].id, "apothecary-diaries");
  assert.equal(matchFranchises("界の軌跡")[0].id, "trails");
  assert.equal(matchFranchises("Fire Emblem: Three Houses")[0].id, "fire-emblem");
  for (const value of ["Zeldathon", "TotK200", "personal guide", "The trails of the forest", "FE", "Link", "宇宙运行轨迹"]) assert.deepEqual(matchFranchises(value), [], value);
  const games = [{ ...curatedGames[0], title: "独立游戏", originalTitle: "Original game", articleTitle: "Original game", names: {}, summary: "Inspired by Zelda", searchTerms: ["Zelda"] }];
  assert.deepEqual(gameFranchises(games[0]), [], "a comparison/search hint is not an IP assignment");
});
test("multi-IP article classification and explicit platform intersection preserve provenance", () => {
  const value = article("Pokémon and Zelda: new trailer for Switch 2 and PC");
  assert.deepEqual(articleFranchises(value).map((ip) => ip.id), ["zelda", "pokemon"]);
  assert.deepEqual(articlePlatforms(value), ["Switch 2", "PC"]);
  assert.ok(articleCategories(value).includes("video"));
  assert.equal(majorNewsReason(value), "新预告发布");
  assert.deepEqual(articlePlatforms(article("Fire Emblem new trailer")), [], "publisher/source does not imply platform");
  assert.equal(majorNewsReason(article("Zelda release date confirmed")), "发售计划更新");
  assert.equal(majorNewsReason(article("Fire Emblem launches November 5")), "发售计划更新");
  assert.equal(majorNewsReason(article("ゼルダの伝説は11月5日発売")), "发售计划更新");
  assert.equal(majorNewsReason(article("ゼルダの伝説 amiibo 発売決定")), null);
  for (const title of ["Zelda new trailer?", "Zelda release date confirmed rumor", "Zelda review and new trailer", "Zelda necklace release date confirmed", "Zelda movie new trailer"]) assert.equal(majorNewsReason(article(title)), null, title);
  assert.equal(majorNewsReason(article("Zelda new trailer", { topic: "rumor" })), null);
});
test("IP hub cross filters and pagination and timeline never invent dates", () => {
  const games: CatalogGame[] = [{ ...curatedGames[0], title: "ゼルダの伝説", originalTitle: "Zelda", names: {}, articleTitle: "Zelda", platforms: ["Switch 2"], declaredStatus: "upcoming", releaseDate: null, dateLabel: "2027 年", releases: undefined }];
  const items = Array.from({ length: 25 }, (_, i) => article(`Zelda new trailer ${i} for Switch 2`));
  const result = buildIPHub("zelda", games, feed(items), { page: 2, platform: "Switch 2", category: "video" })!;
  assert.equal(result.news.items.length, 12); assert.equal(result.news.pages, 3); assert.equal(result.counts.news, 25); assert.equal(result.games.length, 1);
  assert.equal(buildIPHub("zelda", games, feed(items), { platform: "PC" })!.news.total, 0);
  assert.equal(buildIPHub("missing", games, feed(items)), null);
  const timeline = ipTimeline(games, now); assert.equal(timeline[0].date, null); assert.equal(timeline[0].label, "2027 年");
  assert.equal(ipTimeline([{ ...games[0], releaseDate: "2020-01-01" }], now).length, 0);
});
test("subscriptions enforce authentication, CSRF, ownership, validation and idempotence", async () => {
  const { db, sqlite } = database(); const env: AppEnv = { DB: db, PUBLIC_ORIGIN: site }; const a = await user(db, "github:a"); const b = await user(db, "github:b");
  const request = (body: unknown, headers = a) => new Request(`${site}/api/subscriptions`, { method: "PUT", headers, body: JSON.stringify(body) });
  const news = async () => feed([]);
  assert.equal((await handleIPAccount(new Request(`${site}/api/subscriptions`), env, news)).status, 401);
  assert.equal((await handleIPAccount(request({ ipId: "zelda", following: true }, { ...a, Origin: "https://evil.test" }), env, news)).status, 403);
  assert.equal((await handleIPAccount(request({ ipId: "zelda", following: true }, { ...a, "X-CSRF-Token": "bad" }), env, news)).status, 403);
  for (const body of [null, { ipId: "fake", following: true }, { ipId: "zelda", following: "true" }]) assert.equal((await handleIPAccount(request(body), env, news)).status, 400);
  assert.equal((await handleIPAccount(request({ ipId: "zelda", following: true, userId: "github:b" }), env, news)).status, 200);
  const original = sqlite.prepare("SELECT created_at FROM ip_subscriptions WHERE user_id = 'github:a'").get();
  await handleIPAccount(request({ ipId: "zelda", following: true }), env, news);
  assert.deepEqual(sqlite.prepare("SELECT created_at FROM ip_subscriptions WHERE user_id = 'github:a'").get(), original);
  assert.deepEqual((await accountIPState(db, "github:a")).following, ["zelda"]);
  const other = await handleIPAccount(new Request(`${site}/api/subscriptions`, { headers: b }), env, news); assert.deepEqual((await other.json()).following, []); assert.equal(other.headers.get("Cache-Control"), "private, no-store");
  await handleIPAccount(request({ ipId: "zelda", following: false }), env, news); assert.deepEqual((await accountIPState(db, "github:a")).following, []);
  sqlite.close();
});
test("an unsubscribe racing with notification collection is rechecked at insert time", async () => {
  const { db, sqlite } = database(); await user(db, "github:a");
  await db.prepare("INSERT INTO ip_subscriptions (user_id, ip_id, created_at) VALUES (?, ?, ?)").bind("github:a", "zelda", now - 2000).run();
  const raced: Database = { prepare: db.prepare, async batch(statements) { await db.prepare("DELETE FROM ip_subscriptions WHERE user_id = ?").bind("github:a").run(); return db.batch(statements); } };
  await collectIPNotifications(raced, "github:a", feed([article("Zelda new trailer")]), now);
  assert.equal((await accountIPState(db, "github:a")).notifications.length, 0); sqlite.close();
});
test("notification generation is CSRF protected and rate limited per account", async () => {
  const { db, sqlite } = database(); const a = await user(db, "github:a"); const b = await user(db, "github:b"); const env = { DB: db, PUBLIC_ORIGIN: site };
  const request = (headers = a) => new Request(`${site}/api/notifications`, { method: "POST", headers });
  assert.equal((await handleIPAccount(request({ ...a, "X-CSRF-Token": "bad" }), env, async () => feed([]))).status, 403);
  for (let i = 0; i < 6; i++) assert.equal((await handleIPAccount(request(), env, async () => feed([]))).status, 200);
  assert.equal((await handleIPAccount(request(), env, async () => feed([]))).status, 429);
  assert.equal((await handleIPAccount(request(b), env, async () => feed([]))).status, 200); sqlite.close();
});
test("notifications start at follow time, deduplicate across IPs and preserve cloud read state", async () => {
  const { db, sqlite } = database(); const a = await user(db, "github:a"); const b = await user(db, "github:b"); const env = { DB: db, PUBLIC_ORIGIN: site };
  for (const id of ["zelda", "pokemon"]) await db.prepare("INSERT INTO ip_subscriptions (user_id, ip_id, created_at) VALUES (?, ?, ?)").bind("github:a", id, now - 2000).run();
  const valid = article("Zelda and Pokémon new trailer for Switch 2");
  const items = [valid, article("Zelda new trailer old", { publishedAt: new Date(now - 3000).toISOString() }), article("Zelda new trailer rumor", { topic: "rumor" }), article("Zelda future new trailer", { publishedAt: new Date(now + 1000).toISOString() })];
  await collectIPNotifications(db, "github:a", feed(items), now); await collectIPNotifications(db, "github:a", feed(items), now);
  const state = await accountIPState(db, "github:a"); assert.equal(state.notifications.length, 1); assert.equal(state.unread, 1); assert.deepEqual(state.notifications[0].ipIds, ["zelda", "pokemon"]);
  assert.equal((await accountIPState(db, "github:b")).unread, 0);
  const read = (headers: typeof a, body: unknown) => new Request(`${site}/api/notifications`, { method: "PATCH", headers, body: JSON.stringify(body) });
  await handleIPAccount(read(b, { ids: [state.notifications[0].id] }), env, async () => feed(items)); assert.equal((await accountIPState(db, "github:a")).unread, 1);
  await handleIPAccount(read(a, { ids: [state.notifications[0].id] }), env, async () => feed(items));
  await collectIPNotifications(db, "github:a", feed(items), now); assert.equal((await accountIPState(db, "github:a")).unread, 0);
  assert.equal((await handleIPAccount(read(a, { ids: ["bad"] }), env, async () => feed(items))).status, 400);
  await db.prepare("DELETE FROM ip_subscriptions WHERE user_id = ?").bind("github:a").run();
  await collectIPNotifications(db, "github:a", feed([article("Zelda another new trailer")]), now); assert.equal((await accountIPState(db, "github:a")).notifications.length, 1);
  await collectIPNotifications(db, "github:a", feed([]), now + 31 * 86400000); assert.equal((await accountIPState(db, "github:a")).notifications.length, 0);
  sqlite.close();
});
