import { environment } from "../../../lib/database";
import { handleAuth, json } from "../../../lib/auth";
async function handle(request: Request) { try { return await handleAuth(request, await environment()); } catch { return json({ error: "账号服务暂时不可用，请稍后重试。" }, 503); } }
export const GET = handle;
export const POST = handle;
