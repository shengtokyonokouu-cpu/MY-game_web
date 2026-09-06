import { cached, searchGames, searchWikiGames } from "../../lib/server-data";
import { mergeCatalog } from "../../lib/catalog";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 100) return Response.json({ error: "请输入 2–100 个字符", items: [] }, { status: 400 });
  return cached(`search-${query}`, 900, async () => {
    const results = await Promise.allSettled([searchGames(query), searchWikiGames(query)]);
    if (results.every((result) => result.status === "rejected")) return Response.json({ error: "搜索暂时不可用", items: [] }, { status: 503 });
    return Response.json({ items: results.reduce((all, result) => result.status === "fulfilled" ? mergeCatalog(all, result.value) : all, [] as import("../../lib/catalog").CatalogGame[]).map((game) => ({ ...game, searchTerms: [query] })) });
  });
}
