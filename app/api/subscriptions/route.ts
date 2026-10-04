import { environment } from "../../lib/database";
import { json } from "../../lib/auth";
import { handleIPAccount } from "../../lib/ip-account-api";
import { currentNews } from "../../lib/news-service";
import { readPublicData } from "../../lib/public-data-server";
import type { SeriesIndex } from "../../lib/series-types";
async function handle(request: Request) { try { return await handleIPAccount(request, await environment(), currentNews,async id=>(await readPublicData<SeriesIndex>("index.json")).items.some(ip=>ip.id===id)); } catch { return json({ error: "IP 云端服务暂时不可用，请稍后重试。" }, 503); } }
export const GET = handle;
export const PUT = handle;
