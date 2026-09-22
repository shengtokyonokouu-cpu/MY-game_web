import type { CatalogGame } from "./catalog.ts";
import { identityNames, searchTokensMatch } from "./game-names.ts";
import type { NewsArticle } from "./news.ts";

export type Franchise = { id: string; name: string; ja: string; en: string; description: string; aliases: string[]; sourceUrl: string; color: string; entityId?: string; version?: number; promotedAt?: number; updatedAt?: number; newsCount?: number; followerCount?: number; recentCount?: number; previousCount?: number; rising?: boolean; discovered?: boolean; evidence?: unknown[]; gameCount?: number; originalCount?: number; parentIds?: string[]; childIds?: string[]; firstYear?: number; lastYear?: number; platforms?: string[]; coverage?: string; searchAliases?: string[]; latestNewsAt?: string };
// Editorial taxonomy, not game identity. A mention may associate several IPs;
// it never merges games, certifies a release, or invents a localized title.
export const franchises: Franchise[] = [
  { id: "zelda", name: "塞尔达系列", ja: "ゼルダの伝説", en: "The Legend of Zelda", description: "汇集塞尔达作品、冒险新动向与相关报道。", aliases: ["塞尔达", "薩爾達", "萨尔达", "ゼルダ", "Zelda", "王国之泪", "王國之淚", "Tears of the Kingdom", "ティアーズ オブ ザ キングダム", "TotK", "旷野之息", "曠野之息", "Breath of the Wild", "ブレス オブ ザ ワイルド", "BotW", "Hyrule Warriors", "海拉鲁全明星", "海拉魯全明星"], sourceUrl: "https://www.nintendo.com/jp/character/zelda/index.html", color: "green" },
  { id: "pokemon", name: "宝可梦系列", ja: "ポケットモンスター", en: "Pokémon", description: "宝可梦主系列及衍生游戏的资讯与发售追踪。", aliases: ["宝可梦", "寶可夢", "精灵宝可梦", "口袋妖怪", "ポケモン", "ポケットモンスター", "Pokémon", "Pokemon", "Pokopia", "Pokkén", "Pokken", "名探偵ピカチュウ", "Detective Pikachu"], sourceUrl: "https://www.pokemon.co.jp/game/", color: "amber" },
  { id: "trails", name: "轨迹系列", ja: "軌跡シリーズ", en: "Trails", description: "围绕轨迹系列的世界、新作与跨平台发售消息。", aliases: ["轨迹系列", "軌跡シリーズ", "空之轨迹", "空之軌跡", "空の軌跡", "零之轨迹", "零之軌跡", "零の軌跡", "碧之轨迹", "碧之軌跡", "碧の軌跡", "闪之轨迹", "閃之軌跡", "閃の軌跡", "创之轨迹", "創之軌跡", "創の軌跡", "黎之轨迹", "黎之軌跡", "黎の軌跡", "界之轨迹", "界之軌跡", "界の軌跡", "Trails in the Sky", "Trails of Cold Steel", "Trails from Zero", "Trails to Azure", "Trails into Reverie", "Trails through Daybreak", "Trails beyond the Horizon", "Trails series", "Nayuta", "那由多"], sourceUrl: "https://www.falcom.co.jp/kiseki", color: "blue" },
  { id: "fire-emblem", name: "火焰纹章系列", ja: "ファイアーエムブレム", en: "Fire Emblem", description: "聚合火焰纹章的作品、战术玩法与发布动态。", aliases: ["火焰纹章", "火焰紋章", "圣火降魔录", "聖火降魔錄", "ファイアーエムブレム", "Fire Emblem", "风花雪月", "風花雪月", "FE3H"], sourceUrl: "https://www.nintendo.com/jp/fe/index.html", color: "red" },
  { id: "xenoblade", name: "异度之刃系列", ja: "ゼノブレイド", en: "Xenoblade Chronicles", description: "异度之刃各作品与相关版本的动态聚合。", aliases: ["异度之刃", "異度之刃", "异度神剑", "異度神劍", "ゼノブレイド", "Xenoblade"], sourceUrl: "https://www.nintendo.com/jp/switch/az3ha/index.html", color: "blue" },
  { id: "persona", name: "女神异闻录系列", ja: "ペルソナ", en: "Persona", description: "收集女神异闻录游戏的新消息、视频与评测。", aliases: ["女神异闻录", "女神異聞錄", "ペルソナ", "Persona 3", "Persona 4", "Persona 5", "Persona 6", "Persona series", "Persona", "Persona Q", "P3R", "P4G", "P5R"], sourceUrl: "https://p-ch.jp/", color: "red" },
  { id: "final-fantasy", name: "最终幻想系列", ja: "ファイナルファンタジー", en: "Final Fantasy", description: "最终幻想系列、重制版本及新作的统一入口。", aliases: ["最终幻想", "最終幻想", "太空战士", "太空戰士", "ファイナルファンタジー", "Final Fantasy", "FFVII", "FFXIV", "FFXVI", "FF7", "FF14", "FF16"], sourceUrl: "https://jp.finalfantasy.com/", color: "blue" },
  { id: "apothecary-diaries", name: "药屋少女系列", ja: "薬屋のひとりごと", en: "The Apothecary Diaries", description: "关注《药屋少女的呢喃／药师少女的独语》的游戏化动态。频道中文名为站内归类名，作品名称保留来源原文。", aliases: ["薬屋のひとりごと", "药屋少女的呢喃", "藥屋少女的呢喃", "药师少女的独语", "藥師少女的獨語", "The Apothecary Diaries", "Kusuriya no Hitorigoto", "真假皇弟", "偽りの皇弟"], sourceUrl: "https://www.gamecity.ne.jp/kusuriyanohitorigoto/jp/", color: "green" },
];
export const franchiseById = (id: string, registry: Franchise[] = franchises) => registry.find((ip) => ip.id === id);
function normalized(value: string) { return value.normalize("NFKC").replace(/[éÉ]/g, "e").toLowerCase().replace(/[’']/g, "").replace(/[‐‑–—]/g, "-"); }
const aliasPatterns = new Map<string, RegExp>();
export function mentionsAlias(text: string, alias: string) {
  const haystack = normalized(text); const needle = normalized(alias);
  if (!/[a-z]/i.test(needle)) return haystack.includes(needle);
  let pattern = aliasPatterns.get(needle);
  if (!pattern) { const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"); pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i"); aliasPatterns.set(needle, pattern); }
  return pattern.test(haystack);
}
type AliasNode = { children: Map<string, AliasNode>; matches: { index: number; latin: boolean }[] };
// Ordinary words are not evidence of franchise membership. Search suggestions
// still accept these labels, but automatic tagging requires a specific name.
const ambiguousAliases = new Set(["new","lost","control","trails","shift","air","love","black","white","dark","one","it","the","project","world","evolution","kingdom","mana","simple","tales","atelier","不可思议","不可思議"]);
const tries = new WeakMap<Franchise[], AliasNode>();
export function matchFranchises(text: string, registry: Franchise[] = franchises) {
  let root = tries.get(registry);
  if (!root) {
    root = { children: new Map(), matches: [] };
    registry.forEach((ip, index) => ip.aliases.forEach((alias) => {
      const term = normalized(alias).replace(/\s+/g, " ").trim(); if (term.length < 2 || ambiguousAliases.has(term)) return;
      let node = root!; for (const char of term) { let next = node.children.get(char); if (!next) { next = { children: new Map(), matches: [] }; node.children.set(char, next); } node = next; }
      node.matches.push({ index, latin: /[a-z]/i.test(term) });
    })); tries.set(registry, root);
  }
  const value = normalized(text).replace(/\s+/g, " "); const found = new Set<number>();
  for (let start = 0; start < value.length; start++) {
    let node: AliasNode | undefined = root;
    for (let end = start; end < value.length; end++) {
      node = node.children.get(value[end]); if (!node) break;
      for (const hit of node.matches) if (!hit.latin || (!/[a-z0-9]/.test(value[start - 1] || "") && !/[a-z0-9]/.test(value[end + 1] || ""))) found.add(hit.index);
    }
  }
  // Atelier is also a studio/workshop noun. Only a title-shaped prefix or
  // explicit Gust/Koei Tecmo context supports the English franchise label.
  if (/\batelier\b/i.test(text) && (/^(?:[\s“‘"']*)Atelier\s+[A-Z]/m.test(text) || /\b(Gust|Koei Tecmo)\b/i.test(text))) {
    const atelier = registry.findIndex(ip => ip.id === "atelier"); if (atelier >= 0) found.add(atelier);
  }
  return [...found].sort((a,b) => a-b).map(i => registry[i]);
}
// Cache by immutable dictionary snapshot as well as article/game identity. A
// refreshed registry cannot reuse matches from an older dictionary version.
const indexes = new WeakMap<Franchise[], { games: WeakMap<CatalogGame, Franchise[]>; articles: WeakMap<NewsArticle, Franchise[]> }>();
function index(registry: Franchise[]) { let value = indexes.get(registry); if (!value) { value = { games: new WeakMap(), articles: new WeakMap() }; indexes.set(registry, value); } return value; }
export function gameFranchises(game: CatalogGame, registry: Franchise[] = franchises) { const cache = index(registry).games; let matches = cache.get(game); if (!matches) { matches = game.ipIds?.length ? registry.filter((ip) => game.ipIds!.includes(ip.id)) : matchFranchises(identityNames(game).join("\n"), registry); cache.set(game, matches); } return matches; }
export function articleFranchises(article: NewsArticle, registry: Franchise[] = franchises) { const cache = index(registry).articles; let matches = cache.get(article); if (!matches) { matches = article.ipIds ? registry.filter((ip) => article.ipIds!.includes(ip.id)) : matchFranchises(article.title + "\n" + article.excerpt, registry); cache.set(article, matches); } return matches; }
const emptyGames: CatalogGame[] = [];
const suggestionIndexes = new WeakMap<Franchise[], WeakMap<CatalogGame[], Map<string, Franchise[]>>>();
export function suggestFranchises(query: string, games: CatalogGame[] = emptyGames, registry: Franchise[] = franchises) {
  if (query.trim().length < 2) return [];
  let dictionary = suggestionIndexes.get(registry); if (!dictionary) { dictionary = new WeakMap(); suggestionIndexes.set(registry, dictionary); }
  let cache = dictionary.get(games); if (!cache) { cache = new Map(); dictionary.set(games, cache); }
  const hit = cache.get(query); if (hit) return hit;
  const direct = matchFranchises(query, registry);
  const partial = registry.filter((ip) => [ip.name, ip.en, ip.ja, ...ip.aliases, ...(ip.searchAliases||[])].some((name) => normalized(name).includes(normalized(query.trim()))));
  const related = games.filter((game) => identityNames(game).some((name) => searchTokensMatch(name, query))).flatMap((game) => gameFranchises(game, registry));
  const hits = [...new Map([...direct, ...partial, ...related].map((ip) => [ip.id, ip])).values()];
  const parents = hits.flatMap(ip=>(ip.parentIds||[]).map(id=>registry.find(p=>p.id===id))).filter((ip):ip is Franchise=>!!ip);
  const result = [...new Map([...parents,...hits].map(ip=>[ip.id,ip])).values()].slice(0,6);
  if (cache.size >= 20) cache.delete(cache.keys().next().value!); cache.set(query, result); return result;
}
export function franchiseIndex(registry: Franchise[]) {
  return {
    franchises: registry,
    franchiseById: (id: string) => franchiseById(id, registry),
    gameFranchises: (game: CatalogGame) => gameFranchises(game, registry),
    articleFranchises: (article: NewsArticle) => articleFranchises(article, registry),
    suggestFranchises: (query: string, games?: CatalogGame[]) => suggestFranchises(query, games, registry),
    matchesNewsQuery: (article: NewsArticle, query: string, games?: CatalogGame[]) => matchesNewsQuery(article, query, games, registry),
  };
}
export type NewsCategory = "latest" | "video" | "review" | "release";
export const categoryLabels: Record<NewsCategory, string> = { latest: "最新动态", video: "预告片 / 视频", review: "评测 / 攻略", release: "发售变动" };
export function articleCategories(article: NewsArticle): NewsCategory[] {
  const text = article.title;
  const categories: NewsCategory[] = ["latest"];
  if (/\b(trailer|video|gameplay|teaser)\b|预告|預告|视频|影片|トレーラー|映像|動画|PV\b/i.test(text)) categories.push("video");
  if (/\b(review|guide|walkthrough|tips)\b|评测|評測|评测|攻略|レビュー|ガイド/i.test(text)) categories.push("review");
  if (/\brelease date\b|\blaunch(es|ing)?\b|\bdelay(ed)?\b|\bpostpon(ed|ement)\b|发售|發售|上市|延期|発売|リリース日/i.test(text)) categories.push("release");
  return categories;
}
export function majorNewsReason(article: NewsArticle): string | null {
  if (article.topic === "rumor" || /\?|？|rumou?r|leak|可能|或将|或將|预计|預計|未确认|未確認|噂|リーク|予想|reportedly|could|might|when will/i.test(article.title)) return null;
  // Do not promote reviews, merchandise or speculation into release alerts.
  if (articleCategories(article).includes("review") || /グッズ|ネックレス|フィギュア|amiibo|merchandise|merch\b|necklace|figurine|soundtrack|周边|周邊|コンサート|concert|anime|アニメ|动画|動畫|映画|movie|sale\b|セール|折扣|特卖/i.test(article.title)) return null;
  if (/\brelease date\b.*\b(announc|confirm|reveal)|\b(announc|confirm|reveal)\w*.*\brelease date\b|\blaunch(es|ing)? (on|in)\b|\bdelay(ed)?\b|\bpostpon(ed|ement)\b|发售日.*(确定|公布)|發售日.*(確定|公布)|定档|定檔|延期|発売日.*(決定|発表)|発売決定/i.test(article.title)) return "发售计划更新";
  if (/\blaunch(es|ing)? (January|February|March|April|May|June|July|August|September|October|November|December)\b|\d{1,2}月\d{1,2}日.{0,12}(発売|发售|發售)/i.test(article.title)) return "发售计划更新";
  if (/\b(new|launch|official|debut|reveal|announcement|final)\b.*\b(trailer|teaser)\b|\btrailer\b.*\b(reveal|release|debut)|全新预告|全新預告|新预告|新預告|预告.*(公布|发布)|預告.*(公布|公開)|トレーラー.*公開|新.*トレーラー/i.test(article.title)) return "新预告发布";
  return null;
}
export function articlePlatforms(article: NewsArticle) {
  const text = `${article.title} ${article.excerpt}`; const result: string[] = [];
  if (/\b(switch\s*2)\b|スイッチ\s*2/i.test(text)) result.push("Switch 2");
  if (/\bswitch\b(?!\s*2)|スイッチ(?!\s*2)/i.test(text)) result.push("Switch");
  if (/\bPS5\b|PlayStation\s*5/i.test(text)) result.push("PS5");
  if (/\bPS4\b|PlayStation\s*4/i.test(text)) result.push("PS4");
  if (/\bPC\b|\bSteam\b|Windows/i.test(text)) result.push("PC");
  if (/Xbox/i.test(text)) result.push("Xbox");
  return result;
}
export function matchesNewsQuery(item: NewsArticle, query: string, games: CatalogGame[] = emptyGames, registry: Franchise[] = franchises) {
  if (!query.trim() || searchTokensMatch(`${item.title} ${item.excerpt} ${item.sourceName}`, query)) return true;
  const related = suggestFranchises(query, games, registry);
  return articleFranchises(item, registry).some((ip) => related.some((candidate) => candidate.id === ip.id));
}
export function ipTimeline(games: CatalogGame[], now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return games.flatMap((game) => {
    const versions = game.releases?.length ? game.releases : [{ date: game.releaseDate, label: game.dateLabel, platforms: game.platforms, sourceUrl: game.source.url, kind: "作品" }];
    return versions.filter((release) => release.date ? release.date >= today : ["upcoming", "development"].includes(game.declaredStatus)).map((release) => ({ ...release, game }));
  }).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
}
