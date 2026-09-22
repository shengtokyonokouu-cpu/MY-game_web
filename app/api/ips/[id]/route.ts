import { readPublicData } from "../../../lib/public-data-server";
import { currentNews } from "../../../lib/news-service";
import type { SeriesIndex, SeriesChannel } from "../../../lib/series-types";
import { buildIPHub } from "../../../lib/ip-hub";
import { categoryLabels, type NewsCategory } from "../../../lib/franchises";
export async function GET(request: Request) {
  const url = new URL(request.url); const id = url.pathname.split("/").at(-1) || "";
  const category = url.searchParams.get("category") || "latest"; const page = Number(url.searchParams.get("page") || "1");
  if (!Object.hasOwn(categoryLabels, category) || !Number.isSafeInteger(page) || page < 1) return Response.json({ error: "分类或页码不正确。" }, { status: 400 });
  try {
    const registry = (await readPublicData<SeriesIndex>("index.json")).items; if (!registry.some((ip) => ip.id === id)) return Response.json({ error: "没有这个 IP 频道。" }, { status: 404 });
    const [channel, news] = await Promise.all([readPublicData<SeriesChannel>("series/"+id+".json"), currentNews()]);
    return Response.json({ ...buildIPHub(id, channel.games, news, { category: category as NewsCategory, page, platform: url.searchParams.get("platform") || "all", q: (url.searchParams.get("q") || "").slice(0, 120) }, registry), characters:channel.characters, coverage:channel.coverage }, { headers: { "Cache-Control": "public, max-age=900" } });
  } catch (error) { console.error("IP hub response failed", error); return Response.json({ error: "频道资料暂时不可用。" }, { status: 503 }); }
}
