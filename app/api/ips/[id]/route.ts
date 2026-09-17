import { catalogResponse } from "../../../lib/server-data";
import { currentNews } from "../../../lib/news-service";
import { buildIPHub } from "../../../lib/ip-hub";
import { categoryLabels, franchiseById, type NewsCategory } from "../../../lib/franchises";
import type { CatalogFeed } from "../../../lib/catalog";
import type { NewsFeed } from "../../../lib/news";
export async function GET(request: Request) {
  const url = new URL(request.url); const id = url.pathname.split("/").at(-1) || "";
  if (!franchiseById(id)) return Response.json({ error: "没有这个 IP 频道。" }, { status: 404 });
  const category = url.searchParams.get("category") || "latest"; const page = Number(url.searchParams.get("page") || "1");
  if (!Object.hasOwn(categoryLabels, category) || !Number.isSafeInteger(page) || page < 1) return Response.json({ error: "分类或页码不正确。" }, { status: 400 });
  try {
    const [catalog, news] = await Promise.all([catalogResponse().then((r) => r.json() as Promise<CatalogFeed>), currentNews().catch((): NewsFeed => ({ items: [], sources: [], fetchedAt: new Date().toISOString(), stale: true }))]);
    return Response.json({ ...buildIPHub(id, catalog.items, news, { category: category as NewsCategory, page, platform: url.searchParams.get("platform") || "all", q: (url.searchParams.get("q") || "").slice(0, 120) }), catalogStale: !!catalog.stale }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) { console.error("IP hub response failed", error); return Response.json({ error: "频道资料暂时不可用。" }, { status: 503 }); }
}
