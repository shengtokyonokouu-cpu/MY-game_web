import { cached } from "./server-data";
import { fetchNews, type NewsFeed } from "./news";
import { environment } from "./database";
import { archivedNews } from "./ip-repository";
export async function newsResponse() { return cached("archived-news-v3", 60, async () => {
  try { const { DB } = await environment(); if (DB) { const feed = await archivedNews(DB); if (feed.items.length) return Response.json(feed); } }
  catch (error) { console.error("News archive unavailable; using live feeds", error); }
  return Response.json(await fetchNews());
}); }
export async function currentNews(): Promise<NewsFeed> { return (await newsResponse()).json(); }
