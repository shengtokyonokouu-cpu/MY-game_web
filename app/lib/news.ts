import { DOMParser, parseHTML } from "linkedom";

import { newsSources, type NewsSource } from "./news-sources.ts";
export { newsSources } from "./news-sources.ts";
export type { NewsSource } from "./news-sources.ts";
export type NewsArticle = { id: string; title: string; url: string; publishedAt: string; excerpt: string; sourceId: string; sourceName: string; sourceKind: "official" | "media"; topic: "news" | "interview" | "rumor"; language: string; ipIds?: string[] };
export type NewsFeed = { items: NewsArticle[]; fetchedAt: string; sources: { id: string; name: string; ok: boolean; count: number }[]; stale?: boolean };

function plainText(html: string) { const { document } = parseHTML(`<html><body>${html}</body></html>`); document.querySelectorAll("script,style").forEach((node) => node.remove()); return document.body.textContent.replace(/\s+/g, " ").trim(); }
export function parseNews(xml: string, source: NewsSource, now = Date.now()): NewsArticle[] {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const items: NewsArticle[] = [];
  for (const item of document.querySelectorAll("item,entry")) {
    const title = plainText(item.querySelector("title")?.textContent || "").slice(0, 300);
    const link = item.querySelector("link"); const rawUrl = link?.getAttribute("href") || link?.textContent || "";
    let url: URL; try { url = new URL(rawUrl.trim()); } catch { continue; }
    if (url.protocol !== "https:" || url.origin !== new URL(source.site).origin || url.username || url.password) continue;
    const timestamp = Date.parse((item.querySelector("pubDate,published,updated") || item.getElementsByTagName("dc:date")[0])?.textContent || "");
    if (!title || !Number.isFinite(timestamp) || timestamp > now + 5 * 60 * 1000) continue;
    url.hash = ""; for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    const excerpt = plainText(item.querySelector("description,summary")?.textContent || "").replace(/\s*(The post|Read more|Continue reading).*/i, "").slice(0, 180);
    items.push({ id: url.href, title, url: url.href, publishedAt: new Date(timestamp).toISOString(), excerpt, sourceId: source.id, sourceName: source.name, sourceKind: source.kind, topic: /\brumou?r\b|\bleak(ed)?\b|传闻|傳聞|爆料|噂|リーク/i.test(title) ? "rumor" : /\binterview\b|访谈|訪談|インタビュー|対談/i.test(title) ? "interview" : "news", language: source.language });
  }
  return items.slice(0, 30);
}
export async function fetchNews(): Promise<NewsFeed> {
  const results = await Promise.allSettled(newsSources.map(async (source) => {
    const response = await fetch(source.url, { headers: { "User-Agent": "ReleaseSignal/2.1 (+https://release-signal.pages.dev)", Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("News source unavailable");
    const xml = await response.text(); if (xml.length > 2_000_000) throw new Error("Feed too large");
    const items = parseNews(xml, source); if (!items.length) throw new Error("No valid news entries"); return items;
  }));
  const items = [...new Map(results.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((item) => [item.url, item])).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (!items.length) throw new Error("新闻来源暂时不可用");
  return { items, fetchedAt: new Date().toISOString(), sources: results.map((result, i) => ({ id: newsSources[i].id, name: newsSources[i].name, ok: result.status === "fulfilled", count: result.status === "fulfilled" ? result.value.length : 0 })) };
}
