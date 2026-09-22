import { cached, searchGames, searchWikiGames, nintendoGames } from "../../lib/server-data";
import { curatedGames, matchesQuery, mergeCatalog, type CatalogGame, type CatalogFeed } from "../../lib/catalog";
import snapshot from "../../data/discovered.json";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 100) return Response.json({ error: "请输入 2–100 个字符", items: [] }, { status: 400 });
  // Relative event queries change at midnight in China, not when the CDN expires.
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return cached(`search-${day}-${query}`, 300, async () => {
    const eventQuery = /直面[会會]|ダイレクト|nintendo\s*direct/i.test(query);
    const providers: { name: string; run: () => Promise<CatalogGame[]> }[] = [{ name: "Nintendo Direct · 官方目录", run: nintendoGames }];
    if (!eventQuery) providers.push({ name: "Steam · 中 / 日 / 英", run: () => searchGames(query) }, ...(["zh", "ja", "en"] as const).map((language) => ({ name: `Wikipedia · ${language.toUpperCase()}`, run: () => searchWikiGames(query, language) })));
    const results = await Promise.allSettled(providers.map((provider) => provider.run()));
    const local = mergeCatalog(curatedGames, (snapshot as CatalogFeed).items).filter((game) => matchesQuery(game, query));
    // A provider can match full-text or regional variants absent from its title.
    // Keep that query as a search hint, never as an identity/official name.
    const hits = results.map((result, i) => result.status === "fulfilled" ? (i === 0 ? result.value.filter((game) => matchesQuery(game, query)) : result.value.map((game) => ({ ...game, searchTerms: [...new Set([...(game.searchTerms || []), query])] }))) : []);
    const items = hits.reduce((all, games) => mergeCatalog(all, games), local);
    return Response.json({ items, partial: results.some((result) => result.status === "rejected"), sources: results.map((result, i) => ({ name: providers[i].name, ok: result.status === "fulfilled", count: hits[i].length })) });
  });
}
