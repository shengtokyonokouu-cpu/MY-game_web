import { environment } from "../../lib/database";
import { archivedNews, registeredIP } from "../../lib/ip-repository";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams; const id = params.get("ip") || "";
  const cursor = Number(params.get("cursor") || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || id.length > 100) return Response.json({ error: "参数不正确" }, { status: 400 });
  try {
    const { DB } = await environment(); if (!DB) throw new Error("D1 unavailable");
    if (id && !await registeredIP(DB, id)) return Response.json({ error: "没有这个系列" }, { status: 404 });
    const feed = await archivedNews(DB, id || undefined, 100, cursor);
    return Response.json({ ...feed, nextCursor: cursor + 100 < feed.total ? cursor + 100 : null }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch { return Response.json({ error: "历史资讯暂不可用" }, { status: 503 }); }
}
