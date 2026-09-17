import { cached, imageResponse, resolveCover } from "../../lib/server-data";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim() || ""; const name = params.get("name")?.trim() || "";
  if ((!title && !name) || title.length > 200 || name.length > 200) return new Response("Invalid title", { status: 400 });
  try { return await cached(`cover-${JSON.stringify([title, name])}`, 86400, async () => { const image = await resolveCover(title, name); return image ? imageResponse(image) : new Response("Cover unavailable", { status: 404 }); }); }
  catch { return new Response("Cover unavailable", { status: 502 }); }
}
