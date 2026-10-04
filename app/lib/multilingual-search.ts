import { gameArticle } from "./game-artwork.ts";
import { detectLanguage, type GameLanguage, type GameNames } from "./game-names.ts";
import { upstreamHeaders } from "./release-feed.ts";
import { claimIds, entityKind, type WikiEntity } from "./game-identity.ts";
import type { CatalogGame } from "./catalog.ts";

const storeLanguages = { zh: "schinese", ja: "japanese", en: "english" };
type StoreApp = { type?: string; name: string; header_image?: string; short_description?: string; developers?: string[]; publishers?: string[]; genres?: { description: string }[]; categories?: { id: number }[]; supported_languages?: string; release_date?: { coming_soon: boolean; date: string } };
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
    const categories = new Set(app.categories?.map(c => c.id));
    return { id: `steam-${id}`, entityKind: "game", modes: [...(categories.has(2) ? ["单人"] : []), ...(categories.has(1) ? ["多人"] : []), ...([9,38,39].some(c => categories.has(c)) ? ["合作"] : [])], ...(/简体中文|繁体中文|Simplified Chinese|Traditional Chinese/.test(app.supported_languages || "") ? { chineseSupport: { text: "商店标注中文支持", sourceUrl } } : {}), title: names.zh?.text || app.name, originalTitle: names.en?.text || app.name, names, articleTitle: "", image: app.header_image, developer: app.developers?.join(" / ") || "", publisher: app.publishers?.join(" / ") || "", country: "", region: "", platforms: ["PC"], genres: app.genres?.map((genre) => genre.description) || [], releaseDate, dateLabel: date || "日期待确认", declaredStatus: app.release_date ? app.release_date.coming_soon ? "upcoming" : "released" : "check", summary: (app.short_description || "").replace(/<[^>]+>/g, ""), source: { type: "store", label: "Steam · 中 / 日 / 英", url: sourceUrl, checkedAt: new Date().toISOString().slice(0, 10), evidence: "名称来自同一 Steam app ID 的三种商店语言设置；商店可能沿用原名，不代表游戏支持该语言。日期与平台仅代表 Steam 版本。" } };
  }));
  const games = results.filter((game): game is CatalogGame => game !== null);
  if (ids.length && !checkedDetails) throw new Error("Steam details timed out");
  return games;
}

export async function searchWikiGames(query: string, language: GameLanguage = detectLanguage(query)): Promise<CatalogGame[]> {
  const signal = AbortSignal.timeout(12000);
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: query, gsrnamespace: "0", gsrlimit: "12", prop: "extracts|pageimages|pageprops|langlinks", lllimit: "500", exintro: "1", explaintext: "1", exsentences: "2", piprop: "thumbnail", pilicense: "any", pilimit: "12", pithumbsize: "640", format: "json", formatversion: "2" });
  const data = await json(`https://${language}.wikipedia.org/w/api.php?${params}`, signal) as { query?: { pages?: { title: string; extract?: string; pageprops?: { wikibase_item?: string }; thumbnail?: { source: string }; langlinks?: { lang: string; title: string }[] }[] } };
  const pages = (data.query?.pages || []).filter(p => gameArticle(p.title) && /^Q\d+$/.test(p.pageprops?.wikibase_item || ""));
  if (!pages.length) return [];
  const getEntities = async (ids: string[]) => (await json(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "claims", format: "json" })}`, signal) as { entities: Record<string, WikiEntity> }).entities;
  const entities = await getEntities([...new Set(pages.map(p => p.pageprops!.wikibase_item!))]);
  const classes: Record<string, WikiEntity> = {};
  let pending = [...new Set(Object.values(entities).flatMap(e => claimIds(e, "P31")))];
  // Bounded ancestry traversal: uncertainty fails closed, never falls back to
  // substring/category guesses. One shared batch per level, not per result.
  for (let depth = 0; depth < 3 && pending.length; depth++) {
    const ids = pending.filter(id => id !== "Q7889" && !classes[id]).slice(0, 50);
    if (!ids.length) break;
    Object.assign(classes, await getEntities(ids));
    pending = [...new Set(ids.flatMap(id => claimIds(classes[id], "P279")))];
  }
  return pages.filter(page => entityKind(entities[page.pageprops!.wikibase_item!] || {}, classes) === "game").map((page) => {
    const sourceUrl = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`;
    const names: GameNames = { [language]: { text: page.title, sourceUrl, kind: "index" } };
    for (const link of page.langlinks || []) if (["zh", "ja", "en"].includes(link.lang) && gameArticle(link.title)) names[link.lang as GameLanguage] = { text: link.title, sourceUrl: `https://${link.lang}.wikipedia.org/wiki/${encodeURIComponent(link.title.replaceAll(" ", "_"))}`, kind: "index" };
    const entityId = page.pageprops!.wikibase_item!;
    return { id: `wd-${entityId.toLowerCase()}`, entityId, entityKind: "game", title: names.zh?.text || page.title, originalTitle: names.en?.text || page.title, names, articleTitle: page.title, image: page.thumbnail?.source, developer: "", publisher: "", country: "", region: "", platforms: [], genres: [], releaseDate: null, dateLabel: "日期待核验", declaredStatus: "check", summary: page.extract || "", source: { type: "index", label: `Wikipedia · ${language.toUpperCase()}`, url: sourceUrl, checkedAt: new Date().toISOString().slice(0, 10), evidence: `Wikidata ${entityId} 的 P31/P279 关系确认游戏类型；跨语言名称来自同一实体。百科译名不等于官方译名，发售日期与平台尚未核验。` } };
  });
}
