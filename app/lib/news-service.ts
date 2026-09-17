import { cached } from "./server-data";
import { fetchNews, type NewsFeed } from "./news";
export async function newsResponse() { return cached("live-news-v1", 300, async () => Response.json(await fetchNews())); }
export async function currentNews(): Promise<NewsFeed> { return (await newsResponse()).json(); }
