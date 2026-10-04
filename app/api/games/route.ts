import { curatedGames, mergeCatalog, type CatalogFeed } from "../../lib/catalog";
import { canRecordGame } from "../../lib/game-identity";
import { indexedGames } from "../../lib/indexed-search";
import { readPublicData } from "../../lib/public-data-server";
import { searchGames, searchWikiGames } from "../../lib/multilingual-search";
import { detectLanguage } from "../../lib/game-names";
import { cached } from "../../lib/http-cache";
import { verifiedWorkFacts } from "../../lib/verified-work-facts";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams, id = p.get("id") || "", title = (p.get("title") || "").slice(0, 200);
  if (!/^[a-z0-9-]{1,100}$/.test(id)) return Response.json({ error: "游戏标识无效" }, { status: 400 });
  return cached(`game-v3-${id}-${title}`, 300, async () => {
    try {
      const catalog = await readPublicData<CatalogFeed>("catalog.json");
      let game = mergeCatalog(curatedGames, catalog.items).find(g => g.id === id);
      if (!game) game = (await indexedGames("", id)).find(g => g.id === id);
      if (!game && title) {
        const items = id.startsWith("steam-") ? await searchGames(title) : await searchWikiGames(title, ["zh", "ja", "en"].includes(p.get("lang") || "") ? p.get("lang") as "zh" | "ja" | "en" : detectLanguage(title));
        game = items.find(g => g.id === id);
      }
      if (!game || !canRecordGame(game)) return Response.json({ error: "未能核验这个游戏链接，请返回搜索重试。" }, { status: 404 });
      return Response.json({ game:verifiedWorkFacts(game) });
    } catch (error) { console.warn("Public game lookup failed:", error instanceof Error ? error.message : "snapshot unavailable"); return Response.json({ error: "游戏来源暂时无法连接，链接已保留，请重试。" }, { status: 503 }); }
  });
}
