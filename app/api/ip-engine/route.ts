import { environment } from "../../lib/database";
import { engineStatus } from "../../lib/ip-repository";
export async function GET() {
  try { const { DB } = await environment(); if (!DB) throw new Error("D1 unavailable"); return Response.json(await engineStatus(DB), { headers: { "Cache-Control": "public, max-age=60" } }); }
  catch { return Response.json({ error: "后台状态暂不可用" }, { status: 503 }); }
}
