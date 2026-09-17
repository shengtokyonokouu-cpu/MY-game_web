import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fetchAnnualFeed, upstreamHeaders } from "../app/lib/release-feed.ts";
import { games } from "../app/data/games.ts";
import { localizeCatalog } from "../app/lib/localize-catalog.ts";
import { fetchNintendoDirect } from "../app/lib/nintendo-feed.ts";
import { mergeCatalog, stabilizeCatalogIds } from "../app/lib/catalog.ts";
import { enrichStoreNames } from "../app/lib/enrich-store-names.ts";
import { findStoreArtwork } from "../app/lib/store-artwork.ts";
const year = new Date().getUTCFullYear();
const feed = await fetchAnnualFeed([year, year + 1]);
const unique = new Map();
for (const game of feed.items) { const old = unique.get(game.id); if (old) { old.releases.push(...game.releases); old.platforms = [...new Set([...old.platforms, ...game.platforms])]; } else unique.set(game.id, game); }
feed.items = [...unique.values()];
console.log(`Parsed ${feed.items.length} games from ${feed.years.join(', ')}.`);
let direct = [];
try { direct = await fetchNintendoDirect(); } catch (error) { console.log(`Direct unavailable: ${error.message}`); }
const curated = games.filter((game) => game.id !== "xenoblade-x-definitive").map((game) => ({ id: game.id, title: game.originalTitle, articleTitle: game.originalTitle }));
const aliases = { "Fable": "Fable (upcoming video game)", "The Legend of Heroes: Trails beyond the Horizon": "The Legend of Heroes: Kai no Kiseki" };
for (const game of curated) game.articleTitle = aliases[game.articleTitle] || game.articleTitle;
await localizeCatalog([...curated, ...feed.items]);
const directArticles = direct.map((game) => ({ ...game, articleTitle: game.names.ja.text }));
await localizeCatalog(directArticles, "ja");
for (let i = 0; i < direct.length; i++) { direct[i].names = directArticles[i].names; direct[i].title = directArticles[i].title; direct[i].originalTitle = directArticles[i].originalTitle; }
const previous = JSON.parse(await readFile(new URL("../app/data/discovered.json", import.meta.url), "utf8"));
feed.items = stabilizeCatalogIds(mergeCatalog(direct, mergeCatalog(feed.items, previous.items)), previous.items);
feed.sources = [{ name: "Nintendo Direct · 日本官方新作目录", ok: direct.length > 0, count: direct.length }, { name: "Wikipedia · 年度发售索引", ok: !feed.partial, count: feed.items.length }];
const today = Date.now();
await enrichStoreNames([...curated, ...feed.items].sort((a, b) => Number(!!b.events?.length) - Number(!!a.events?.length) || Math.abs(Date.parse(a.releaseDate || `${year + 1}-12-31`) - today) - Math.abs(Date.parse(b.releaseDate || `${year + 1}-12-31`) - today)));
const missingCovers = [...curated.filter((game) => !game.image), ...feed.items.filter((game) => !game.image).sort((a, b) => Math.abs(Date.parse(a.releaseDate || `${year + 1}-12-31`) - today) - Math.abs(Date.parse(b.releaseDate || `${year + 1}-12-31`) - today)).slice(0, 60)];
let storeCovers = 0;
await Promise.all(Array.from({ length: 2 }, async () => { while (missingCovers.length) { const game = missingCovers.shift(); const image = await findStoreArtwork(game.originalTitle || game.title); if (image) { game.image = image; storeCovers++; } } }));
console.log(`Added ${storeCovers} exact-match store covers.`);
await mkdir(new URL("../public/covers/", import.meta.url), { recursive: true }); const coverMap = JSON.parse(await readFile(new URL("../app/data/covers.json", import.meta.url), "utf8"));
await Promise.all(curated.map(async (game) => {
  try {
    if (!game.image) return;
    const response = await fetch(game.image, { headers: upstreamHeaders, signal: AbortSignal.timeout(20000) }); const type = response.headers.get("content-type") || "";
    if (!response.ok || !/^image\/(jpeg|png|webp)/.test(type)) return;
    const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"; const file = `${game.id}.${extension}`;
    await writeFile(new URL(`../public/covers/${file}`, import.meta.url), new Uint8Array(await response.arrayBuffer()));
    coverMap[game.id] = { image: `/covers/${file}`, names: game.names, source: game.image, article: new URL(game.image).hostname.endsWith("wikimedia.org") ? `https://en.wikipedia.org/wiki/${encodeURIComponent((aliases[game.articleTitle] || game.articleTitle).replaceAll(' ', '_'))}` : null };
  } catch { /* The UI reports unavailable covers without breaking the card. */ }
}));
await writeFile(new URL("../app/data/covers.json", import.meta.url), JSON.stringify(coverMap, null, 2) + "\n");
await writeFile(new URL("../app/data/discovered.json", import.meta.url), JSON.stringify(feed, null, 2) + "\n");
console.log(JSON.stringify({ games: feed.items.length, images: feed.items.filter((game) => game.image).length, localCovers: Object.keys(coverMap).length, trilingual: feed.items.filter((game) => game.names?.zh && game.names?.ja && game.names?.en).length, partial: feed.partial }));
