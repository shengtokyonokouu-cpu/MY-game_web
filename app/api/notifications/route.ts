import { environment } from "../../lib/database";
import { json } from "../../lib/auth";
import { handleIPAccount } from "../../lib/ip-account-api";
import { currentNews } from "../../lib/news-service";
async function handle(request: Request) { try { return await handleIPAccount(request, await environment(), currentNews); } catch { return json({ error: "通知服务暂时不可用，已有提醒仍保留在云端。" }, 503); } }
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
