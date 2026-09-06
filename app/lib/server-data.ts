import { fetchAnnualFeed, upstreamHeaders, stableId } from "./release-feed";
import { mergeCatalog, type CatalogFeed, type CatalogGame } from "./catalog";
import snapshot from "../data/discovered.json";

const pending = new Map<string, Promise<Response>>();
const localCache = new Map<string, { expires: number; response: Response }>();
// Edge cache is best-effort; the checked-in snapshot keeps first render independent of upstream uptime.
export async function cached(key: string, seconds: number, producer: () => Promise<Response>): Promise<Response> {
  const request = new Request(`https://release-signal.pages.dev/_cache/v4/${encodeURIComponent(key)}`);
  const edge = typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default?: Cache }).default;
  const hit = await edge?.match(request); if (hit) return new Response(hit.body, hit);
  const memory = localCache.get(key); if (memory && memory.expires > Date.now()) return memory.response.clone();
  if (pending.has(key)) return (await pending.get(key)!).clone();
  const operation = (async () => {
    const response = await producer();
    if (response.ok && !response.headers.get("Cache-Control")?.includes("no-store")) {
      const result = new Response(response.body, response); result.headers.set("Cache-Control", `public, max-age=${seconds}`);
      if (edge) await edge.put(request, result.clone()).catch(() => {});
      else { if (localCache.size > 60) localCache.delete(localCache.keys().next().value!); localCache.set(key, { expires: Date.now() + seconds * 1000, response: result.clone() }); }
      return result;
    }
    return response;
  })();
  pending.set(key, operation);
  try { return (await operation).clone(); } finally { pending.delete(key); }
}
export async function catalogResponse() {
  return cached(`catalog-${new Date().getUTCFullYear()}`, 1800, async () => {
    const year = new Date().getUTCFullYear();
    try {
      const fresh = await fetchAnnualFeed([year, year + 1]);
      // Retain old-year games for a usable back catalogue; fresh records win for the same identity.
      const items = mergeCatalog(fresh.items, (snapshot as CatalogFeed).items);
      return Response.json({ ...fresh, items });
    } catch {
      return Response.json({ ...snapshot, stale: true }, { headers: { "Cache-Control": "no-store" } });
    }
  });
}
export function allowedImageUrl(raw: string) {
  if (raw.length > 2048) return false;
  try { const url = new URL(raw); const hosts = ["upload.wikimedia.org", "shared.fastly.steamstatic.com", "shared.akamai.steamstatic.com", "cdn.akamai.steamstatic.com", "cdn.cloudflare.steamstatic.com", "cdn.steamstatic.com", "steamcdn-a.akamaihd.net"]; return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname) && !/\.svg(?:$|\?)/i.test(url.pathname); } catch { return false; }
}
export async function imageResponse(raw: string) {
  if (!allowedImageUrl(raw)) return new Response("Unsupported image source", { status: 400 });
  return cached(`image-${raw}`, 86400, async () => {
    const response = await fetch(raw, { headers: { "User-Agent": upstreamHeaders["User-Agent"] }, redirect: "manual", signal: AbortSignal.timeout(12000) });
    if (!response.ok) return new Response("Image unavailable", { status: 404 });
    const type = response.headers.get("Content-Type") || "";
    if (!/^image\/(jpeg|png|webp|avif|gif)(;|$)/i.test(type)) return new Response("Unsupported image type", { status: 415 });
    const reader = response.body?.getReader(); if (!reader) return new Response("Image unavailable", { status: 404 });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 5 * 1024 * 1024) { await reader.cancel(); return new Response("Image too large", { status: 413 }); } chunks.push(value); }
    const body = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return new Response(body, { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff" } });
  });
}
export async function resolveCover(title: string): Promise<string | null> {
  const language = /[\u3040-\u30ff]/.test(title) ? "ja" : /[\u3400-\u9fff]/.test(title) ? "zh" : "en";
  const response = await fetch(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(10000) });
  if (response.ok) { const page = await response.json() as { type?: string; thumbnail?: { source?: string } }; if (page.type !== "disambiguation" && page.thumbnail?.source && allowedImageUrl(page.thumbnail.source)) return page.thumbnail.source; }
  const params = new URLSearchParams({ action: "query", titles: title, redirects: "1", prop: "pageimages", piprop: "thumbnail", pilicense: "any", pilimit: "1", pithumbsize: "640", format: "json", formatversion: "2" });
  const fallback = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(10000) });
  if (!fallback.ok) return null;
  const data = await fallback.json() as { query?: { pages?: { thumbnail?: { source?: string } }[] } };
  const image = data.query?.pages?.[0]?.thumbnail?.source;
  return image && allowedImageUrl(image) ? image : null;
}

