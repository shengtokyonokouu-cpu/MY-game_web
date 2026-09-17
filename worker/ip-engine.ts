import { WorkerEntrypoint } from "cloudflare:workers";
import type { Database } from "../app/lib/auth";
import { runEngineJob, scheduleEngine } from "../app/lib/ip-engine";
type Env = { DB: Database; ENGINE: { run(kind: string): Promise<boolean> } };
// No public mutation endpoint, API key, paid queue, or user/browser needed.
// Service-bound entrypoints keep each bounded job in its own invocation.
export class IPEngine extends WorkerEntrypoint<Env> {
  async run(kind: string) {
    if (!["feed", "body", "analyze", "resolve", "scan", "promote"].includes(kind)) throw new Error("Invalid job");
    return runEngineJob(this.env.DB, kind);
  }
}
export default {
  async scheduled(_event: unknown, env: Env) {
    await scheduleEngine(env.DB);
    // At most two jobs in flight. Empty queues return immediately.
    const rounds = [["feed", "scan"], ["analyze", "body"], ["analyze", "resolve"], ["analyze", "resolve"], ["analyze", "resolve"], ["analyze", "body"]];
    for (const round of rounds) await Promise.all(round.map((kind) => env.ENGINE.run(kind)));
    await env.ENGINE.run("promote");
  },
  fetch() { return new Response("Not found", { status: 404 }); },
};
