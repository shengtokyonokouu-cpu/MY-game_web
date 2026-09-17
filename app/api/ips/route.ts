import { catalogResponse } from "../../lib/server-data";
import { currentNews } from "../../lib/news-service";
import { ipSummaries } from "../../lib/ip-hub";
import { suggestFranchises } from "../../lib/franchises";
import type { CatalogFeed } from "../../lib/catalog";
import type { NewsFeed } from "../../lib/news";
export async function GET(request: Request) {
  try {
    const [catalog, news] = await Promise.all([catalogResponse().then((r) => r.json() as Promise<CatalogFeed>), currentNews().catch((): NewsFeed => ({ items: [], sources: [], fetchedAt: new Date().toISOString(), stale: true }))]);
    const q = new URL(request.url).searchParams.get("q")?.slice(0, 120) || "";
    return Response.json({ items: ipSummaries(catalog.items, news), suggestions: q ? suggestFranchises(q, catalog.items) : [], fetchedAt: news.fetchedAt, stale: !!news.stale || !!catalog.stale }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch { return Response.json({ error: "IP 目录暂时不可用。" }, { status: 503 }); }
}
