import { upstreamHeaders } from "./release-feed";
import { mergeCatalog, curatedGames, type CatalogFeed } from "./catalog";
import { readPublicData } from "./public-data-server";
import snapshot from "../data/discovered.json";
import { gameArticle, trustedGamePage, type WikiArtworkData } from "./game-artwork";
import { findStoreArtwork } from "./store-artwork";
import { fetchNintendoDirect } from "./nintendo-feed";
export { searchGames, searchWikiGames } from "./multilingual-search";

import { cached } from "./http-cache";
export { cached } from "./http-cache";

export async function catalogResponse() {
  try { return Response.json(await readPublicData<CatalogFeed>("catalog.json"),{headers:{"Cache-Control":"public, max-age=900"}}); }
  catch { return Response.json({...snapshot,items:mergeCatalog(curatedGames,(snapshot as CatalogFeed).items),stale:true}); }
}
export async function nintendoGames() {
  const response = await cached("nintendo-latest", 1800, async () => Response.json(await fetchNintendoDirect()));
  return response.json() as Promise<import("./catalog").CatalogGame[]>;
}
export function allowedImageUrl(raw: string) {
  if (raw.length > 2048) return false;
  try { const url = new URL(raw); const hosts = ["upload.wikimedia.org", "shared.fastly.steamstatic.com", "shared.akamai.steamstatic.com", "cdn.akamai.steamstatic.com", "cdn.cloudflare.steamstatic.com", "cdn.steamstatic.com", "steamcdn-a.akamaihd.net", "www.nintendo.com", "www.gamecity.com.tw", "www.gamecity.ne.jp"]; return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname) && !/\.svg(?:$|\?)/i.test(url.pathname); } catch { return false; }
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
async function encyclopediaCover(title: string): Promise<string | null> {
  if (!gameArticle(title)) return null;
  const language = /[\u3040-\u30ff]/.test(title) ? "ja" : /[\u3400-\u9fff]/.test(title) ? "zh" : "en";
  const params = new URLSearchParams({ action: "query", titles: title, redirects: "1", prop: "pageimages", piprop: "thumbnail", pilicense: "any", pilimit: "1", pithumbsize: "640", format: "json", formatversion: "2" });
  const fallback = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(10000) });
  if (!fallback.ok) return null;
  const data = await fallback.json() as WikiArtworkData;
  const image = trustedGamePage(title, data)?.thumbnail?.source;
  return image && allowedImageUrl(image) ? image : null;
}
export async function resolveCover(title: string, name = ""): Promise<string | null> {
  try { const image = await encyclopediaCover(title); if (image) return image; } catch { /* Try an exact store match when the encyclopedia is unavailable. */ }
  const image = name ? await findStoreArtwork(name) : null;
  return image && allowedImageUrl(image) ? image : null;
}
