import assert from "node:assert/strict";
import test from "node:test";
import { armClock, pauseClock, runClock, runCycle, CLOCK_INTERVAL, type ClockStorage } from "../worker/ip-clock.ts";
function storage() {
  const values = new Map<string, unknown>(); let alarm: number | null = null;
  const store: ClockStorage = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async put(key, value) { values.set(key, value); },
    async getAlarm() { return alarm; }, async setAlarm(at) { alarm = at; }, async deleteAlarm() { alarm = null; },
  };
  return store;
}
test("arming is idempotent and does not perform manual crawl work", async () => {
  const store = storage();
  assert.deepEqual(await armClock(store, 1000), { enabled: true, nextAt: 1000 + CLOCK_INTERVAL });
  assert.equal((await armClock(store, 5000)).nextAt, 1000 + CLOCK_INTERVAL);
  assert.equal(await store.get("lastRun"), undefined);
});
test("automatic cycles persist the next alarm first and retain cadence after success", async () => {
  const store = storage(); await armClock(store, 0); let now = 60000;
  const result = await runClock(store, async () => {
    assert.equal(await store.getAlarm(), 120000); now += 12000;
  }, () => now);
  assert.deepEqual(result, { startedAt: 60000, finishedAt: 72000, ok: true });
  assert.equal(await store.getAlarm(), 120000);
});
test("failed or slow cycles retain future wakeups; pausing during a cycle stays paused", async () => {
  const store = storage(); await armClock(store, 0); let now = 60000;
  const original = console.error; console.error = () => {};
  try {
    const result = await runClock(store, async () => { now = 150000; throw new Error("upstream unavailable"); }, () => now);
    assert.equal(result?.ok, false); assert.equal(await store.getAlarm(), 151000);
  } finally { console.error = original; }
  await runClock(store, async () => { await pauseClock(store); }, () => 200000);
  assert.equal(await store.getAlarm(), null);
  let ran = false; assert.equal(await runClock(store, async () => { ran = true; }), null); assert.equal(ran, false);
});
test("job cycles cap concurrency at two and settle siblings before returning errors", async () => {
  let active = 0; let max = 0; const seen: string[] = [];
  await runCycle(async () => { seen.push("schedule"); }, async (kind) => {
    seen.push(kind); active++; max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 1)); active--; return true;
  });
  assert.equal(max, 2); assert.equal(active, 0); assert.equal(seen[0], "schedule"); assert.equal(seen.at(-1), "promote");
  assert.equal(seen.length, 14);
  let siblingFinished = false;
  await assert.rejects(runCycle(async () => {}, async (kind) => {
    if (kind === "feed") throw new Error("D1 unavailable");
    await new Promise((resolve) => setTimeout(resolve, 2)); siblingFinished = true; return true;
  }), /D1 unavailable/);
  assert.equal(siblingFinished, true);
});
