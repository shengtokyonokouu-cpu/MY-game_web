import { readFile, writeFile } from "node:fs/promises";
import { enrichStoreNames } from "../app/lib/enrich-store-names.ts";
const file = new URL("../app/data/discovered.json", import.meta.url);
const feed = JSON.parse(await readFile(file, "utf8"));
const today = Date.now();
const candidates = [...feed.items].sort((a, b) => Number(!!b.events?.length) - Number(!!a.events?.length) || Math.abs(Date.parse(a.releaseDate || "2027-12-31") - today) - Math.abs(Date.parse(b.releaseDate || "2027-12-31") - today));
const updated = await enrichStoreNames(candidates);
await writeFile(file, JSON.stringify(feed, null, 2) + "\n");
console.log(JSON.stringify({ updated, total: feed.items.length, trilingual: feed.items.filter((game) => game.names?.zh && game.names?.ja && game.names?.en).length }));
