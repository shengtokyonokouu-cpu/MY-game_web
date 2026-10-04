import { currentNews } from "../../lib/news-service";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams; const id = params.get("ip") || "";
  const cursor = Number(params.get("cursor") || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || id.length > 100) return Response.json({ error: "参数不正确" }, { status: 400 });
  try {
    const feed = await currentNews(); const items = id ? feed.items.filter(a=>a.ipIds?.includes(id)) : feed.items;
    return Response.json({ ...feed, items:items.slice(cursor,cursor+100),total:items.length,nextCursor:cursor+100<items.length?cursor+100:null }, { headers: { "Cache-Control": "public, max-age=900" } });
  } catch { return Response.json({ error: "历史资讯暂不可用" }, { status: 503 }); }
}
