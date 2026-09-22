import { PUBLIC_DATA_BASE } from "./public-data";
import { cached } from "./http-cache";
export async function readPublicData<T>(path: string): Promise<T> {
  if (!/^[a-z0-9/-]+\.json$/.test(path) || path.includes("..")) throw new Error("Invalid snapshot path");
  const response = await cached("snapshot-v1-" + path, 900, async () => {
    try { const r = await fetch(PUBLIC_DATA_BASE + path, { signal: AbortSignal.timeout(12000) }); if (r.ok) return Response.json(await r.json()); } catch { /* Fall back to the deployed asset, not D1 or a live crawl. */ }
    const { env } = await import("cloudflare:workers");
    const assets = (env as unknown as { ASSETS?: { fetch(request: Request): Promise<Response> } }).ASSETS;
    const r = assets ? await assets.fetch(new Request("https://release-signal.pages.dev/data/" + path)) : await fetch("https://release-signal.pages.dev/data/" + path, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("Public snapshot unavailable");
    return Response.json(await r.json());
  });
  return response.json() as Promise<T>;
}
