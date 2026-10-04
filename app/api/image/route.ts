import { imageResponse } from "../../lib/server-data";
export async function GET(request: Request) { try { return await imageResponse(new URL(request.url).searchParams.get("url") || ""); } catch { return new Response("Image unavailable", { status: 502 }); } }
