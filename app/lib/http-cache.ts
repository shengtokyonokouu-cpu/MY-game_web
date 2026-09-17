type CachedBody = { bytes: ArrayBuffer; status: number; statusText: string; headers: [string, string][] };
const pending = new Map<string, Promise<CachedBody>>();
const local = new Map<string, { expires: number; value: CachedBody }>();
let localBytes = 0;
function response(value: CachedBody) { return new Response(value.bytes.slice(0), { status: value.status, statusText: value.statusText, headers: value.headers }); }

// Cloudflare request contexts cannot share live Response/ReadableStream objects.
// Fully materialize the producer's body inside its originating request; share
// only plain bytes/headers and construct a new response for every consumer.
export async function cached(key: string, seconds: number, producer: () => Promise<Response>): Promise<Response> {
  const request = new Request(`https://release-signal.pages.dev/_cache/v7/${encodeURIComponent(key)}`);
  const edge = typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default?: Cache }).default;
  const hit = await edge?.match(request); if (hit) return new Response(hit.body, hit);
  const memory = local.get(key); if (memory && memory.expires > Date.now()) return response(memory.value);
  const current = pending.get(key); if (current) return response(await current);
  const operation = (async (): Promise<CachedBody> => {
    const result = await producer(); const headers = new Headers(result.headers);
    const cacheable = result.ok && !headers.get("Cache-Control")?.includes("no-store");
    if (cacheable) headers.set("Cache-Control", `public, max-age=${seconds}`);
    const value: CachedBody = { bytes: await result.arrayBuffer(), status: result.status, statusText: result.statusText, headers: [...headers.entries()] };
    if (cacheable) {
      if (edge) await edge.put(request, response(value)).catch(() => {});
      else {
        if (local.has(key)) { localBytes -= local.get(key)!.value.bytes.byteLength; local.delete(key); }
        while (local.size && (local.size >= 60 || localBytes + value.bytes.byteLength > 16 * 1024 * 1024)) { const oldest = local.keys().next().value!; localBytes -= local.get(oldest)!.value.bytes.byteLength; local.delete(oldest); }
        if (value.bytes.byteLength <= 16 * 1024 * 1024) { local.set(key, { expires: Date.now() + seconds * 1000, value }); localBytes += value.bytes.byteLength; }
      }
    }
    return value;
  })();
  pending.set(key, operation);
  try { return response(await operation); } finally { if (pending.get(key) === operation) pending.delete(key); }
}
