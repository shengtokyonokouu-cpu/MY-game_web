import { cached } from "../../lib/server-data";
import { upstreamHeaders } from "../../lib/release-feed";
import { gameArticle, sameGameArticle } from "../../lib/game-artwork";
export async function GET(request: Request) {
  const url = new URL(request.url); const title = url.searchParams.get("title")?.trim() || ""; const lang = url.searchParams.get("lang") === "zh" ? "zh" : "en";
  if (!gameArticle(title) || title.length > 200) return Response.json({ error: "Invalid title" }, { status: 400 });
  try { return await cached(`details-${lang}-${title}`, 3600, async () => {
    const response = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return Response.json({ error: "Details unavailable" }, { status: 404 });
    const page = await response.json() as { title?: string; extract?: string; type?: string; content_urls?: { desktop?: { page?: string } } };
    if (page.type === "disambiguation" || !sameGameArticle(title, page.title || "")) return Response.json({ error: "Ambiguous title" }, { status: 404 });
    return Response.json({ summary: page.extract || "", sourceUrl: page.content_urls?.desktop?.page || "" });
  }); } catch { return Response.json({ error: "Details unavailable" }, { status: 502 }); }
}
