import { authenticate, json, safeMutation, type AppEnv } from "./auth.ts";
import { validateLibrary } from "./catalog.ts";

export async function handleLibrary(request: Request, env: AppEnv): Promise<Response> {
  const session = await authenticate(request, env); if (!session) return json({ error: "请登录后同步游戏架。" }, 401);
  const db = env.DB!; const owner = session.user.id;
  const current = async () => { const row = await db.prepare("SELECT document, version FROM libraries WHERE user_id = ?").bind(owner).first<{ document: string; version: number }>(); return { entries: JSON.parse(row?.document || "{}"), version: row?.version || 0 }; };
  if (request.method === "GET") return json(await current());
  if (request.method !== "PUT") return json({ error: "请求方式不支持" }, 405);
  if (!safeMutation(request, session.csrf)) return json({ error: "请求校验失败，请刷新页面后重试。" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "仅接受 JSON 数据" }, 415);
  if (Number(request.headers.get("Content-Length")) > 2_000_000) return json({ error: "同步数据不能超过 2 MB。" }, 413);
  const reader = request.body?.getReader(); if (!reader) return json({ error: "缺少同步数据" }, 400);
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) { await reader.cancel(); return json({ error: "同步数据不能超过 2 MB。" }, 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!Number.isSafeInteger(body.version) || body.version < 0) return json({ error: "同步版本不正确。" }, 400);
    const entries = validateLibrary({ version: 2, entries: body.entries });
    if (Object.keys(entries).length > 1000) return json({ error: "每个账号最多同步 1,000 款游戏，请先导出备份。" }, 413);
    const updated = await db.prepare("UPDATE libraries SET document = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ? RETURNING version").bind(JSON.stringify(entries), Date.now(), owner, body.version).first<{ version: number }>();
    if (!updated) return json({ error: "其他设备已更新，请合并后重试。", ...await current() }, 409);
    return json({ entries, version: updated.version });
  } catch (error) { if (error instanceof SyntaxError) return json({ error: "数据格式不正确。" }, 400); if (error instanceof Error && /备份|评分/.test(error.message)) return json({ error: error.message }, 400); throw error; }
}
