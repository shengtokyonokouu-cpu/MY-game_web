import { cached, allowedImageUrl } from "../../lib/server-data";
import { curatedGames, mergeCatalog, type CatalogFeed } from "../../lib/catalog";
import { findStoreNames } from "../../lib/store-names";
import snapshot from "../../data/discovered.json";

const catalog = mergeCatalog(curatedGames, (snapshot as CatalogFeed).items);
export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") || "").split(","))];
  if (!ids.length || ids.length > 3 || ids.some((id) => !id || id.length > 200)) return Response.json({ error: "一次最多查询 3 款已收录游戏" }, { status: 400 });
  const results = await Promise.all(ids.map(async (id) => {
    const game = catalog.find((item) => item.id === id);
    if (!game) return { id, state: "not-indexed" };
    try {
      const response = await cached(`names-${id}`, 3600, async () => {
        const result = await findStoreNames(game.names?.en?.text || game.originalTitle || game.title);
        return Response.json(result ? { id, names: result.names, image: result.image && allowedImageUrl(result.image) ? result.image : undefined, state: "ready" } : { id, state: "not-found" });
      });
      return await response.json();
    } catch { return { id, state: "unavailable" }; }
  }));
  return Response.json({ items: results }, { headers: { "Cache-Control": "no-store" } });
}
