import { parseHTML } from "linkedom";
import type { CatalogFeed, CatalogGame } from "./catalog";
import { gameArticle, sameGameArticle } from "./game-artwork.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GENRES: Record<string, string> = { "Action": "动作", "Action RPG": "动作 RPG", "Action-adventure": "动作冒险", "Adventure": "冒险", "RPG": "角色扮演", "JRPG": "日式 RPG", "Tactical RPG": "策略 RPG", "Turn-based RPG": "回合制 RPG", "Platform": "平台跳跃", "Platformer": "平台跳跃", "Puzzle": "解谜", "Simulation": "模拟", "Strategy": "策略", "Survival horror": "生存恐怖", "Horror": "恐怖", "Roguelike": "Roguelike", "Roguelite": "Roguelite", "Metroidvania": "类银河战士恶魔城", "Visual novel": "视觉小说", "Racing": "竞速", "Sports": "体育", "Fighting": "格斗", "Rhythm": "音乐节奏", "FPS": "第一人称射击", "TPS": "第三人称射击", "Shooter": "射击", "Real-time strategy": "即时战略", "Stealth": "潜行", "MMORPG": "大型多人 RPG", "Survival": "生存" };
export const upstreamHeaders = { "User-Agent": "ReleaseSignal/2.0 (https://release-signal.pages.dev; personal game catalog)", Accept: "application/json" };
export function cleanText(text: string | null | undefined) { return (text || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim(); }
export function stableId(value: string) { let hash = 2166136261; for (const character of value.normalize("NFKC").toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return `wiki-${(hash >>> 0).toString(36)}`; }
export function parseDate(text: string, year: number) {
  const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})$/i);
  if (!match) return null;
  const month = MONTHS.findIndex((value) => value.toLowerCase() === match[1].toLowerCase()); const day = Number(match[2]);
  if (day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function normalizePlatforms(text: string) {
  const found: string[] = [];
  if (/\b(WIN|LIN|OSX|PC)\b|Windows|macOS|Linux/i.test(text)) found.push("PC");
  if (/\bNS2\b|Switch 2/i.test(text)) found.push("Switch 2");
  if (/\bNS\b|Nintendo Switch(?! 2)/i.test(text)) found.push("Switch");
  if (/\bPS5\b|PlayStation 5/i.test(text)) found.push("PS5");
  if (/\bPS4\b|PlayStation 4/i.test(text)) found.push("PS4");
  if (/\b(XBO|XBX|XSX)\b|Xbox/i.test(text)) found.push("Xbox");
  if (/\biOS\b/i.test(text)) found.push("iOS");
  if (/\bDROID\b|Android/i.test(text)) found.push("Android");
  return found;
}
// Real tables use rowspan for dates and colspan for developer/publisher cells.
export function expandRows(table: Element): Element[][] {
  const grid: Element[][] = [];
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
  rows.forEach((row, y) => {
    grid[y] ??= []; let x = 0;
    for (const cell of Array.from(row.children).filter((cell) => /^(TH|TD)$/.test(cell.tagName))) {
      while (grid[y][x]) x++;
      const height = Math.min(366, Math.max(1, Number(cell.getAttribute("rowspan")) || 1));
      const width = Math.min(20, Math.max(1, Number(cell.getAttribute("colspan")) || 1));
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) { grid[y + dy] ??= []; grid[y + dy][x + dx] = cell; }
      x += width;
    }
  });
  return grid;
}
export function parseAnnualFeed(html: string, year: number, checkedAt: string): CatalogGame[] {
  const { document } = parseHTML(html);
  document.querySelectorAll("sup.reference, .sortkey").forEach((node) => node.remove());
  document.querySelectorAll("br").forEach((node) => node.replaceWith(document.createTextNode(", ")));
  const items: CatalogGame[] = [];
  const listUrl = `https://en.wikipedia.org/wiki/List_of_video_games_released_in_${year}`;
  for (const table of document.querySelectorAll("table.wikitable")) {
    const rows = expandRows(table);
    const heading = rows.findIndex((row) => row.some((cell) => cleanText(cell.textContent) === "Title") && row.some((cell) => /^(Release date|Approximate date)/.test(cleanText(cell.textContent))));
    if (heading < 0) continue;
    const headers = rows[heading].map((cell) => cleanText(cell.textContent).toLowerCase());
    const titleIndex = headers.indexOf("title"); const dateIndex = headers.findIndex((value) => /^(release date|approximate date)/.test(value));
    const field = (row: Element[], prefix: string) => cleanText(row[headers.findIndex((value) => value.startsWith(prefix))]?.textContent);
    for (const row of rows.slice(heading + 1)) {
      const cell = row[titleIndex]; if (!cell) continue;
      const title = cleanText(cell.querySelector("i")?.textContent || cell.textContent).replace(/\s*\((WW|JP|NA|EU|PAL)\)\s*$/, "");
      if (!title || title === "Title" || title.length > 180) continue;
      const dateRaw = cleanText(row[dateIndex]?.textContent); const date = parseDate(dateRaw, year);
      const titleKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const link = Array.from(cell.querySelectorAll("a")).find((anchor) => !anchor.classList.contains("new") && /^(\.\/|\/wiki\/)/.test(anchor.getAttribute("href") || "") && titleKey(cleanText(anchor.textContent)) === titleKey(title));
      const linkedTitle = link ? decodeURIComponent((link.getAttribute("href") || "").replace(/^(\.\/|\/wiki\/)/, "")).replaceAll("_", " ") : "";
      const article = gameArticle(linkedTitle) && sameGameArticle(title, linkedTitle) ? linkedTitle : "";
      const developer = field(row, "developer"); const publisher = field(row, "publisher");
      const platforms = normalizePlatforms(field(row, "platform"));
      const type = field(row, "type"); const genreText = field(row, "genre");
      const label = date ? date.replaceAll("-", ".") : !dateRaw || /^TBA$/i.test(dateRaw) ? `${year} 年 · 日期待定` : `${year} 年 ${dateRaw}`;
      items.push({ id: stableId(title), title, originalTitle: title, articleTitle: article, developer, publisher, country: "", region: "", platforms,
        genres: genreText.split(/,|;/).map((value) => value.trim()).filter(Boolean).map((value) => GENRES[value] || value),
        releaseDate: date, dateLabel: label, declaredStatus: date ? date <= checkedAt ? "released" : "upcoming" : /^TBA$/i.test(dateRaw) ? "development" : "upcoming",
        summary: "", source: { type: "index", label: `Wikipedia · ${year} 发布清单`, url: listUrl, checkedAt, evidence: `年度清单标注 ${label}；平台：${platforms.join(" / ") || field(row, "platform") || "待定"}${type ? `；版本：${type}` : ""}。日期可能随地区和版本不同，请以官方信息为准。` },
        releases: [{ date, label, platforms, kind: type, sourceUrl: listUrl }],
      });
    }
  }
  const merged = new Map<string, CatalogGame>();
  for (const item of items) {
    const old = merged.get(item.id);
    if (!old) { merged.set(item.id, item); continue; }
    const releases = [...(old.releases || []), ...(item.releases || [])];
    const earlier = item.releaseDate && (!old.releaseDate || item.releaseDate < old.releaseDate) ? item : old;
    merged.set(item.id, { ...earlier, platforms: Array.from(new Set([...old.platforms, ...item.platforms])), releases });
  }
  return [...merged.values()];
}
export async function fetchAnnualFeed(years: number[], signal?: AbortSignal): Promise<CatalogFeed> {
  const checkedAt = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(years.map(async (year) => {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/List_of_video_games_released_in_${year}`, { headers: { ...upstreamHeaders, Accept: "text/html" }, signal: signal || AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`Wikipedia ${year}: ${response.status}`);
    const items = parseAnnualFeed(await response.text(), year, checkedAt); if (!items.length) throw new Error(`No release rows for ${year}`); return items;
  }));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length) throw new Error("Game release sources are unavailable");
  const unique = new Map<string, CatalogGame>();
  for (const game of items) {
    const previous = unique.get(game.id);
    unique.set(game.id, previous ? { ...previous, platforms: Array.from(new Set([...previous.platforms, ...game.platforms])), releases: [...(previous.releases || []), ...(game.releases || [])] } : game);
  }
  return { items: [...unique.values()], years, updatedAt: new Date().toISOString(), partial: results.some((result) => result.status === "rejected") };
}
