const titleKey = (value: string) => value.replace(/[™®]/g, "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function exactStoreTitle(expected: string, actual: string) { return !!expected.trim() && titleKey(expected) === titleKey(actual); }

// Exact title + the store's game type are required. Never take the first fuzzy
// result: that could be a soundtrack, an older numbered game or another edition.
export async function findStoreArtwork(title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ term: title, l: "english", cc: "us" });
    const response = await fetch(`https://store.steampowered.com/api/storesearch/?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const data = await response.json() as { items?: { id: number; name: string }[] };
    const matches = (data.items || []).filter((item) => Number.isSafeInteger(item.id) && exactStoreTitle(title, item.name));
    if (matches.length !== 1) return null;
    const item = matches[0];
    const details = await fetch(`https://store.steampowered.com/api/appdetails?appids=${item.id}&l=english&cc=us`, { signal: AbortSignal.timeout(7000) });
    if (!details.ok) return null;
    const app = (await details.json() as Record<string, { data?: { type: string; name: string; header_image?: string } }>)[item.id]?.data;
    if (app?.type !== "game" || !exactStoreTitle(title, app.name) || !app.header_image) return null;
    const image = new URL(app.header_image);
    return image.protocol === "https:" && !image.username && !image.password && !image.port && ["shared.fastly.steamstatic.com", "shared.akamai.steamstatic.com", "cdn.akamai.steamstatic.com", "cdn.cloudflare.steamstatic.com", "cdn.steamstatic.com", "steamcdn-a.akamaihd.net"].includes(image.hostname) ? image.href : null;
  } catch { return null; }
}
