import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { authenticate, handleAuth, hash, token, type AppEnv, type Database, type Prepared } from "../app/lib/auth.ts";
import { handleLibrary } from "../app/lib/library-api.ts";
import { curatedGames, type Library } from "../app/lib/catalog.ts";
import { decodeAccountCache, encodeAccountCache, mergeThreeWay } from "../app/lib/sync.ts";
import { newsSources, parseNews } from "../app/lib/news.ts";
import { validateNewsFeed } from "../app/lib/news-cache.ts";

function database(): Database {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
  return { prepare(sql: string): Prepared {
    let values: (string | number | null)[] = []; const statement = sqlite.prepare(sql);
    const prepared = { bind(...next: unknown[]) { values = next as typeof values; return prepared; }, async first<T>() { return (statement.get(...values) || null) as T | null; }, async run() { return statement.run(...values); } }; return prepared;
  }, async batch(statements) { sqlite.exec("BEGIN"); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
}
const site = "https://release-signal.pages.dev";
const game = curatedGames[0];
const entry = { game, status: "playing" as const, scores: { story: 8 }, notes: "chapter 2", updatedAt: "2026-09-06T00:00:00.000Z" };
test("unresolved rating and deletion conflicts survive reload without becoming silent uploads", () => {
  const remote = { [game.id]: { ...entry, scores: { story: 10 } } };
  for (const local of [{ [game.id]: { ...entry, scores: { story: 6 } } }, {}]) {
    const merged = mergeThreeWay({ [game.id]: entry }, local, remote);
    assert.equal(merged.conflicts.length, 1);
    const restored = decodeAccountCache(encodeAccountCache({ version: 4, entries: remote }, merged.entries, merged.conflicts));
    assert.equal(restored.base.version, 4);
    assert.deepEqual(restored.conflicts, merged.conflicts);
    assert.deepEqual(restored.entries, local);
  }
  assert.throws(() => decodeAccountCache(JSON.stringify({ base: { version: -1, entries: {} }, entries: {} })));
  assert.throws(() => decodeAccountCache(JSON.stringify({ base: { version: 1, entries: {} }, entries: {}, conflictIds: ["missing"] })));
});
test("news caches reject missing source metadata, invalid dates and unrelated links", () => {
  const source = newsSources[0];
  const items = parseNews(`<rss><channel><item><title>New game</title><link>${source.site}/2026/09/09/new-game/</link><pubDate>Wed, 09 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>`, source, Date.parse("2026-09-09T10:00:00Z"));
  const feed = { items, fetchedAt: "2026-09-09T10:00:00Z", sources: [{ id: source.id, name: source.name, ok: true, count: 1 }] };
  assert.deepEqual(validateNewsFeed(feed), feed);
  assert.throws(() => validateNewsFeed({ items: [] }));
  assert.throws(() => validateNewsFeed({ ...feed, fetchedAt: "yesterday" }));
  assert.throws(() => validateNewsFeed({ ...feed, items: [{ ...items[0], url: "https://unrelated.example/article" }] }));
});
async function user(env: AppEnv, id: string) {
  const raw = token(); const now = Date.now();
  await env.DB!.batch([
    env.DB!.prepare("INSERT INTO users (id, login, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, id, id, now, now),
    env.DB!.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await hash(raw), id, now + 60000),
    env.DB!.prepare("INSERT INTO libraries (user_id, document, version, updated_at) VALUES (?, '{}', 0, ?)").bind(id, now),
  ]);
  return { Cookie: `__Host-release-session=${raw}`, Origin: site, "Content-Type": "application/json", "X-CSRF-Token": await hash(`csrf:${raw}`) };
}
test("cloud library enforces authentication, CSRF, account ownership and optimistic concurrency", async () => {
  const env = { DB: database(), PUBLIC_ORIGIN: site }; const a = await user(env, "github:a"); const b = await user(env, "github:b");
  assert.equal((await handleLibrary(new Request(`${site}/api/library`), env)).status, 401);
  const body = JSON.stringify({ version: 0, entries: { [game.id]: entry }, owner: "github:b" });
  assert.equal((await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: { ...a, Origin: "https://evil.test" }, body }), env)).status, 403);
  assert.equal((await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: { ...a, "X-CSRF-Token": "wrong" }, body }), env)).status, 403);
  const saved = await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: a, body }), env); assert.equal(saved.status, 200); assert.equal(saved.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await saved.json()).version, 1);
  const other = await (await handleLibrary(new Request(`${site}/api/library`, { headers: b }), env)).json(); assert.deepEqual(other.entries, {}, "owner in request body must never override authenticated identity");
  assert.equal((await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: a, body }), env)).status, 409);
  assert.equal((await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: { ...a, "Content-Length": "2000001" }, body }), env)).status, 413);
  const remove = await handleLibrary(new Request(`${site}/api/library`, { method: "PUT", headers: a, body: JSON.stringify({ version: 1, entries: {} }) }), env); assert.equal(remove.status, 200);
  const removed = await (await handleLibrary(new Request(`${site}/api/library`, { headers: a }), env)).json(); assert.equal(removed.version, 2); assert.deepEqual(removed.entries, {});
  assert.equal((await handleAuth(new Request(`${site}/api/auth/logout`, { method: "POST", headers: a }), env)).status, 200);
  assert.equal(await authenticate(new Request(`${site}/api/library`, { headers: a }), env), null);
});
test("OAuth uses PKCE, browser-bound one-time state, secure cookies and minimum permissions", async () => {
  const env: AppEnv = { DB: database(), PUBLIC_ORIGIN: site, GITHUB_CLIENT_ID: "test-client", GITHUB_CLIENT_SECRET: "test-secret" };
  const start = await handleAuth(new Request(`${site}/api/auth/login`), env); assert.equal(start.status, 302);
  const target = new URL(start.headers.get("Location")!); const state = target.searchParams.get("state")!;
  assert.equal(target.searchParams.get("scope"), ""); assert.equal(target.searchParams.get("code_challenge_method"), "S256"); assert.equal(target.searchParams.get("redirect_uri"), `${site}/api/auth/callback`);
  assert.match(start.headers.get("Set-Cookie")!, /HttpOnly; Secure; SameSite=Lax/);
  const wrong = await handleAuth(new Request(`${site}/api/auth/callback?code=test&state=${state}`, { headers: { Cookie: "__Host-release-oauth=wrong" } }), env); assert.match(wrong.headers.get("Location")!, /auth_error/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("access_token")) { const sent = JSON.parse(init!.body as string); assert.equal(await hash(sent.code_verifier), target.searchParams.get("code_challenge")); return Response.json({ access_token: "transient-test-token" }); }
    return Response.json({ id: 123, login: "test-user", name: "Test User" });
  };
  try {
    const callback = new Request(`${site}/api/auth/callback?code=test&state=${state}`, { headers: { Cookie: `__Host-release-oauth=${state}` } });
    const done = await handleAuth(callback, env); assert.match(done.headers.get("Location")!, /signed_in/);
    const session = done.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-release-session="))!;
    assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
    const identity = await authenticate(new Request(`${site}/api/auth/me`, { headers: { Cookie: session.split(";")[0] } }), env); assert.equal(identity?.user.id, "github:123");
    const replay = await handleAuth(callback, env); assert.match(replay.headers.get("Location")!, /auth_error/);
  } finally { globalThis.fetch = originalFetch; }
});
test("three-way sync preserves unrelated edits, honors deletion and exposes same-game conflicts", () => {
  const base: Library = { [game.id]: entry }; const other = { ...entry, game: curatedGames[1] };
  const remote: Library = { ...base, [other.game.id]: other };
  const local: Library = { [game.id]: { ...entry, notes: "chapter 3" } };
  const merged = mergeThreeWay(base, local, remote); assert.equal(merged.conflicts.length, 0); assert.equal(merged.entries[game.id].notes, "chapter 3"); assert.ok(merged.entries[other.game.id]);
  const conflict = mergeThreeWay(base, local, {}); assert.equal(conflict.conflicts.length, 1); assert.equal(conflict.conflicts[0].remote, null);
  assert.deepEqual(mergeThreeWay(base, base, {}).entries, {}, "an unchanged stale device must not resurrect cloud deletions");
  assert.deepEqual(mergeThreeWay(base, {}, base).entries, {}, "local deletion must be applied to the cloud");
});
test("news parser keeps real dates and source URLs and rejects injected links/future items", () => {
  const xml = `<rss><channel><item><title><![CDATA[Game interview &amp; news]]></title><link>https://blog.playstation.com/2026/09/05/game/?utm_source=rss</link><pubDate>Sat, 05 Sep 2026 06:00:00 GMT</pubDate><description><![CDATA[<p>Real excerpt</p><script>alert(1)</script>]]></description></item><item><title>Fake link</title><link>javascript:alert(1)</link><pubDate>Sat, 05 Sep 2026 06:00:00 GMT</pubDate></item><item><title>Future</title><link>https://blog.playstation.com/future/</link><pubDate>Sat, 05 Sep 2037 06:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseNews(xml, newsSources[0], Date.parse("2026-09-06")); assert.equal(items.length, 1); assert.equal(items[0].topic, "interview"); assert.equal(items[0].excerpt, "Real excerpt"); assert.equal(items[0].publishedAt, "2026-09-05T06:00:00.000Z"); assert.equal(items[0].url, "https://blog.playstation.com/2026/09/05/game/");
});
test("desktop native dialogs explicitly center despite CSS reset, with mobile override", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.detail-dialog\{position:fixed;inset:0;margin:auto;/);
  assert.match(css, /\.detail-dialog\{width:100%;max-height:100dvh;height:100dvh;max-width:100%;margin:0;/);
});
