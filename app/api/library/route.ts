import { environment } from "../../lib/database";
import { json } from "../../lib/auth";
import { handleLibrary } from "../../lib/library-api";
async function handle(request: Request) { try { return await handleLibrary(request, await environment()); } catch { return json({ error: "云端存储暂时不可用，请稍后重试。" }, 503); } }
export const GET = handle;
export const PUT = handle;
