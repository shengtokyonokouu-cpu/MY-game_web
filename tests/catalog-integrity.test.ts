import assert from "node:assert/strict";
import test from "node:test";
import { games, signals, SNAPSHOT_DATE } from "../app/data/games.ts";

test("every catalog entry has a unique id and traceable primary source", () => {
  assert.equal(new Set(games.map((game) => game.id)).size, games.length);

  for (const game of games) {
    assert.ok(game.title.trim(), `${game.id}: title is required`);
    assert.ok(game.source.url.startsWith("https://"), `${game.id}: source must be HTTPS`);
    assert.equal(game.source.checkedAt, SNAPSHOT_DATE, `${game.id}: source check date is stale`);
    assert.ok(game.source.evidence.length >= 18, `${game.id}: evidence note is too short`);
    assert.ok(game.platforms.length > 0, `${game.id}: at least one platform is required`);
    for (const value of Object.values(game.scores)) {
      assert.ok(value >= 1 && value <= 10, `${game.id}: score ${value} is outside 1–10`);
    }
  }
});

test("release status agrees with the verified snapshot date", () => {
  for (const game of games) {
    if (game.status === "development") {
      assert.equal(game.releaseDate, null, `${game.id}: undated projects must not invent a date`);
      continue;
    }

    assert.ok(game.releaseDate, `${game.id}: dated status requires a release date`);
    if (game.status === "released") {
      assert.ok(game.releaseDate! <= SNAPSHOT_DATE, `${game.id}: released date is after snapshot`);
    } else {
      assert.ok(game.releaseDate! > SNAPSHOT_DATE, `${game.id}: upcoming date is not after snapshot`);
    }
  }
});

test("intelligence updates are dated and source-linked", () => {
  assert.ok(signals.length >= 4);
  for (const signal of signals) {
    assert.match(signal.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(signal.sourceUrl.startsWith("https://"));
    assert.ok(signal.detail.length >= 20);
  }
});
