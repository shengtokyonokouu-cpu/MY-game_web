import type { NewsFeed } from "./news";
import { readPublicData } from "./public-data-server";
export async function currentNews(): Promise<NewsFeed> { const feed=await readPublicData<NewsFeed>("news.json"); return {...feed,stale:Date.now()-Date.parse(feed.fetchedAt)>8*3600000}; }
export async function newsResponse() { return Response.json(await currentNews(),{headers:{"Cache-Control":"public, max-age=900"}}); }
