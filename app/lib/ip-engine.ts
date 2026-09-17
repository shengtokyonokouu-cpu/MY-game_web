import { hash, type Database, type Prepared } from "./auth.ts";
import { mentionsAlias, type Franchise } from "./franchises.ts";
import { extractEntities, normalizeEntity, resolveEntity, boundedText, type EntityEvidence } from "./ip-entities.ts";
import { batches, rows, stateStatement, stateValue, jobStatement, readRegistry, seedRegistry } from "./ip-repository.ts";
import { parseNews, type NewsArticle } from "./news.ts";
import { newsSources } from "./news-sources.ts";
import { parseHTML } from "linkedom";

export type Job = { id: string; kind: string; target: string; version: number; cursor: number; attempts: number; owner: string };
type StoredArticle = { seq: number; document: string; body: string; content_hash: string; body_status: string };
const articleColumns = ["seq", "document", "body", "content_hash", "body_status"];
const DAY = 86400000;
const languageCode = (value: string) => value === "中文" ? "zh" : value === "日文" ? "ja" : "en";
export async function claimJob(db: Database, kind: string, now = Date.now()): Promise<Job | null> {
  const owner = crypto.randomUUID();
  return db.prepare("UPDATE ip_jobs SET state='running',owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM ip_jobs WHERE kind=? AND ((state='pending' AND available_at<=?) OR (state='running' AND lease_until<?)) AND attempts<6 ORDER BY CASE WHEN kind='resolve' THEN (SELECT COUNT(*) FROM ip_candidate_mentions m WHERE m.candidate_key=ip_jobs.target AND m.published_at>=?) ELSE 0 END DESC,available_at,id LIMIT 1) RETURNING id,kind,target,version,cursor,attempts,owner")
    .bind(owner, now + 120000, now, kind, now, now, now - DAY).first<Job>();
}
async function finishJob(db: Database, job: Job, now: number, error?: unknown) {
  await db.prepare("UPDATE ip_jobs SET state=?,owner=NULL,lease_until=0,available_at=?,error=?,updated_at=? WHERE id=? AND owner=?")
    .bind(error ? job.attempts >= 6 ? "failed" : "pending" : "done", now + Math.min(3600000, 30000 * 2 ** job.attempts), error ? String(error).slice(0, 300) : null, now, job.id, job.owner).run();
}
function tagStatements(db: Database, row: StoredArticle, registry: Franchise[]) {
  const article = JSON.parse(row.document) as NewsArticle;
  const text = article.title + "\n" + row.body + "\n" + article.excerpt;
  const statements: Prepared[] = [];
  for (const ip of registry) {
    const alias = ip.aliases.find((a) => mentionsAlias(text, a));
    // Compare dictionary and article hashes at write time. Old scan leases must
    // not overwrite newer body analysis or a newer dictionary revision.
    const guard = "EXISTS (SELECT 1 FROM ip_registry WHERE id=? AND version=?) AND EXISTS (SELECT 1 FROM ip_articles WHERE seq=? AND content_hash=?)";
    if (alias) statements.push(db.prepare("INSERT INTO ip_article_tags (article_seq,ip_id,version,evidence) SELECT ?,?,?,? WHERE " + guard + " ON CONFLICT(article_seq,ip_id) DO UPDATE SET version=excluded.version,evidence=excluded.evidence WHERE ip_article_tags.version<=excluded.version")
      .bind(row.seq, ip.id, ip.version || 1, JSON.stringify({ alias, method: row.body ? "body+title" : "title+excerpt", source: ip.sourceUrl }), ip.id, ip.version || 1, row.seq, row.content_hash));
    else statements.push(db.prepare("DELETE FROM ip_article_tags WHERE article_seq=? AND ip_id=? AND version<=? AND " + guard).bind(row.seq, ip.id, ip.version || 1, ip.id, ip.version || 1, row.seq, row.content_hash));
  }
  return statements;
}
async function analyzeArticle(db: Database, row: StoredArticle, now: number) {
  const article = JSON.parse(row.document) as NewsArticle;
  const registry = await readRegistry(db);
  await batches(db, tagStatements(db, row, registry));
  const candidates = extractEntities(article.title, row.body);
  const statements: Prepared[] = [];
  for (const term of candidates) {
    // Even known child titles are verified: their P179 relation can teach new
    // multilingual aliases. Avoid spending resolution budget on exact known aliases.
    if (registry.some((ip) => ip.aliases.some((a) => normalizeEntity(a) === normalizeEntity(term)))) continue;
    const lang = languageCode(article.language); const key = lang + ":" + normalizeEntity(term);
    statements.push(db.prepare("INSERT INTO ip_candidates (key,name,language,first_seen,last_seen) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen)").bind(key, term, lang, now, now));
    statements.push(db.prepare("INSERT INTO ip_candidate_mentions (candidate_key,article_seq,published_at,source_id) VALUES (?,?,?,?) ON CONFLICT(candidate_key,article_seq) DO NOTHING").bind(key, row.seq, Date.parse(article.publishedAt), article.sourceId));
    statements.push(jobStatement(db, "resolve", key, now, 0, ":" + Math.floor(now / (7 * DAY))));
  }
  await batches(db, statements);
}
async function articleStatements(db: Database, article: NewsArticle, now: number) {
  const document = JSON.stringify({ ...article, ipIds: undefined });
  const revision = await hash(document); const contentHash = await hash(document + ":" + now);
  return [
    db.prepare("INSERT INTO ip_articles (id,document,content_hash,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,content_hash=excluded.content_hash,published_at=excluded.published_at,updated_at=excluded.updated_at WHERE ip_articles.document!=excluded.document")
      .bind(article.url, document, contentHash, Date.parse(article.publishedAt), now, now),
    db.prepare("INSERT INTO ip_jobs (id,kind,target,available_at,updated_at) SELECT 'body:'||seq||':0','body',CAST(seq AS TEXT),?,? FROM ip_articles WHERE id=? ON CONFLICT(id) DO NOTHING").bind(now, now, article.url),
    db.prepare("INSERT INTO ip_jobs (id,kind,target,available_at,updated_at) SELECT 'analyze:'||seq||':0:'||?,'analyze',CAST(seq AS TEXT),?,? FROM ip_articles WHERE id=? ON CONFLICT(id) DO NOTHING").bind(revision, now, now, article.url),
  ];
}
export async function ingestArticle(db: Database, article: NewsArticle, now = Date.now()) {
  const previous = await db.prepare("SELECT document FROM ip_articles WHERE id=?").bind(article.url).first<{ document: string }>();
  // Archive + both jobs are one transaction. Re-fetches can repair a missing
  // job without inflating candidate frequency or rewriting unchanged articles.
  await db.batch(await articleStatements(db, article, now));
  return previous?.document !== JSON.stringify({ ...article, ipIds: undefined });
}
export async function ingestArticles(db: Database, articles: NewsArticle[], now = Date.now()) {
  // Ten articles / 30 statements per transaction; a feed is a few D1 calls,
  // not 60+ subrequests. Any partial failure is safe to replay.
  for (let i = 0; i < articles.length; i += 10) {
    const groups = await Promise.all(articles.slice(i, i + 10).map((a) => articleStatements(db, a, now)));
    await db.batch(groups.flat());
  }
}
export async function saveFranchise(db: Database, ip: Franchise, entityId: string | null, now = Date.now()) {
  const old = await db.prepare("SELECT document,version FROM ip_registry WHERE id=?").bind(ip.id).first<{ document: string; version: number }>();
  const clean = { id: ip.id, name: ip.name, ja: ip.ja, en: ip.en, description: ip.description, aliases: [...new Set(ip.aliases)].sort(), color: ip.color, sourceUrl: ip.sourceUrl, evidence: ip.evidence || [] };
  const document = JSON.stringify(clean);
  if (old?.document === document) return false;
  const semantic = (value: typeof clean) => JSON.stringify({ ...value, evidence: value.evidence.map((item) => { const proof = { ...item as EntityEvidence }; delete (proof as Partial<EntityEvidence>).checkedAt; return proof; }) });
  if (old) {
    const previous = JSON.parse(old.document) as typeof clean;
    if (semantic({ ...previous, evidence: previous.evidence || [] }) === semantic(clean)) {
      await db.prepare("UPDATE ip_registry SET document=? WHERE id=? AND version=?").bind(document, ip.id, old.version).run();
      return false;
    }
  }
  const version = (old?.version || 0) + 1;
  await db.batch([
    db.prepare("INSERT INTO ip_registry (id,entity_id,document,version,promoted_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET entity_id=COALESCE(excluded.entity_id,ip_registry.entity_id),document=excluded.document,version=excluded.version,updated_at=excluded.updated_at WHERE ip_registry.version=?")
      .bind(ip.id, entityId, document, version, now, now, old?.version || 0),
    jobStatement(db, "scan", ip.id, now, version),
  ]);
  return true;
}
export async function promoteCandidates(db: Database, now = Date.now()) {
  // Distinct URLs across ALL aliases of the same canonical series. A re-fetch,
  // translated alias, or two mentions in one article contributes only once.
  const eligible = await rows<{ entity_id: string; articles: number; sources: number }>(db,
    "SELECT c.entity_id,COUNT(DISTINCT m.article_seq) AS articles,COUNT(DISTINCT m.source_id) AS sources FROM ip_candidates c JOIN ip_candidate_mentions m ON m.candidate_key=c.key WHERE c.status='verified' AND m.published_at>=? AND m.published_at<=? GROUP BY c.entity_id HAVING COUNT(DISTINCT m.article_seq)>=6 AND COUNT(DISTINCT m.source_id)>=2 LIMIT 10",
    ["entity_id", "articles", "sources"], [now - DAY, now]);
  const registry = await readRegistry(db);
  // Verified aliases of already-active IPs are installed without requiring a
  // fresh popularity spike; this is dictionary enrichment, not a new channel.
  const active = await rows<{ entity_id: string }>(db, "SELECT DISTINCT c.entity_id FROM ip_candidates c JOIN ip_registry r ON c.entity_id=r.entity_id WHERE c.status='verified'", ["entity_id"]);
  for (const entityId of new Set([...eligible, ...active].map((e) => e.entity_id))) {
    const evidenceRows = await rows<{ key: string; evidence: string }>(db, "SELECT key,evidence FROM ip_candidates WHERE entity_id=? AND status IN ('verified','promoted') ORDER BY key", ["key", "evidence"], [entityId]);
    const evidence = evidenceRows.map((r) => JSON.parse(r.evidence) as EntityEvidence); if (!evidence.length) continue;
    const canonical = evidence[0];
    const existing = registry.find((ip) => ip.entityId === entityId) || registry.find((ip) => !ip.entityId && canonical.aliases.some((a) => ip.aliases.some((b) => normalizeEntity(a) === normalizeEntity(b))));
    const ip: Franchise = {
      id: existing?.id || "wd-" + entityId.toLowerCase(), name: existing?.name || canonical.names.zh || canonical.names.ja || canonical.names.en,
      ja: canonical.names.ja || existing?.ja || "", en: canonical.names.en || existing?.en || "", color: existing?.color || "blue",
      description: existing?.description || "由资讯实体识别建立；名称与系列归属来自 Wikidata 公共知识库，不代表官方发售确认。",
      aliases: [...(existing?.aliases || []), ...evidence.flatMap((e) => [...e.aliases, ...e.matchedAliases])],
      sourceUrl: existing?.sourceUrl || canonical.sourceUrl, evidence,
    };
    await saveFranchise(db, ip, entityId, now);
    await db.prepare("UPDATE ip_candidates SET status='promoted' WHERE entity_id=? AND status='verified'").bind(entityId).run();
  }
}
export async function scanBatch(db: Database, job: Job, now = Date.now(), size = 20) {
  const record = await db.prepare("SELECT document,version FROM ip_registry WHERE id=?").bind(job.target).first<{ document: string; version: number }>();
  if (!record || record.version !== job.version) { await finishJob(db, job, now); return; }
  const page = await rows<StoredArticle>(db, "SELECT * FROM ip_articles WHERE seq>? ORDER BY seq LIMIT ?", articleColumns, [job.cursor, size]);
  const ip = { ...JSON.parse(record.document), version: record.version } as Franchise;
  const guard = db.prepare("UPDATE ip_jobs SET cursor=?,state=?,owner=NULL,lease_until=0,attempts=0,updated_at=? WHERE id=? AND owner=? AND lease_until>?")
    .bind(page.at(-1)?.seq || job.cursor, page.length < size ? "done" : "pending", now, job.id, job.owner, now);
  // A stale worker may write the same idempotent tags but cannot advance a new
  // owner's cursor. Page writes and checkpoint commit together.
  await db.batch([...page.flatMap((row) => tagStatements(db, row, [ip])), guard]);
}
function plain(html: string) {
  const { document } = parseHTML("<html><body>" + html + "</body></html>");
  document.querySelectorAll("script,style,nav,header,footer,aside,noscript,form").forEach((n) => n.remove());
  const target = document.querySelector("article") || document.querySelector("main") || document.querySelector('[itemprop="articleBody"]');
  return (target?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32000);
}
export function robotsAllowed(text: string, path: string) {
  let agents: string[] = []; let rules: { agents: string[]; allow: boolean; path: string }[] = []; let sawRule = false;
  for (const line of text.split(/\r?\n/)) {
    const [name, ...parts] = line.replace(/#.*$/, "").split(":"); const value = parts.join(":").trim(); const field = name.trim().toLowerCase();
    if (field === "user-agent") { if (sawRule) { agents = []; sawRule = false; } agents.push(value.toLowerCase()); }
    else if (["allow", "disallow"].includes(field) && value) { rules.push({ agents: [...agents], allow: field === "allow", path: value }); sawRule = true; }
  }
  const specific = rules.some((r) => r.agents.some((a) => a === "releasesignal"));
  rules = rules.filter((r) => r.agents.includes(specific ? "releasesignal" : "*"));
  const matching = rules.filter((r) => { const pattern = r.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"); return new RegExp("^" + pattern).test(path); }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}
async function fetchBody(db: Database, row: StoredArticle, now: number) {
  const article = JSON.parse(row.document) as NewsArticle;
  const source = newsSources.find((s) => s.id === article.sourceId); const target = new URL(article.url);
  if (!source || target.origin !== new URL(source.site).origin || target.protocol !== "https:" || target.username || target.password) throw new Error("Article origin rejected");
  let robots = await stateValue<{ text: string; at: number }>(db, "robots:" + target.origin);
  const get = (url: string) => fetch(url, { redirect: "manual", headers: { "User-Agent": "ReleaseSignal/3.0 (+https://release-signal.pages.dev)" }, signal: AbortSignal.timeout(10000) });
  if (!robots || now - robots.at > DAY) {
    const response = await get(target.origin + "/robots.txt");
    if (!response.ok && response.status !== 404) throw new Error("Robots unavailable " + response.status);
    robots = { text: response.status === 404 ? "" : await boundedText(response, 200000), at: now }; await stateStatement(db, "robots:" + target.origin, robots, now).run();
  }
  if (!robotsAllowed(robots.text, target.pathname + target.search)) return { body: "", status: "blocked" };
  // Redirects are not followed: a publisher cannot turn body extraction into SSRF.
  const response = await get(target.href);
  if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) throw new Error("Body unavailable " + response.status);
  const body = plain(await boundedText(response, 1_000_000));
  if (body.length < 80) throw new Error("No readable article body");
  return { body, status: "complete" };
}
async function processJob(db: Database, job: Job, now: number) {
  if (job.kind === "scan") { await scanBatch(db, job, now); return; }
  if (job.kind === "feed") {
    const source = newsSources.find((s) => s.id === job.target); if (!source) throw new Error("Unknown source");
    try {
      let target = new URL(source.url);
      let response = await fetch(target, { redirect: "manual", headers: { "User-Agent": "ReleaseSignal/3.0 (+https://release-signal.pages.dev)" }, signal: AbortSignal.timeout(12000) });
      for (let i = 0; i < 2 && response.status >= 300 && response.status < 400; i++) {
        const redirect = new URL(response.headers.get("Location") || "", target);
        if (redirect.origin !== new URL(source.url).origin || redirect.username || redirect.password) throw new Error("Feed redirect rejected");
        await response.body?.cancel(); target = redirect;
        response = await fetch(target, { redirect: "manual", headers: { "User-Agent": "ReleaseSignal/3.0 (+https://release-signal.pages.dev)" }, signal: AbortSignal.timeout(12000) });
      }
      if (!response.ok) throw new Error("Feed HTTP " + response.status);
      const items = parseNews(await boundedText(response, 2_000_000), source, now);
      if (!items.length) throw new Error("No valid feed entries");
      // Bounded fanout. Each item is idempotent; partial ingestion can retry.
      await ingestArticles(db, items, now);
      await stateStatement(db, "source:" + source.id, { ok: true, count: items.length }, now).run();
    } catch (error) { await stateStatement(db, "source:" + source.id, { ok: false, count: 0 }, now).run(); throw error; }
  } else if (job.kind === "body" || job.kind === "analyze") {
    const row = await db.prepare("SELECT * FROM ip_articles WHERE seq=?").bind(Number(job.target)).first<StoredArticle>();
    if (row) {
      if (job.kind === "body" && row.body_status === "pending") {
        const result = await fetchBody(db, row, now); row.body = result.body; row.body_status = result.status;
        const article = JSON.parse(row.document) as NewsArticle; row.content_hash = await hash(article.title + "\n" + article.excerpt + "\n" + row.body);
        await db.prepare("UPDATE ip_articles SET body=?,body_status=?,content_hash=?,updated_at=? WHERE seq=?").bind(row.body, row.body_status, row.content_hash, now, row.seq).run();
      }
      await analyzeArticle(db, row, now);
    }
  } else if (job.kind === "resolve") {
    const candidate = await db.prepare("SELECT name,language FROM ip_candidates WHERE key=?").bind(job.target).first<{ name: string; language: string }>();
    if (candidate) {
      const resolved = await resolveEntity(candidate.name, candidate.language, undefined, now);
      await db.prepare("UPDATE ip_candidates SET status=?,entity_id=?,evidence=? WHERE key=?")
        .bind(resolved ? "verified" : "unresolved", resolved?.entityId || null, resolved ? JSON.stringify(resolved) : null, job.target).run();
      if (resolved) {
        const registry = await readRegistry(db);
        const seed = registry.filter((ip) => !ip.entityId && resolved.aliases.some((a) => ip.aliases.some((b) => normalizeEntity(a) === normalizeEntity(b))));
        if (seed.length === 1) await db.prepare("UPDATE ip_registry SET entity_id=? WHERE id=? AND entity_id IS NULL").bind(resolved.entityId, seed[0].id).run();
        await promoteCandidates(db, now);
      }
    }
  }
  await finishJob(db, job, now);
}
export async function runEngineJob(db: Database, kind: string, now = Date.now()) {
  if (kind === "promote") { await promoteCandidates(db, now); return true; }
  const job = await claimJob(db, kind, now); if (!job) return false;
  try { await processJob(db, job, now); }
  catch (error) { console.error("IP job failed", job.kind, job.id, String(error)); await finishJob(db, job, Date.now(), error); }
  return true;
}
export async function scheduleEngine(db: Database, now = Date.now()) {
  if (!await stateValue(db, "initialized")) { await seedRegistry(db, now); await stateStatement(db, "initialized", true, now).run(); }
  const tick = Math.floor(now / 60000); const window = Math.floor(now / (15 * 60000));
  await db.batch([
    ...newsSources.map((s) => jobStatement(db, "feed", s.id, now, 0, ":" + window)),
    stateStatement(db, "heartbeat", { at: now }, now),
    // Expired final attempts become visible dead letters, not invisible running jobs.
    db.prepare("UPDATE ip_jobs SET state='failed',error='Lease expired after final attempt',owner=NULL WHERE state='running' AND lease_until<? AND attempts>=6").bind(now),
    db.prepare("DELETE FROM ip_jobs WHERE state='done' AND kind!='scan' AND updated_at<?").bind(now - 14 * DAY),
    db.prepare("UPDATE ip_jobs SET state='pending',attempts=0,available_at=?,updated_at=? WHERE state='failed' AND updated_at<?").bind(now, now, now - DAY),
  ]);
  // Retry unresolved entities and refresh learned aliases weekly, using bounded
  // keyset pages. Archived articles survive; only job bookkeeping is pruned.
  if (tick % 15 === 0) {
    const refresh = await stateValue<{ cursor: string; week: number }>(db, "refresh") || { cursor: "", week: Math.floor(now / (7 * DAY)) };
    const week = Math.floor(now / (7 * DAY)); const cursor = refresh.week === week ? refresh.cursor : "";
    const page = await rows<{ key: string }>(db, "SELECT key FROM ip_candidates WHERE key>? ORDER BY key LIMIT 25", ["key"], [cursor]);
    await db.batch([...page.map((c) => jobStatement(db, "resolve", c.key, now, 0, ":" + week)), stateStatement(db, "refresh", { cursor: page.at(-1)?.key || cursor, week }, now)]);
  }
}
