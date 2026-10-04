// Only timer metadata lives here; article data and job leases remain in D1.
export interface ClockStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export const CLOCK_INTERVAL = 60_000;

export async function armClock(storage: ClockStorage, now = Date.now()) {
  await storage.put("enabled", true);
  // Repeated maintenance calls must not postpone an existing alarm.
  if (await storage.getAlarm() === null) await storage.setAlarm(now + CLOCK_INTERVAL);
  return { enabled: true, nextAt: await storage.getAlarm() };
}
export async function pauseClock(storage: ClockStorage) {
  await storage.put("enabled", false);
  await storage.deleteAlarm();
}
export async function runClock(storage: ClockStorage, cycle: () => Promise<void>, now = Date.now) {
  if (!await storage.get<boolean>("enabled")) return null;
  const startedAt = now();
  // Persist the next wake-up BEFORE network work. A killed invocation must not
  // exhaust native retries and silently leave the engine without a timer.
  await storage.setAlarm(startedAt + CLOCK_INTERVAL);
  let ok = false;
  try { await cycle(); ok = true; }
  catch (error) { console.error("IP clock cycle failed", String(error)); }
  finally {
    if (await storage.get<boolean>("enabled")) {
      await storage.setAlarm(Math.max(startedAt + CLOCK_INTERVAL, now() + 1000));
    }
  }
  const result = { startedAt, finishedAt: now(), ok };
  await storage.put("lastRun", result);
  return result;
}
export async function runCycle(schedule: () => Promise<void>, run: (kind: string) => Promise<boolean>) {
  await schedule();
  const rounds = [["feed", "scan"], ["analyze", "body"], ["analyze", "resolve"], ["analyze", "resolve"], ["analyze", "resolve"], ["analyze", "body"]];
  for (const round of rounds) {
    // Settle the sibling before ending a failed cycle; do not orphan an RPC.
    const results = await Promise.allSettled(round.map(run));
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  await run("promote");
}
