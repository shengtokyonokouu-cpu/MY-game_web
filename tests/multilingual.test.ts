import assert from "node:assert/strict";
import test from "node:test";
import { verifiedAnnouncements } from "../app/data/announcements.ts";
import { matchesQuery, mergeCatalog, stabilizeCatalogIds, validateLibrary } from "../app/lib/catalog.ts";
import { detectLanguage, namesFor, mergeNames } from "../app/lib/game-names.ts";
import { directDate, parseNintendoDirect } from "../app/lib/nintendo-feed.ts";
import { searchGames, searchWikiGames } from "../app/lib/multilingual-search.ts";
import { newsSources, parseNews } from "../app/lib/news.ts";
import { validateNewsFeed } from "../app/lib/news-cache.ts";
import { findStoreNames } from "../app/lib/store-names.ts";
const game = verifiedAnnouncements[0];
const now = new Date("2026-09-10T06:00:00Z");
const eventUrl = "https://www.nintendo.com/jp/nintendo-direct/20260909/index.html";

test("Chinese, Japanese, English, aliases and full-width input find the same game", () => {
  assert.equal(detectLanguage("薬屋のひとりごと"), "ja");
  for (const query of ["薬屋のひとりごと", "藥師少女的獨語", "药师少女的独语", "The Apothecary Diaries", "Ｔｈｅ Ａｐｏｔｈｅｃａｒｙ"]) {
    assert.ok(matchesQuery(game, query), query);
  }
  assert.equal(matchesQuery(game, "unrelated title"), false);
  assert.ok(matchesQuery(game, "昨天ns直面会", now));
  assert.ok(matchesQuery(game, "Nintendo Direct 2026.9.9", now));
  assert.ok(matchesQuery(game, "昨天NS直面会 薬屋のひとりごと", now));
  assert.equal(matchesQuery(game, "今天ns直面会", now), false);
  assert.equal(matchesQuery(game, "昨天ns直面会", new Date("2026-09-11T06:00:00Z")), false);
});
test("on-demand names require exact game identity and retain real localized names over store fallbacks", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [{ id: 1, name: "Example II" }] });
  try { assert.equal(await findStoreNames("Example III"), null); } finally { globalThis.fetch = original; }
  const name = { text: "测试游戏", sourceUrl: eventUrl, kind: "index" as const };
  assert.equal(mergeNames({ zh: name }, { zh: { ...name, text: "Test Game", kind: "store" } }).zh?.text, "测试游戏");
});
test("official Direct cards merge with trilingual identities, not the anime franchise", () => {
  const items = parseNintendoDirect({ row: [{ title: "薬屋のひとりごと <br>～偽りの皇弟～", maker: "コーエーテクモゲームス", thumb: "./assets/img/cover.png", platform: [{ platform_name: "Nintendo Switch 2", date: "2027年初頭" }], setTitle: [{ setTitle_title: "薬屋のひとりごと ～偽りの皇弟～", setTitle_platform: [{ platform_name: "Nintendo Switch", date: "2027年初頭" }] }] }, { title: "Example エキスパンションパス", platform: [{ platform_name: "Nintendo Switch", date: "2026年" }] }] }, eventUrl, now);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].platforms, ["Switch 2", "Switch"]);
  assert.equal(items[0].releaseDate, null);
  const merged = mergeCatalog([game], items);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, game.id);
  assert.equal(merged[0].names?.zh?.kind, "official");
  assert.equal(merged[0].events?.length, 1);
  assert.equal(stabilizeCatalogIds([{ ...game, id: "new-provider-id" }], [game])[0].id, game.id);
  assert.equal(namesFor({ ...items[0], title: "封神演義 逆命承天", originalTitle: "封神演義 逆命承天", names: { ja: { text: "封神演義 逆命承天", sourceUrl: eventUrl, kind: "official" } } }).zh, undefined);
  assert.equal(directDate("2027年初頭"), null);
  assert.equal(directDate("2027.2.30"), null);
  assert.equal(directDate("2027.1.1 ダウンロード / 2027.2.1 パッケージ"), null);
  assert.equal(directDate("2027.2.25（木）"), "2027-02-25");
  assert.throws(() => parseNintendoDirect({}, "https://evil.example/jp/nintendo-direct/20260909/index.html", now));
});
test("three-language metadata survives cloud backups and malformed names are rejected", () => {
  const entry = { game, status: "wishlist", scores: {}, notes: "想玩", updatedAt: now.toISOString() };
  const backup = { version: 2, entries: { [game.id]: entry } };
  assert.deepEqual(validateLibrary(JSON.parse(JSON.stringify(backup)))[game.id].game.names, game.names);
  assert.throws(() => validateLibrary({ ...backup, entries: { [game.id]: { ...entry, game: { ...game, names: { ja: { text: "bad", kind: "official", sourceUrl: "javascript:alert(1)" } } } } } }));
});
test("Steam uses one app identity across three languages and rejects non-game apps", async () => {
  const original = globalThis.fetch;
  const used = new Set<string>();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); const language = url.searchParams.get("l")!; used.add(language);
    if (url.pathname.includes("storesearch")) return Response.json({ items: [{ id: 1, name: { schinese: "测试游戏", japanese: "テストゲーム", english: "Test Game" }[language] }, { id: 2, name: "Test DLC" }] });
    const id = url.searchParams.get("appids")!;
    const name = { schinese: "测试游戏", japanese: "テストゲーム", english: "Test Game" }[language];
    return Response.json({ [id]: { data: { type: id === "1" ? "game" : "dlc", name, release_date: { coming_soon: true, date: "2027 年初" } } } });
  };
  try { const items = await searchGames("テスト"); assert.equal(items.length, 1); assert.equal(items[0].id, "steam-1"); assert.equal(items[0].names?.en?.text, "Test Game"); assert.equal(items[0].releaseDate, null); assert.equal(used.size, 3); }
  finally { globalThis.fetch = original; }
});
test("Japanese Wikipedia game categories and linked titles are recognized", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(String(input)).hostname, "ja.wikipedia.org");
    return Response.json({ query: { pages: [{ title: "テストゲーム", categories: [{ title: "Category:2027年のコンピュータゲーム" }], langlinks: [{ lang: "en", title: "Test Game" }, { lang: "zh", title: "测试游戏" }] }, { title: "薬屋のひとりごと", categories: [{ title: "Category:日本の小説" }] }] } });
  };
  try { const items = await searchWikiGames("テストゲーム"); assert.equal(items.length, 1); assert.equal(items[0].title, "测试游戏"); assert.equal(items[0].names?.ja?.text, "テストゲーム"); }
  finally { globalThis.fetch = original; }
});
test("Chinese/Japanese RSS and RDF dates work with the shared safe-origin cache", () => {
  assert.equal(newsSources.length, 8); assert.equal(new Set(newsSources.map((source) => source.language)).size, 3);
  const source = newsSources.find((source) => source.id === "4gamer")!;
  const items = parseNews(`<rdf:RDF xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>新作インタビュー</title><link>https://www.4gamer.net/games/example/</link><dc:date>2026-09-09T12:00:00+09:00</dc:date></item></rdf:RDF>`, source, now.getTime());
  assert.equal(items.length, 1); assert.equal(items[0].topic, "interview");
  assert.equal(validateNewsFeed({ items, fetchedAt: now.toISOString(), sources: [{ id: source.id, name: source.name, count: 1, ok: true }] }).items.length, 1);
});