export async function searchGames(query: string): Promise<CatalogGame[]> {
  // Store results have app identities, so companies and non-game encyclopedia articles cannot become games.
  const search = new URL("https://store.steampowered.com/api/storesearch/"); search.search = new URLSearchParams({ term: query, l: "schinese", cc: "cn" }).toString();
  const response = await fetch(search, { headers: upstreamHeaders, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Store search unavailable");
  const data = await response.json() as { items?: { id: number; name: string; tiny_image: string }[] };
  const results: CatalogGame[] = []; const queue = [...(data.items || []).slice(0, 24)];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        const details = await fetch(`https://store.steampowered.com/api/appdetails?appids=${item.id}&l=schinese&cc=cn`, { headers: upstreamHeaders, signal: AbortSignal.timeout(7000) });
        if (!details.ok) continue;
        const app = (await details.json() as Record<string, { success: boolean; data?: { type?: string; name: string; header_image?: string; short_description?: string; developers?: string[]; publishers?: string[]; genres?: { description: string }[]; release_date?: { coming_soon: boolean; date: string } } }>)[item.id]?.data;
        if (!app || app.type !== "game") continue;
        const date = app.release_date?.date || "";
        const match = date.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
        const releaseDate = match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
        results.push({ id: `steam-${item.id}`, title: app.name, originalTitle: app.name, articleTitle: app.name, image: app.header_image || item.tiny_image, developer: app.developers?.join(" / ") || "", publisher: app.publishers?.join(" / ") || "", country: "", region: "", platforms: ["PC"], genres: app.genres?.map((genre) => genre.description) || [], releaseDate, dateLabel: date || "日期待确认", declaredStatus: app.release_date ? app.release_date.coming_soon ? "upcoming" : "released" : "check", summary: (app.short_description || "").replace(/<[^>]+>/g, ""), source: { type: "store", label: "Steam 商店", url: `https://store.steampowered.com/app/${item.id}/`, checkedAt: new Date().toISOString().slice(0, 10), evidence: "发行商维护的 Steam 商店资料；平台和日期仅代表 Steam 版本。" } });
      } catch { /* A missing detail entry must not suppress the other game results. */ }
    }
  }));
  if (results.length || !data.items?.length) return results;
  throw new Error("Store details unavailable");
}

export async function searchWikiGames(query: string): Promise<CatalogGame[]> {
  const language = /[\u3400-\u9fff]/.test(query) ? "zh" : "en";
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: `${query} ${language === "zh" ? "电子游戏" : "video game"}`, gsrlimit: "12", prop: "extracts|pageimages|categories", cllimit: "50", exintro: "1", explaintext: "1", exsentences: "2", piprop: "thumbnail", pilicense: "any", pilimit: "12", pithumbsize: "640", format: "json", formatversion: "2" });
  const response = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Search unavailable");
  const data = await response.json() as { query?: { pages?: { title: string; extract?: string; thumbnail?: { source: string }; categories?: { title: string }[] }[] } };
  return (data.query?.pages || []).filter((page) => !/^(List of|Category:)|列表|系列|公司/.test(page.title) && page.categories?.some((category) => /\d{4}.*(video games|年.*游戏)|upcoming video games/i.test(category.title))).map((page) => ({ id: stableId(`${language}:${page.title}`), title: page.title, originalTitle: page.title, articleTitle: page.title, image: page.thumbnail?.source, developer: "", publisher: "", country: "", region: "", platforms: [], genres: [], releaseDate: null, dateLabel: "日期待核验", declaredStatus: "check", summary: page.extract || "", source: { type: "index", label: "Wikipedia 资料页", url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`, checkedAt: new Date().toISOString().slice(0, 10), evidence: "在线检索到的游戏资料，发售日期与平台尚未核验。" } }));
}
