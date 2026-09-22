import { gameArticle } from "./game-artwork.ts";
import { detectLanguage, type GameLanguage, type GameNames } from "./game-names.ts";
import { stableId, upstreamHeaders } from "./release-feed.ts";
import type { CatalogGame } from "./catalog.ts";

const storeLanguages = { zh: "schinese", ja: "japanese", en: "english" };
type StoreApp = { type?: string; name: string; header_image?: string; short_description?: string; developers?: string[]; publishers?: string[]; genres?: { description: string }[]; release_date?: { coming_soon: boolean; date: string } };
async function json(url: string | URL, signal: AbortSignal) {
  const response = await fetch(url, { headers: upstreamHeaders, signal });
  if (!response.ok) throw new Error("Source unavailable"); return response.json();
}
export async function searchGames(query: string): Promise<CatalogGame[]> {
  const signal = AbortSignal.timeout(14000);
  const languages = [detectLanguage(query), ...(["zh", "ja", "en"] as const)].filter((language, i, all) => all.indexOf(language) === i);
  const searches = await Promise.allSettled(languages.map(async (language) => {
    const params = new URLSearchParams({ term: query, l: storeLanguages[language], cc: "us" });
    return (await json(`https://store.steampowered.com/api/storesearch/?${params}`, signal) as { items?: { id: number; name: string }[] }).items || [];
  }));
  if (searches.every((result) => result.status === "rejected")) throw new Error("Steam unavailable");
  const ids = [...new Set(searches.flatMap((result) => result.status === "fulfilled" ? result.value.map((item) => item.id) : []))].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 10);
  let checkedDetails = 0;
  const results = await Promise.all(ids.map(async (id): Promise<CatalogGame | null> => {
    const sourceUrl = `https://store.steampowered.com/app/${id}/`;
    const names: GameNames = {};
    // Store search already supplies locale-specific names for the same app ID.
    // Verify game type once instead of making 3 detail requests per result.
    searches.forEach((result, i) => {
      const item = result.status === "fulfilled" ? result.value.find((item) => item.id === id) : undefined;
      if (item?.name) names[languages[i]] = { text: item.name, kind: "store", sourceUrl: `${sourceUrl}?l=${storeLanguages[languages[i]]}` };
    });
    let app: StoreApp;
    try {
      const data = await json(`https://store.steampowered.com/api/appdetails?appids=${id}&l=schinese&cc=us`, signal) as Record<string, { success?: boolean; data?: StoreApp }> | null;
      if (!data || !data[id]) throw new Error("Steam details unavailable");
      checkedDetails++;
      if (data[id].data?.type !== "game") return null;
      app = data[id].data!;
      names.zh = { text: app.name, kind: "store", sourceUrl: `${sourceUrl}?l=schinese` };
    } catch { return null; }
    const date = app.release_date?.date || "";
    const match = date.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
    const candidate = match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
    const releaseDate = candidate && Number.isFinite(Date.parse(candidate)) && new Date(candidate).toISOString().slice(0, 10) === candidate ? candidate : null;
    return { id: `steam-${id}`, title: names.zh?.text || app.name, originalTitle: names.en?.text || app.name, names, articleTitle: "", image: app.header_image, developer: app.developers?.join(" / ") || "", publisher: app.publishers?.join(" / ") || "", country: "", region: "", platforms: ["PC"], genres: app.genres?.map((genre) => genre.description) || [], releaseDate, dateLabel: date || "日期待确认", declaredStatus: app.release_date ? app.release_date.coming_soon ? "upcoming" : "released" : "check", summary: (app.short_description || "").replace(/<[^>]+>/g, ""), source: { type: "store", label: "Steam · 中 / 日 / 英", url: sourceUrl, checkedAt: new Date().toISOString().slice(0, 10), evidence: "名称来自同一 Steam app ID 的三种商店语言设置；商店可能沿用原名，不代表游戏支持该语言。日期与平台仅代表 Steam 版本。" } };
  }));
  const games = results.filter((game): game is CatalogGame => game !== null);
  if (ids.length && !checkedDetails) throw new Error("Steam details timed out");
  return games;
}

export async function searchWikiGames(query: string, language: GameLanguage = detectLanguage(query)): Promise<CatalogGame[]> {
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: query, gsrnamespace: "0", gsrlimit: "12", prop: "extracts|pageimages|categories|langlinks", cllimit: "100", lllimit: "500", exintro: "1", explaintext: "1", exsentences: "2", piprop: "thumbnail", pilicense: "any", pilimit: "12", pithumbsize: "640", format: "json", formatversion: "2" });
  const data = await json(`https://${language}.wikipedia.org/w/api.php?${params}`, AbortSignal.timeout(11000)) as { query?: { pages?: { title: string; extract?: string; thumbnail?: { source: string }; categories?: { title: string }[]; langlinks?: { lang: string; title: string }[] }[] } };
  return (data.query?.pages || []).filter((page) => gameArticle(page.title) && !/公司|企業|一覧|シリーズ/.test(page.title) && page.categories?.some((category) => /\d{4}.*(?:video games|游戏|遊戲|コンピュータゲーム)|upcoming video games|発売予定の(?:コンピュータ)?ゲーム/i.test(category.title))).map((page) => {
    const sourceUrl = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`;
    const names: GameNames = { [language]: { text: page.title, sourceUrl, kind: "index" } };
    for (const link of page.langlinks || []) if (["zh", "ja", "en"].includes(link.lang) && gameArticle(link.title)) names[link.lang as GameLanguage] = { text: link.title, sourceUrl: `https://${link.lang}.wikipedia.org/wiki/${encodeURIComponent(link.title.replaceAll(" ", "_"))}`, kind: "index" };
    return { id: stableId(`${language}:${page.title}`), title: names.zh?.text || page.title, originalTitle: names.en?.text || page.title, names, articleTitle: page.title, image: page.thumbnail?.source, developer: "", publisher: "", country: "", region: "", platforms: [], genres: [], releaseDate: null, dateLabel: "日期待核验", declaredStatus: "check", summary: page.extract || "", source: { type: "index", label: `Wikipedia · ${language.toUpperCase()}`, url: sourceUrl, checkedAt: new Date().toISOString().slice(0, 10), evidence: "游戏分类与跨语言条目链接提供名称关联；百科译名不等于官方译名，发售日期与平台尚未核验。" } };
  });
}
