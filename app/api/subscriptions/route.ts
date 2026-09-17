import { environment } from "../../lib/database";
import { json } from "../../lib/auth";
import { handleIPAccount } from "../../lib/ip-account-api";
import { currentNews } from "../../lib/news-service";
async function handle(request: Request) { try { return await handleIPAccount(request, await environment(), currentNews); } catch { return json({ error: "IP 云端服务暂时不可用，请稍后重试。" }, 503); } }
export const GET = handle;
export const PUT = handle;
