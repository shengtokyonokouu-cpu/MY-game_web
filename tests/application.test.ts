import assert from "node:assert/strict";
import test from "node:test";
import { curatedGames, matchesQuery, mergeCatalog, migrateLibrary, releaseState, validateLibrary, averageScore, type CatalogGame } from "../app/lib/catalog.ts";
import { normalizePlatforms, parseAnnualFeed, parseDate } from "../app/lib/release-feed.ts";

test("release parser handles rowspans, publisher colspans and platform-specific ports", () => {
  const html = `<table class="wikitable"><tr><th>Release date</th><th>Title</th><th>Platform(s)</th><th>Type(s)</th><th>Genre(s)</th><th>Developer(s)</th><th>Publisher(s)</th></tr>
  <tr><td rowspan="2">September 4</td><td><i><a href="./Example_(video_game)">Example</a></i></td><td>WIN, NS2</td><td>Original</td><td>Action RPG</td><td colspan="2">Example Studio</td></tr>
  <tr><td><i><a href="./Other_game">Other game</a></i></td><td>NS, PS5, XBX/S</td><td>Original</td><td>Puzzle</td><td>Other Dev</td><td>Other Publisher</td></tr>
  <tr><td>November 8</td><td><i><a href="./Example_(video_game)">Example</a></i></td><td>PS5</td><td>Port</td><td>Action RPG</td><td colspan="2">Example Studio</td></tr></table>
  <table class="wikitable"><tr><th>Title</th><th>Approximate date</th><th>Platform(s)</th><th>Genre(s)</th></tr><tr><td><i>Future game</i></td><td>Q4</td><td>NS2</td><td>RPG</td></tr></table>`;
  const games = parseAnnualFeed(html, 2026, "2026-09-06");
  assert.equal(games.length, 3);
  const example = games.find((game) => game.title === "Example")!;
  assert.equal(example.releaseDate, "2026-09-04");
  assert.equal(example.publisher, "Example Studio");
  assert.deepEqual(example.platforms, ["PC", "Switch 2", "PS5"]);
  assert.deepEqual(example.genres, ["动作 RPG"]);
  assert.equal(example.releases?.length, 2);
  assert.equal(games[1].releaseDate, "2026-09-04");
  assert.equal(games[1].publisher, "Other Publisher");
  assert.equal(games[2].releaseDate, null);
  assert.equal(games[2].dateLabel, "2026 年 Q4");
  assert.equal(games[2].articleTitle, "", "Do not invent an encyclopedia page for an unlinked game");
});
test("invalid or approximate dates never become exact release dates", () => {
  assert.equal(parseDate("February 30", 2026), null);
  assert.equal(parseDate("February 29", 2024), "2024-02-29");
  assert.equal(parseDate("Q3", 2026), null);
  assert.deepEqual(normalizePlatforms("WIN, NS2, NS, PS5, XBX/S"), ["PC", "Switch 2", "Switch", "PS5", "Xbox"]);
  assert.equal(releaseState({ ...curatedGames[0], declaredStatus: "upcoming", releaseDate: "2026-09-01" }, "2026-09-06"), "check");
  assert.equal(releaseState({ ...curatedGames[0], declaredStatus: "check", releaseDate: null }), "check");
});
test("franchise links do not become a new game's cover or collapse separate games", () => {
  const html = `<table class="wikitable"><tr><th>Release date</th><th>Title</th></tr><tr><td>September 1</td><td><i><a href="./Example_series">Example</a> II</i></td></tr><tr><td>September 2</td><td><i><a href="./Example_series">Example</a> III</i></td></tr></table>`;
  const games = parseAnnualFeed(html, 2026, "2026-09-06");
  assert.equal(games.length, 2);
  assert.equal(games[0].articleTitle, "");
  assert.notEqual(games[0].id, games[1].id);
});
test("catalog identity is stable across refresh and unlinked games remain distinct", () => {
  const a = { ...curatedGames[0], id: "a", title: "One", originalTitle: "One", articleTitle: "" } as CatalogGame;
  const b = { ...a, id: "b", title: "Two", originalTitle: "Two" };
  assert.equal(mergeCatalog([a], [b]).length, 2);
  const duplicate = { ...a, id: "changed", image: "/covers/example.jpg" };
  const merged = mergeCatalog([a], [duplicate]);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, "a");
  assert.equal(mergeCatalog([a, duplicate], []).length, 1, "Duplicates in fresh feeds are deduplicated too");
});
test("localized online search results retain the original search query", () => {
  const game = { ...curatedGames[0], title: "女神异闻录", originalTitle: "女神异闻录", developer: "", publisher: "", searchTerms: ["Persona"] };
  assert.equal(matchesQuery(game, "Persona"), true);
  assert.equal(matchesQuery(game, "unknown game"), false);
});
test("old wishes, progress, personal ratings and notes migrate without invented ratings", () => {
  const [a, b] = curatedGames;
  const migrated = migrateLibrary(null, JSON.stringify({ wishlist: [a.id], shelf: { [b.id]: "playing" }, ratings: { [b.id]: { story: 8.2, music: 9 } }, notes: { [b.id]: "第三章" } }));
  assert.equal(migrated[a.id].status, "wishlist"); assert.deepEqual(migrated[a.id].scores, {});
  assert.equal(migrated[b.id].status, "playing"); assert.equal(migrated[b.id].notes, "第三章"); assert.equal(migrated[b.id].scores.story, 8.2);
  const restored = validateLibrary(JSON.parse(JSON.stringify({ version: 2, entries: migrated })));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(migrated))); assert.equal(averageScore({}), null); assert.equal(averageScore({ story: 8, music: 10 }), 9);
});
test("backup validation rejects malformed state before it can overwrite saved records", () => {
  const game = curatedGames[0]; const entry = { game, status: "wishlist", scores: {}, notes: "", updatedAt: "2026-09-06T00:00:00Z" };
  assert.throws(() => validateLibrary({ version: 2, entries: { [game.id]: { ...entry, scores: { story: 30 } } } }));
  assert.throws(() => validateLibrary({ version: 2, entries: { [game.id]: { ...entry, game: { ...game, releases: "bad" } } } }));
  assert.throws(() => validateLibrary({ version: 2, entries: { [game.id]: { ...entry, game: { ...game, searchTerms: [5] } } } }));
  assert.throws(() => validateLibrary({ version: 2, entries: { [game.id]: { ...entry, game: { ...game, source: { ...game.source, url: "javascript:alert(1)" } } } } }));
});
