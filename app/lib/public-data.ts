// Public snapshots only. No token, private library or account data ever leaves
// the origin. External refreshes do not consume Cloudflare D1/Worker quotas.
export const PUBLIC_DATA_BASE = "https://raw.githubusercontent.com/shengtokyonokouu-cpu/MY-game_web/refs/heads/codex/catalog-data/v1/";
export async function publicData<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!/^[a-z0-9/-]+\.json$/.test(path) || path.includes("..")) throw new Error("Invalid snapshot path");
  const targets = [PUBLIC_DATA_BASE + path, "/data/" + path];
  for (const target of targets) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      const response = await fetch(target, { credentials: "omit", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000) });
      if (!response.ok) continue;
      return await response.json() as T;
    } catch { /* Last published Pages snapshot is the independent fallback. */ }
  }
  throw new Error("Public snapshot unavailable");
}
