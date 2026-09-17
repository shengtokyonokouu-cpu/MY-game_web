import { catalogResponse } from "../../../lib/server-data";
import { environment } from "../../../lib/database";
import { archivedNews, readRegistry } from "../../../lib/ip-repository";
import { buildIPHub } from "../../../lib/ip-hub";
import { categoryLabels, type NewsCategory } from "../../../lib/franchises";
import type { CatalogFeed } from "../../../lib/catalog";
export async function GET(request: Request) {
  const url = new URL(request.url); const id = url.pathname.split("/").at(-1) || "";
  const category = url.searchParams.get("category") || "latest"; const page = Number(url.searchParams.get("page") || "1");
  if (!Object.hasOwn(categoryLabels, category) || !Number.isSafeInteger(page) || page < 1) return Response.json({ error: "分类或页码不正确。" }, { status: 400 });
  try {
    const { DB } = await environment(); if (!DB) throw new Error("D1 unavailable");
    const registry = await readRegistry(DB, true); if (!registry.some((ip) => ip.id === id)) return Response.json({ error: "没有这个 IP 频道。" }, { status: 404 });
    const [catalog, news] = await Promise.all([catalogResponse().then((r) => r.json() as Promise<CatalogFeed>), archivedNews(DB, id)]);
    return Response.json({ ...buildIPHub(id, catalog.items, news, { category: category as NewsCategory, page, platform: url.searchParams.get("platform") || "all", q: (url.searchParams.get("q") || "").slice(0, 120) }, registry), archiveTotal: news.total, catalogStale: !!catalog.stale }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) { console.error("IP hub response failed", error); return Response.json({ error: "频道资料暂时不可用。" }, { status: 503 }); }
}
