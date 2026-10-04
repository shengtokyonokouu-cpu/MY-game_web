import { readPublicData } from "../../lib/public-data-server";
import type { SeriesIndex } from "../../lib/series-types";
export async function GET() {
  try { const index = await readPublicData<SeriesIndex>("index.json"); return Response.json({ mode:"offline-snapshot", cloudflareScheduler:"disabled", ...index.stats, updatedAt:index.updatedAt, healthy:Date.now()-Date.parse(index.updatedAt)<10*86400000, coverage:index.coverage }, {headers:{"Cache-Control":"public, max-age=900"}}); }
  catch { return Response.json({mode:"offline-snapshot",cloudflareScheduler:"disabled",healthy:false},{status:503}); }
}
