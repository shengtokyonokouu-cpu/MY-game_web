import type { NewsFeed } from "./news";
import { newsSources } from "./news-sources.ts";

// localStorage is optional and untrusted: a stale/partial cache must never make
// the news screen crash or introduce links outside the subscribed sources.
const origins: Record<string, string> = Object.fromEntries(newsSources.map((source) => [source.id, source.site]));
export function validateNewsFeed(value: unknown): NewsFeed {
  const feed = value as NewsFeed | null;
  if (!feed || !Array.isArray(feed.items) || feed.items.length > 300 || !Array.isArray(feed.sources) || typeof feed.fetchedAt !== "string" || !Number.isFinite(Date.parse(feed.fetchedAt))) throw new Error("无效的新闻缓存");
  for (const source of feed.sources) if (!source || !Object.hasOwn(origins, source.id) || typeof source.name !== "string" || typeof source.ok !== "boolean" || !Number.isSafeInteger(source.count) || source.count < 0) throw new Error("无效的新闻来源");
  for (const item of feed.items) {
    if (!item || typeof item.title !== "string" || typeof item.excerpt !== "string" || typeof item.id !== "string" || typeof item.sourceName !== "string" || typeof item.language !== "string" || !Number.isFinite(Date.parse(item.publishedAt)) || !["official", "media"].includes(item.sourceKind) || !["news", "interview", "rumor"].includes(item.topic) || !feed.sources.some((source) => source.id === item.sourceId)) throw new Error("无效的新闻内容");
    const url = new URL(item.url);
    if (url.origin !== origins[item.sourceId] || url.username || url.password || item.id !== url.href) throw new Error("无效的新闻链接");
  }
  return feed;
}
