import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { Database, Prepared } from "../app/lib/auth.ts";
import { extractEntities, resolveEntity, wikidataClient, EntityBackoff, type EntityEvidence } from "../app/lib/ip-entities.ts";
import { claimJob, ingestArticle, promoteCandidates, saveFranchise, scanBatch, robotsAllowed, runEngineJob } from "../app/lib/ip-engine.ts";
import { readRegistry, archivedNews, rows, stateStatement } from "../app/lib/ip-repository.ts";
import { articleFranchises, gameFranchises, type Franchise } from "../app/lib/franchises.ts";
import { curatedGames } from "../app/lib/catalog.ts";
import type { NewsArticle } from "../app/lib/news.ts";
const now = Date.parse("2026-09-17T09:00:00Z");
test("Wikidata maxlag uses Cloudflare-compatible fetch and a shared cooldown without dropping candidates", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, "manual"); return Response.json({ error: { code: "maxlag" } }, { headers: { "Retry-After": "120" } }); };
    await assert.rejects(wikidataClient({ action: "wbsearchentities", search: "Test Saga", language: "en" }), (error) => error instanceof EntityBackoff && error.retryAfter === 120000);
  } finally { globalThis.fetch = original; }
  const { db, sqlite } = database();
  await stateStatement(db, "entity-service", { ok: false, retryAt: now + 120000 }, now).run();
  await db.prepare("INSERT INTO ip_jobs (id,kind,target,available_at,updated_at) VALUES ('resolve:test','resolve','test',?,?)").bind(now, now).run();
  assert.equal(await runEngineJob(db, "resolve", now), false);
  assert.equal((await db.prepare("SELECT attempts FROM ip_jobs WHERE id='resolve:test'").first<{ attempts: number }>())?.attempts, 0);
  sqlite.close();
});
function database() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  const db: Database = { prepare(sql) { const statement = sqlite.prepare(sql); let values: (string | number | null)[] = [];
    const prepared: Prepared = { bind(...next) { values = next as typeof values; return prepared; }, async first<T>() { return (statement.get(...values) || null) as T | null; }, async run() { return statement.run(...values); } }; return prepared;
  }, async batch(statements) { sqlite.exec("BEGIN"); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec("COMMIT"); return result; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  return { db, sqlite };
}
const ip: Franchise = { id: "wd-q999", name: "测试系列", ja: "テスト", en: "Test Saga", description: "test", aliases: ["Test Saga"], color: "blue", sourceUrl: "https://www.wikidata.org/wiki/Q999" };
const evidence: EntityEvidence = { entityId: "Q999", matchedId: "Q998", names: { zh: "测试系列", ja: "テスト", en: "Test Saga" }, aliases: ["Test Saga", "测试系列"], matchedAliases: ["First Chapter", "第一章"], relation: "P179", sourceUrl: "https://www.wikidata.org/wiki/Q999", matchedUrl: "https://www.wikidata.org/wiki/Q998", checkedAt: now };
function article(i: number, extra: Partial<NewsArticle> = {}): NewsArticle {
  const url = "https://blog.playstation.com/story-" + i;
  return { id: url, url, title: "Test Saga new trailer " + i, excerpt: "First Chapter for PC", language: "英文", sourceId: i % 2 ? "gematsu" : "playstation", sourceName: "Test", sourceKind: "media", publishedAt: new Date(now - 1000).toISOString(), topic: "news", ...extra };
}
test("multilingual NER extracts quoted body titles, headline subjects and code names, not platform noise", () => {
  assert.ok(extractEntities("Resident Evil Requiem launches in 2027")[0].includes("Resident Evil Requiem"));
  const terms = extractEntities("新作情報", "《生化危机》と『星のカービィ』。Project Orion returns. “Final Fantasy”");
  for (const expected of ["生化危机", "星のカービィ", "Project Orion", "Final Fantasy"]) assert.ok(terms.includes(expected), expected);
  assert.ok(!extractEntities("Nintendo Switch").includes("Nintendo Switch"));
  assert.ok(extractEntities("A".repeat(5000)).length === 0);
});
test("entity verification follows explicit P179, keeps trilingual aliases, and rejects ambiguous/fuzzy parents", async () => {
  const claim = (id: string) => [{ mainsnak: { datavalue: { value: { id } } } }];
  const work = { id: "Q998", labels: { en: { value: "First Chapter" }, zh: { value: "第一章" } }, claims: { P31: claim("Q7889"), P179: claim("Q999") } };
  const series = { id: "Q999", labels: { en: { value: "Test Saga" }, ja: { value: "テスト" }, zh: { value: "测试系列" } }, claims: { P31: claim("Q7058673") } };
  const api = async (p: Record<string, string>) => p.action === "wbsearchentities" ? { search: [{ id: "Q998" }] } : { entities: p.ids === "Q998" ? { Q998: work } : { Q999: series } };
  const result = await resolveEntity("First Chapter", "en", api, now);
  assert.equal(result?.entityId, "Q999"); assert.equal(result?.relation, "P179"); assert.equal(result?.names.zh, "测试系列");
  assert.equal(await resolveEntity("First", "en", api, now), null);
  const wrong = async (p: Record<string, string>) => p.action === "wbsearchentities" ? { search: [{ id: "Q998" }] } : { entities: { Q998: { ...work, claims: { P31: claim("Q5") } } } };
  assert.equal(await resolveEntity("First Chapter", "en", wrong, now), null);
  const ambiguous = async (p: Record<string, string>) => p.action === "wbsearchentities" ? { search: [{ id: "Q998" }] } : { entities: p.ids === "Q998" ? { Q998: { ...work, claims: { P31: claim("Q7889"), P179: [...claim("Q999"), ...claim("Q997")] } } } : { Q999: series, Q997: { ...series, id: "Q997" } } };
  assert.equal(await resolveEntity("First Chapter", "en", ambiguous, now), null);
  const multilingual = async (p: Record<string, string>) => p.action === "wbsearchentities" ? { search: [{ id: "Q999" }] } : { entities: { Q999: { ...series, labels: { mul: { value: "Test Saga" }, ja: { value: "テスト" } } } } };
  assert.equal((await resolveEntity("Test Saga", "en", multilingual, now))?.names.en, "Test Saga");
});
test("candidate promotion counts distinct articles across aliases in a rolling window, not repeated polls", async () => {
  const { db, sqlite } = database();
  for (const key of ["en:first chapter", "zh:第一章"]) await db.prepare("INSERT INTO ip_candidates (key,name,language,entity_id,evidence,status,first_seen,last_seen) VALUES (?,?,?,?,?,'verified',?,?)").bind(key, key, "en", "Q999", JSON.stringify(evidence), now, now).run();
  for (let i = 0; i < 6; i++) {
    await ingestArticle(db, article(i, i === 5 ? { publishedAt: new Date(now - 25 * 3600000).toISOString() } : {}), now);
    const row = await db.prepare("SELECT seq,published_at FROM ip_articles WHERE id=?").bind(article(i).url).first<{ seq: number; published_at: number }>();
    for (const key of ["en:first chapter", "zh:第一章"]) await db.prepare("INSERT INTO ip_candidate_mentions (candidate_key,article_seq,published_at,source_id) VALUES (?,?,?,?)").bind(key, row!.seq, row!.published_at, article(i).sourceId).run();
  }
  assert.equal(await ingestArticle(db, article(0), now), false);
  await promoteCandidates(db, now); assert.equal((await readRegistry(db)).length, 0);
  await db.prepare("UPDATE ip_candidate_mentions SET published_at=? WHERE article_seq=6").bind(now - 1000).run();
  await promoteCandidates(db, now);
  const registry = await readRegistry(db); assert.equal(registry.length, 1); assert.equal(registry[0].id, ip.id);
  assert.ok(registry[0].aliases.includes("第一章")); assert.ok(registry[0].aliases.includes("Test Saga"));
  await promoteCandidates(db, now); assert.equal((await readRegistry(db)).length, 1);
  assert.equal((await rows(db, "SELECT * FROM ip_jobs WHERE kind='scan'", ["id"])).length, 1);
  sqlite.close();
});
test("high frequency from only one source never auto-promotes", async () => {
  const { db, sqlite } = database();
  await db.prepare("INSERT INTO ip_candidates (key,name,language,entity_id,evidence,status,first_seen,last_seen) VALUES ('term','term','en','Q999',?,'verified',?,?)").bind(JSON.stringify(evidence), now, now).run();
  for (let i = 0; i < 7; i++) { await ingestArticle(db, article(i), now); await db.prepare("INSERT INTO ip_candidate_mentions (candidate_key,article_seq,published_at,source_id) VALUES ('term',?,?,'one')").bind(i + 1, now - 100,).run(); }
  await promoteCandidates(db, now); assert.equal((await readRegistry(db)).length, 0); sqlite.close();
});
test("backward scan resumes in bounded pages, removes obsolete tags and rejects stale dictionary writes", async () => {
  const { db, sqlite } = database();
  for (let i = 0; i < 5; i++) await ingestArticle(db, article(i), now);
  await db.prepare("UPDATE ip_articles SET document=?,body='Only in the body: Test Saga',content_hash='body-only' WHERE seq=1").bind(JSON.stringify(article(0, { title: "A studio update", excerpt: "" }))).run();
  await saveFranchise(db, ip, "Q999", now);
  const first = await claimJob(db, "scan", now); assert.ok(first);
  assert.equal(await claimJob(db, "scan", now), null);
  await scanBatch(db, first!, now, 2);
  const second = await claimJob(db, "scan", now); assert.equal(second?.cursor, 2);
  await scanBatch(db, second!, now, 2); const third = await claimJob(db, "scan", now); await scanBatch(db, third!, now, 2);
  assert.equal((await archivedNews(db, ip.id)).total, 5);
  const proof = await db.prepare("SELECT evidence FROM ip_article_tags WHERE article_seq=1").first<{ evidence: string }>();
  assert.equal(JSON.parse(proof!.evidence).method, "body+title");
  await saveFranchise(db, { ...ip, aliases: ["Never Mentioned"] }, "Q999", now + 1000);
  await scanBatch(db, first!, now + 1000, 2); // obsolete version cannot add tags
  const updated = await claimJob(db, "scan", now + 1000); assert.equal(updated?.version, 2); await scanBatch(db, updated!, now + 1000);
  assert.equal((await archivedNews(db, ip.id)).total, 0); sqlite.close();
});
test("expired leases can be reclaimed, stale owners cannot move checkpoints; dynamic caches are version isolated", async () => {
  const { db, sqlite } = database(); await ingestArticle(db, article(0), now); await saveFranchise(db, ip, "Q999", now);
  const old = await claimJob(db, "scan", now); const current = await claimJob(db, "scan", now + 120001);
  assert.ok(current); assert.notEqual(old?.owner, current?.owner);
  await scanBatch(db, old!, now + 120002);
  assert.equal((await db.prepare("SELECT cursor FROM ip_jobs WHERE id=?").bind(old!.id).first<{ cursor: number }>())?.cursor, 0);
  await scanBatch(db, current!, now + 120003);
  const value = article(0); const game = { ...curatedGames[0], title: "Test Saga", originalTitle: "Test Saga", articleTitle: "Test Saga", names: {} };
  assert.equal(articleFranchises(value, [ip]).length, 1); assert.equal(articleFranchises(value, [{ ...ip, aliases: ["Other"] }]).length, 0);
  assert.equal(gameFranchises(game, [ip]).length, 1); assert.equal(gameFranchises(game, []).length, 0);
  assert.equal(articleFranchises({ ...value, ipIds: [] }, [ip]).length, 0, "archived tags are authoritative, no stale title fallback");
  sqlite.close();
});
test("title analysis creates durable deduplicated candidates and respects robots policy", async () => {
  const { db, sqlite } = database(); await ingestArticle(db, article(0), now);
  await runEngineJob(db, "analyze", now);
  const candidates = await rows<{ name: string }>(db, "SELECT name FROM ip_candidates", ["name"]); assert.ok(candidates.some((c) => c.name === "Test Saga"));
  assert.equal(robotsAllowed("User-agent: *\nDisallow: /\nAllow: /news/", "/news/game"), true);
  assert.equal(robotsAllowed("User-agent: *\nDisallow: /private", "/private/game"), false);
  assert.equal(robotsAllowed("User-agent: *\nDisallow: /\nUser-agent: ReleaseSignal\nAllow: /", "/news"), true);
  sqlite.close();
});
