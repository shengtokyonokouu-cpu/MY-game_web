import { gameArticle, sameGameArticle, trustedGamePage, type WikiArtworkData } from "./game-artwork.ts";
import { mergeNames, type GameLanguage, type GameNames } from "./game-names.ts";
import { upstreamHeaders } from "./release-feed.ts";

type Entry = { title: string; originalTitle?: string; articleTitle: string; image?: string; names?: GameNames };
// Same-article language links, not fuzzy title translations. Batch both requested
// languages separately so a langlinks continuation cannot silently drop games.
export async function localizeCatalog(entries: Entry[], language: GameLanguage = "en") {
  const all = entries.filter((game) => gameArticle(game.articleTitle) && sameGameArticle(game.originalTitle || game.title, game.articleTitle));
  const tasks: { games: Entry[]; target: GameLanguage }[] = [];
  for (let i = 0; i < all.length; i += 40) for (const target of ["zh", "ja", "en"] as const) if (target !== language) tasks.push({ games: all.slice(i, i + 40), target });
  let completed = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (tasks.length) {
      const task = tasks.shift()!;
      try {
        const params = new URLSearchParams({ action: "query", titles: task.games.map((game) => game.articleTitle).join("|"), redirects: "1", prop: "pageimages|langlinks", piprop: "thumbnail", pilicense: "any", pilimit: "40", pithumbsize: "640", lllang: task.target, lllimit: "500", format: "json", formatversion: "2" });
        const response = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as WikiArtworkData;
        for (const game of task.games) {
          const page = trustedGamePage(game.articleTitle, data); if (!page) continue;
          const names: GameNames = { [language]: { text: page.title, sourceUrl: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`, kind: "index" } };
          for (const link of page.langlinks || []) if (link.lang === task.target && gameArticle(link.title)) names[task.target] = { text: link.title, sourceUrl: `https://${task.target}.wikipedia.org/wiki/${encodeURIComponent(link.title.replaceAll(" ", "_"))}`, kind: "index" };
          game.names = mergeNames(game.names, names);
          game.image ||= page.thumbnail?.source;
          game.title = game.names.zh?.text || game.title;
          if (game.originalTitle !== undefined) game.originalTitle = game.names.en?.text || game.originalTitle;
        }
      } catch (error) { console.log(`Name batch unavailable (${task.target}): ${String(error)}`); }
      completed++;
    }
  }));
  console.log(`Checked ${all.length} article identities in ${completed} language batches.`);
}
