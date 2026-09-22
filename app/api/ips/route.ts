import { readPublicData } from "../../lib/public-data-server";
import type { SeriesIndex } from "../../lib/series-types";
import { suggestFranchises } from "../../lib/franchises";
export async function GET(request: Request) {
  try {
    const index = await readPublicData<SeriesIndex>("index.json");
    const params = new URL(request.url).searchParams; const q = (params.get("q") || "").slice(0, 120);
    const offset = Number(params.get("cursor") || 0); const limit = Number(params.get("limit") || 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: "页码不正确" }, { status: 400 });
    const registry = index.items; const suggestions = q ? suggestFranchises(q, [], registry) : [];
    let items = q ? registry.filter((ip) => suggestFranchises(q, [], [ip]).length) : registry;
    const sort = params.get("sort") || "news"; const field = sort === "games" ? "gameCount" : sort === "updated" ? "updatedAt" : "newsCount";
    items = items.sort((a, b) => (b[field] || 0) - (a[field] || 0) || a.id.localeCompare(b.id));
    return Response.json({ items: items.slice(offset, offset + limit), total: items.length, nextCursor: offset + limit < items.length ? offset + limit : null, suggestions, stats:index.stats, updatedAt:index.updatedAt, mode:"offline-snapshot", coverage:index.coverage }, { headers: { "Cache-Control": "public, max-age=900" } });
  } catch (error) { console.error("Dynamic IP directory unavailable", error); return Response.json({ error: "动态 IP 目录暂时不可用，请重试。" }, { status: 503 }); }
}
