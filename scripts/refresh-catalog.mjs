import { mkdir, writeFile } from "node:fs/promises";
import { fetchAnnualFeed, upstreamHeaders } from "../app/lib/release-feed.ts";
import { games } from "../app/data/games.ts";
import { trustedGamePage } from "../app/lib/game-artwork.ts";
import { findStoreArtwork } from "../app/lib/store-artwork.ts";
const year = new Date().getUTCFullYear();
const feed = await fetchAnnualFeed([year, year + 1]);
const unique = new Map();
for (const game of feed.items) { const old = unique.get(game.id); if (old) { old.releases.push(...game.releases); old.platforms = [...new Set([...old.platforms, ...game.platforms])]; } else unique.set(game.id, game); }
feed.items = [...unique.values()];
console.log(`Parsed ${feed.items.length} games from ${feed.years.join(', ')}.`);
const curated = games.filter((game) => game.id !== "xenoblade-x-definitive").map((game) => ({ id: game.id, title: game.originalTitle, articleTitle: game.originalTitle }));
const aliases = { "Fable": "Fable (upcoming video game)", "The Legend of Heroes: Trails beyond the Horizon": "The Legend of Heroes: Kai no Kiseki" };
const all = [...curated, ...feed.items.filter((game) => game.articleTitle)]; const chunks = []; for (let i = 0; i < all.length; i += 40) chunks.push(all.slice(i, i + 40)); let batch = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (chunks.length) {
    const chunk = chunks.shift();
    try {
      const params = new URLSearchParams({ action: "query", titles: chunk.map((game) => aliases[game.articleTitle] || game.articleTitle).join("|"), redirects: "1", prop: "pageimages|langlinks", piprop: "thumbnail", pilicense: "any", pilimit: "40", pithumbsize: "640", lllang: "zh", lllimit: "40", format: "json", formatversion: "2" });
      const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: upstreamHeaders, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`); const data = await response.json();
      for (const game of chunk) { const page = trustedGamePage(aliases[game.articleTitle] || game.articleTitle, data); if (!page) continue; if (page.thumbnail?.source) game.image = page.thumbnail.source; const translated = page.langlinks?.find((link) => link.lang === "zh")?.title; if (translated && !curated.includes(game)) game.title = translated; }
    } catch (error) { console.log(`Image batch skipped: ${error.message}`); }
    console.log(`Image batch ${++batch} complete.`);
  }
}));
const today = Date.now();
const missingCovers = [...curated.filter((game) => !game.image), ...feed.items.filter((game) => !game.image).sort((a, b) => Math.abs(Date.parse(a.releaseDate || `${year + 1}-12-31`) - today) - Math.abs(Date.parse(b.releaseDate || `${year + 1}-12-31`) - today)).slice(0, 60)];
let storeCovers = 0;
await Promise.all(Array.from({ length: 2 }, async () => { while (missingCovers.length) { const game = missingCovers.shift(); const image = await findStoreArtwork(game.originalTitle || game.title); if (image) { game.image = image; storeCovers++; } } }));
console.log(`Added ${storeCovers} exact-match store covers.`);
await mkdir(new URL("../public/covers/", import.meta.url), { recursive: true }); const coverMap = {};
await Promise.all(curated.map(async (game) => {
  try {
    if (!game.image) return;
    const response = await fetch(game.image, { headers: upstreamHeaders, signal: AbortSignal.timeout(20000) }); const type = response.headers.get("content-type") || "";
    if (!response.ok || !/^image\/(jpeg|png|webp)/.test(type)) return;
    const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"; const file = `${game.id}.${extension}`;
    await writeFile(new URL(`../public/covers/${file}`, import.meta.url), new Uint8Array(await response.arrayBuffer()));
    coverMap[game.id] = { image: `/covers/${file}`, source: game.image, article: new URL(game.image).hostname.endsWith("wikimedia.org") ? `https://en.wikipedia.org/wiki/${encodeURIComponent((aliases[game.articleTitle] || game.articleTitle).replaceAll(' ', '_'))}` : null };
  } catch { /* The UI reports unavailable covers without breaking the card. */ }
}));
await writeFile(new URL("../app/data/covers.json", import.meta.url), JSON.stringify(coverMap, null, 2) + "\n");
await writeFile(new URL("../app/data/discovered.json", import.meta.url), JSON.stringify(feed, null, 2) + "\n");
console.log(JSON.stringify({ games: feed.items.length, images: feed.items.filter((game) => game.image).length, localCovers: Object.keys(coverMap).length, partial: feed.partial }));
