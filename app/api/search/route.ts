import { cached, searchGames, searchWikiGames, nintendoGames } from "../../lib/server-data";
import { curatedGames, matchesQuery, mergeCatalog, type CatalogGame, type CatalogFeed } from "../../lib/catalog";
import snapshot from "../../data/discovered.json";
import { canRecordGame, searchRank } from "../../lib/game-identity";
import { indexedGames } from "../../lib/indexed-search";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 100) return Response.json({ error: "请输入 2–100 个字符", items: [] }, { status: 400 });
  // Relative event queries change at midnight in China, not when the CDN expires.
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return cached(`search-entities-v2-${day}-${query}`, 300, async () => {
    const eventQuery = /直面[会會]|ダイレクト|nintendo\s*direct/i.test(query);
    const providers: { name: string; run: () => Promise<CatalogGame[]> }[] = [{ name: "Nintendo Direct · 官方目录", run: nintendoGames }, { name: "系列作品索引 · 实体关系", run: () => indexedGames(query) }];
    if (!eventQuery) providers.push({ name: "Steam · 中 / 日 / 英", run: () => searchGames(query) }, ...(["zh", "ja", "en"] as const).map((language) => ({ name: `Wikipedia · ${language.toUpperCase()}`, run: () => searchWikiGames(query, language) })));
    const results = await Promise.allSettled(providers.map((provider) => provider.run()));
    const local = mergeCatalog(curatedGames, (snapshot as CatalogFeed).items).filter((game) => matchesQuery(game, query));
    // Never attach the user's query as an alias to a full-text provider hit.
    const hits = results.map(result => result.status === "fulfilled" ? result.value.filter(game => canRecordGame(game) && matchesQuery(game, query)) : []);
    const items = hits.reduce((all, games) => mergeCatalog(all, games), local).filter(canRecordGame).sort((a,b) => searchRank(b, query) - searchRank(a, query));
    return Response.json({ items, partial: results.some((result) => result.status === "rejected"), sources: results.map((result, i) => ({ name: providers[i].name, ok: result.status === "fulfilled", count: hits[i].length })) });
  });
}
