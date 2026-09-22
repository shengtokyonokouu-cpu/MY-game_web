// Run only through authenticated Wrangler remote dev. Never exposes an HTTP
// admin API, and never executes crawl jobs or changes the engine heartbeat.
type Env = { ENGINE: {
  startScheduler(): Promise<unknown>;
  pauseScheduler(): Promise<unknown>;
  schedulerStatus(): Promise<unknown>;
} };
export default {
  async scheduled(event: { cron: string }, env: Env) {
    if (event.cron === "start") await env.ENGINE.startScheduler();
    else if (event.cron === "pause") await env.ENGINE.pauseScheduler();
    else if (event.cron !== "status") throw new Error("Use cron=start, status or pause");
    console.log("IP scheduler status", await env.ENGINE.schedulerStatus());
  },
  fetch() { return new Response("Not found", { status: 404 }); },
};
