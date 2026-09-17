import { newsResponse } from "../../lib/news-service";
export async function GET() {
  try { return await newsResponse(); }
  catch { return Response.json({ error: "新闻源暂时无法连接，请稍后重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
