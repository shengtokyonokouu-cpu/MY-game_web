import { parseHTML } from "linkedom";
import { mergeCatalog, normalizedTitle, type CatalogGame } from "./catalog.ts";
import { stableId, upstreamHeaders } from "./release-feed.ts";

type Platform = { title?: string; platform_name?: string; date?: string };
type DirectItem = { title?: string; maker?: string; thumb?: string; type?: string; platform?: Platform[]; setTitle?: { setTitle_title?: string; setTitle_maker?: string; setTitle_platform?: Platform[] }[]; related?: { related_item_sttl?: string; related_maker?: string; related_platform?: Platform[] }[] };
const root = "https://www.nintendo.com/jp/nintendo-direct/";
function clean(value = "") { return parseHTML(`<body>${value.replace(/<br\b[^>]*>/gi, " ")}</body>`).document.querySelector("body")!.textContent.replace(/\s+/g, " ").trim(); }
export function directDate(label: string): string | null {
  const matches = [...label.matchAll(/(20\d{2})[.年/](\d{1,2})[.月/](\d{1,2})/g)];
  if (matches.length !== 1) return null; // Mixed download/boxed dates stay as a window.
  const [, y, m, d] = matches[0], value = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export function parseNintendoDirect(data: Record<string, unknown>, pageUrl: string, now = new Date()): CatalogGame[] {
  const url = new URL(pageUrl);
  const eventId = url.pathname.match(/^\/jp\/nintendo-direct\/(\d{8})\/index\.html$/)?.[1];
  if (url.origin !== "https://www.nintendo.com" || !eventId) throw new Error("Invalid Direct source");
  const eventDate = `${eventId.slice(0, 4)}-${eventId.slice(4, 6)}-${eventId.slice(6)}`;
  if (eventDate > now.toISOString().slice(0, 10)) throw new Error("Unpublished Direct");
  const event = { title: `Nintendo Direct ${Number(eventId.slice(0, 4))}.${Number(eventId.slice(4, 6))}.${Number(eventId.slice(6))}`, date: eventDate, url: pageUrl };
  const games: CatalogGame[] = [];
  function add(rawTitle: string | undefined, maker: string | undefined, platforms: Platform[] | undefined, thumb?: string) {
    const title = clean(rawTitle); if (!title || !platforms?.length || /追加コンテンツ|エキスパンションパス|無料アップデート|amiibo/i.test(title)) return;
    const releases = platforms.filter((item) => item.platform_name?.includes("Nintendo Switch")).map((item) => {
      const label = clean(item.date || "未定");
      return { date: directDate(label), label, platforms: [item.platform_name!.includes("Switch 2") ? "Switch 2" : "Switch"], kind: "日本地区 · Nintendo Direct 公告", sourceUrl: pageUrl };
    });
    if (!releases.length) return;
    const label = [...new Set(releases.map((release) => release.label))].join(" / ");
    const date = releases.every((release) => release.date === releases[0].date) ? releases[0].date : null;
    let image: string | undefined;
    if (thumb) { const imageUrl = new URL(thumb, pageUrl); if (imageUrl.origin === url.origin && imageUrl.pathname.startsWith(`${url.pathname.replace("index.html", "")}assets/img/`) && /\.(png|jpe?g|webp)$/i.test(imageUrl.pathname)) image = imageUrl.href; }
    games.push({ id: `nintendo-${stableId(normalizedTitle(title))}`, title, originalTitle: title, articleTitle: "", names: { ja: { text: title, sourceUrl: pageUrl, kind: "official" } }, events: [event], image,
      developer: "", publisher: clean(maker), country: "", region: "", genres: [], platforms: [...new Set(releases.flatMap((release) => release.platforms))], releases,
      releaseDate: date, dateLabel: label, declaredStatus: /発売中|配信中/.test(label) ? "released" : date && date < now.toISOString().slice(0, 10) ? "check" : /20\d{2}/.test(label) ? "upcoming" : "development",
      summary: "", source: { type: "official", label: `${event.title} · 任天堂日本`, url: pageUrl, checkedAt: now.toISOString().slice(0, 10), evidence: "自动读取任天堂公开的直面会软件目录；此处的平台与时间仅代表日本地区任天堂版本，其他平台须另有发行商证据。" } });
  }
  for (const raw of Object.values(data).flatMap((value) => Array.isArray(value) ? value : [])) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as DirectItem;
    if (!/追加コンテンツ/.test(item.type || "")) add(item.title, item.maker, item.platform, item.thumb);
    for (const set of item.setTitle || []) add(set.setTitle_title, set.setTitle_maker, set.setTitle_platform, normalizedTitle(clean(set.setTitle_title)) === normalizedTitle(clean(item.title)) ? item.thumb : undefined);
    for (const related of item.related || []) {
      const groups = new Map<string, Platform[]>();
      for (const platform of related.related_platform || []) { const title = platform.title || related.related_item_sttl || ""; groups.set(title, [...(groups.get(title) || []), platform]); }
      for (const [title, platforms] of groups) add(title, related.related_maker, platforms);
    }
  }
  // Same title on Switch and Switch 2 is one game, with both regional records.
  const grouped = new Map<string, CatalogGame>();
  for (const game of games) { const old = grouped.get(game.id); if (!old) grouped.set(game.id, game); else { old.platforms = [...new Set([...old.platforms, ...game.platforms])]; old.releases = [...(old.releases || []), ...(game.releases || [])]; } }
  return [...grouped.values()];
}
async function read(url: string) {
  const response = await fetch(url, { headers: upstreamHeaders, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Nintendo source unavailable");
  const body = await response.text(); if (body.length > 2_000_000) throw new Error("Nintendo response too large"); return body;
}
export async function fetchNintendoDirect(): Promise<CatalogGame[]> {
  const html = await read(root);
  // The official entry point publishes its current edition as an HTTP/meta/JS
  // redirect. Extract only the fixed-origin numeric path; never execute script.
  const path = html.match(/\/jp\/nintendo-direct\/\d{8}\/index\.html/)?.[0];
  if (!path) throw new Error("Nintendo Direct format changed");
  const page = `https://www.nintendo.com${path}`;
  const parts = await Promise.allSettled(["headline", "pickup"].map(async (name) => parseNintendoDirect(JSON.parse(await read(new URL(`assets/data/${name}.json`, page).href)), page)));
  const items = parts.reduce((all, part) => part.status === "fulfilled" ? mergeCatalog(all, part.value) : all, [] as CatalogGame[]);
  if (!items.length) throw new Error("Nintendo Direct contains no valid games");
  return items;
}
