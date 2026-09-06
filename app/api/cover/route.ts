import { cached, imageResponse, resolveCover } from "../../lib/server-data";
export async function GET(request: Request) {
  const title = new URL(request.url).searchParams.get("title")?.trim() || "";
  if (!title || title.length > 200) return new Response("Invalid title", { status: 400 });
  try { return await cached(`cover-${title}`, 86400, async () => { const image = await resolveCover(title); return image ? imageResponse(image) : new Response("Cover unavailable", { status: 404 }); }); }
  catch { return new Response("Cover unavailable", { status: 502 }); }
}
