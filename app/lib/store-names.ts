import { exactStoreTitle } from "./store-artwork.ts";
import { detectLanguage, type GameNames } from "./game-names.ts";

// Names/images only: enrichment never changes a game's dates or platforms.
export async function findStoreNames(title: string): Promise<{ names: GameNames; image?: string } | null> {
  const languages = { zh: "schinese", ja: "japanese", en: "english" } as const;
  const preferred = detectLanguage(title), signal = AbortSignal.timeout(12000);
  const expected = title.replace(/\s*\([^)]*video game[^)]*\)/gi, "");
  const params = new URLSearchParams({ term: expected, l: languages[preferred], cc: "us" });
  const response = await fetch(`https://store.steampowered.com/api/storesearch/?${params}`, { signal });
  if (!response.ok) throw new Error("Steam name lookup unavailable");
  const data = await response.json() as { items?: { id: number; name: string }[] };
  const matches = (data.items || []).filter((item) => Number.isSafeInteger(item.id) && item.id > 0 && exactStoreTitle(expected, item.name));
  if (matches.length !== 1) return null;
  const id = matches[0].id;
  const records = await Promise.allSettled(Object.entries(languages).map(async ([language, value]) => {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=${value}&cc=us`, { signal });
    if (!response.ok) throw new Error("Steam locale unavailable");
    const app = (await response.json() as Record<string, { data?: { type: string; name: string; header_image?: string } }>)[id]?.data;
    return app?.type === "game" && app.name ? { language, app, sourceUrl: `https://store.steampowered.com/app/${id}/?l=${value}` } : null;
  }));
  const valid = records.flatMap((record) => record.status === "fulfilled" && record.value ? [record.value] : []);
  if (records.every((record) => record.status === "rejected")) throw new Error("Steam regional details temporarily unavailable");
  const identity = valid.find((record) => record.language === preferred);
  if (!identity || !exactStoreTitle(expected, identity.app.name)) return null;
  return { names: Object.fromEntries(valid.map(({ language, app, sourceUrl }) => [language, { text: app.name, kind: "store", sourceUrl }])), image: identity.app.header_image };
}
