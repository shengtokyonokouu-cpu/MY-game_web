import { cached } from "../../lib/server-data";
import { fetchNews } from "../../lib/news";
export async function GET() {
  try { return await cached("live-news-v1", 300, async () => Response.json(await fetchNews())); }
  catch { return Response.json({ error: "新闻源暂时无法连接，请稍后重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
