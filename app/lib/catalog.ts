import { games, type ScoreSet } from "../data/games.ts";
import coverData from "../data/covers.json" with { type: "json" };

export type ReleaseState = "released" | "upcoming" | "development" | "check";
export type LibraryStatus = "wishlist" | "playing" | "finished" | "paused";
export type CatalogGame = {
  id: string;
  title: string;
  originalTitle: string;
  developer: string;
  publisher: string;
  region: string;
  country: string;
  platforms: string[];
  genres: string[];
  releaseDate: string | null;
  dateLabel: string;
  declaredStatus: ReleaseState;
  summary: string;
  fit?: string;
  caution?: string;
  featured?: boolean;
  image?: string;
  articleTitle: string;
  searchTerms?: string[];
  releases?: { date: string | null; label: string; platforms: string[]; kind: string; sourceUrl: string }[];
  source: { label: string; url: string; checkedAt: string; evidence: string; type: "official" | "index" | "store" };
};
export type CatalogFeed = { items: CatalogGame[]; updatedAt: string; years: number[]; partial?: boolean; stale?: boolean };
export type PersonalEntry = { game: CatalogGame; status: LibraryStatus; scores: Partial<ScoreSet>; notes: string; updatedAt: string };
export type Library = Record<string, PersonalEntry>;
export const LIBRARY_KEY = "release-signal-library-v2";
export const scoreAxes = [{ key: "gameplay", label: "玩法" }, { key: "story", label: "剧情" }, { key: "visuals", label: "画面" }, { key: "music", label: "音乐" }] as const;
export const libraryLabels: Record<LibraryStatus, string> = { wishlist: "想玩", playing: "在玩", finished: "已通关", paused: "搁置" };
export const releaseLabels: Record<ReleaseState, string> = { released: "已发售", upcoming: "将发布", development: "未定档", check: "待复核" };
export const curatedGames: CatalogGame[] = games.map((game) => ({
  id: game.id, title: game.title, originalTitle: game.originalTitle,
  developer: game.developer, publisher: game.publisher, region: game.region, country: game.country,
  platforms: game.platforms.map((platform) => platform === "NS2" ? "Switch 2" : platform), genres: game.genres,
  releaseDate: game.releaseDate, dateLabel: game.dateLabel, declaredStatus: game.status,
  summary: game.summary, fit: game.fit, caution: game.caution, featured: game.featured,
  articleTitle: game.id === "fable" ? "Fable (upcoming video game)" : game.id === "xenoblade-x-definitive" ? "" : game.originalTitle, source: { ...game.source, type: game.signal === "官方" ? "official" : "index" },
  image: (coverData as Record<string, { image: string }>)[game.id]?.image,
}));

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function releaseState(game: CatalogGame, today = localDate()): ReleaseState {
  if (game.declaredStatus === "released") return "released";
  if (game.declaredStatus === "check") return "check";
  if (game.releaseDate && game.releaseDate < today) return "check";
  return game.releaseDate ? "upcoming" : game.declaredStatus === "upcoming" ? "upcoming" : "development";
}
export function normalizedTitle(title: string) {
  return title.toLowerCase().normalize("NFKC").replace(/\([^)]*video game[^)]*\)/g, "").replace(/[™®]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
export function mergeCatalog(primary: CatalogGame[], extra: CatalogGame[]) {
  const output: CatalogGame[] = [];
  const titles = new Map<string, number>();
  const ids = new Map<string, number>();
  for (const game of [...primary, ...extra]) {
    const existing = [game.title, game.originalTitle, game.articleTitle].filter(Boolean).map((title) => titles.get(normalizedTitle(title))).find((index) => index !== undefined);
    const existingIndex = existing ?? ids.get(game.id);
    if (existingIndex !== undefined) {
      // Keep the curated facts and identity, but use a confirmed article's artwork when available.
      const current = output[existingIndex];
      output[existingIndex] = { ...current, image: current.image || game.image,
        title: current.source.type === "index" && /[\u3400-\u9fff]/.test(game.title) ? game.title : current.title,
        searchTerms: Array.from(new Set([...(current.searchTerms || []), ...(game.searchTerms || [])])),
        releases: current.releases?.length ? current.releases : game.releases };
      ids.set(game.id, existingIndex);
      [game.title, game.originalTitle, game.articleTitle].filter(Boolean).forEach((title) => titles.set(normalizedTitle(title), existingIndex));
      continue;
    }
    const index = output.push(game) - 1;
    ids.set(game.id, index);
    [game.title, game.originalTitle, game.articleTitle].filter(Boolean).forEach((title) => titles.set(normalizedTitle(title), index));
  }
  return output;
}
export function averageScore(scores?: Partial<ScoreSet>) {
  const values = scoreAxes.map(({ key }) => scores?.[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
export function matchesQuery(game: CatalogGame, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [game.title, game.originalTitle, game.developer, game.publisher, game.country, ...game.genres, ...(game.searchTerms || [])].join(" ").toLowerCase();
  return terms.every((term) => text.includes(term));
}
export function migrateLibrary(raw: string | null, legacy: string | null): Library {
  if (raw) return validateLibrary(JSON.parse(raw));
  if (!legacy) return {};
  const old = JSON.parse(legacy);
  const ids = new Set<string>([...(Array.isArray(old.wishlist) ? old.wishlist : []), ...Object.keys(old.shelf ?? {}), ...Object.keys(old.ratings ?? {}), ...Object.keys(old.notes ?? {})]);
  const result: Library = {};
  for (const id of ids) {
    const game = curatedGames.find((item) => item.id === id);
    if (!game) continue;
    const status = old.shelf?.[id];
    result[id] = { game, status: status === "playing" || status === "finished" || status === "paused" ? status : "wishlist", scores: old.ratings?.[id] ?? {}, notes: old.notes?.[id] ?? "", updatedAt: new Date().toISOString() };
  }
  return validateLibrary({ version: 2, entries: result });
}
export function validateLibrary(value: unknown): Library {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 2 || !("entries" in value) || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw new Error("备份格式不正确，请选择发售信号导出的 JSON 文件。");
  const result: Library = {};
  for (const [id, raw] of Object.entries(value.entries)) {
    const entry = raw as PersonalEntry;
    const game = entry?.game;
    if (["__proto__", "constructor", "prototype"].includes(id) || id.length > 200) throw new Error("备份包含无效的记录标识。");
    if (!game || !["released", "upcoming", "development", "check"].includes(game.declaredStatus) || (game.releaseDate !== null && (typeof game.releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate))) || typeof game.dateLabel !== "string" || typeof game.country !== "string" || typeof game.region !== "string" || typeof game.source?.checkedAt !== "string" || typeof game.source?.evidence !== "string" || typeof game.source?.label !== "string") throw new Error("备份包含无效的日期或来源。");
    if (game.image !== undefined && (typeof game.image !== "string" || !/^(\/covers\/[^/]+\.(jpg|png|webp)|https:\/\/)/.test(game.image))) throw new Error("备份包含无效的封面地址。");
    if (game.searchTerms !== undefined && (!Array.isArray(game.searchTerms) || !game.searchTerms.every((term) => typeof term === "string"))) throw new Error("备份包含无效的搜索别名。");
    if (game.releases !== undefined && (!Array.isArray(game.releases) || game.releases.some((release) => !release || typeof release.label !== "string" || !Array.isArray(release.platforms) || !release.platforms.every((p) => typeof p === "string") || (release.date !== null && (typeof release.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(release.date)))))) throw new Error("备份包含无效的版本记录。");
    if (!game || game.id !== id || typeof game.title !== "string" || typeof game.originalTitle !== "string" || !Array.isArray(game.platforms) || !game.platforms.every((p) => typeof p === "string") || !Array.isArray(game.genres) || !game.genres.every((p) => typeof p === "string") || !game.source || !/^https:\/\//.test(game.source.url) || typeof game.articleTitle !== "string" || typeof game.summary !== "string" || typeof game.developer !== "string" || typeof game.publisher !== "string" || !["official", "index", "store"].includes(game.source.type) || !Object.hasOwn(libraryLabels, entry.status) || typeof entry.notes !== "string" || entry.notes.length > 5000) throw new Error("备份包含无效的游戏记录。");
    const scores: Partial<ScoreSet> = {};
    for (const { key } of scoreAxes) {
      const score = entry.scores?.[key];
      if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score) || score < 1 || score > 10)) throw new Error("评分必须在 1–10 之间。");
      if (score !== undefined) scores[key] = score;
    }
    result[id] = { game, status: entry.status, notes: entry.notes, scores, updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString() };
  }
  return result;
}
