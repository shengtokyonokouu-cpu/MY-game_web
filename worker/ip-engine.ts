import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type { Database } from "../app/lib/auth";
import { runEngineJob, scheduleEngine } from "../app/lib/ip-engine";
import { armClock, pauseClock, runClock, runCycle } from "./ip-clock";
type Env = {
  DB: Database;
  ENGINE: { run(kind: string): Promise<boolean>; startScheduler(): Promise<unknown> };
  CLOCK: { getByName(name: string): { start(): Promise<unknown>; pause(): Promise<void>; status(): Promise<unknown> } };
};
// No public mutation endpoint, API key, paid queue, or user/browser needed.
// Service-bound entrypoints keep each bounded job in its own invocation.
export class IPEngine extends WorkerEntrypoint<Env> {
  async startScheduler() { return this.env.CLOCK.getByName("primary").start(); }
  async pauseScheduler() { return this.env.CLOCK.getByName("primary").pause(); }
  async schedulerStatus() { return this.env.CLOCK.getByName("primary").status(); }
  async run(kind: string) {
    if (!["feed", "body", "analyze", "resolve", "scan", "promote"].includes(kind)) throw new Error("Invalid job");
    return runEngineJob(this.env.DB, kind);
  }
}
// One named object, no public URL and no per-user objects. Alarms survive
// deployments; crawling still uses separately bounded service invocations.
export class IPEngineClock extends DurableObject<Env> {
  start() { return this.ctx.blockConcurrencyWhile(() => armClock(this.ctx.storage)); }
  pause() { return this.ctx.blockConcurrencyWhile(() => pauseClock(this.ctx.storage)); }
  async status() {
    return { enabled: !!await this.ctx.storage.get("enabled"), nextAt: await this.ctx.storage.getAlarm(), lastRun: await this.ctx.storage.get("lastRun") || null };
  }
  async alarm() {
    const result = await runClock(this.ctx.storage, () => runCycle(() => scheduleEngine(this.env.DB), (kind) => this.env.ENGINE.run(kind)));
    if (result) console.log("IP automatic alarm completed", result);
  }
}
export default {
  async scheduled(_event: unknown, env: Env) {
    // Maintenance only arms the PRODUCTION object through RPC. It does not
    // crawl, drain jobs, or write a heartbeat; the future alarm does that.
    await env.ENGINE.startScheduler();
  },
  fetch() { return new Response("Not found", { status: 404 }); },
};
