// Offline only. No Cloudflare bindings, D1 scans, credentials, or paid APIs.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sparql, qid, entities, provenance } from './catalog-source.mjs';

const out = resolve(process.env.CATALOG_OUTPUT || 'public/data');
const checkedAt = new Date().toISOString();
const gameScope = '?g wdt:P31/wdt:P279* wd:Q7889; wdt:P179 ?s.';
const memberships = await sparql(`SELECT DISTINCT ?g ?s WHERE { ${gameScope} }`);
const counts = new Map();
for (const r of memberships) { const id = qid(r.s); const set = counts.get(id) || new Set(); set.add(qid(r.g)); counts.set(id, set); }
const seriesEntities = await entities([...counts].filter(([, games]) => games.size >= 2).map(([id]) => id));
console.log(`Discovered ${seriesEntities.size} series candidates from ${memberships.length} memberships`);
await mkdir(resolve(out, 'series'), { recursive: true });
await writeFile(resolve('work/series-discovery.json'), JSON.stringify({ checkedAt, memberships, entities: Object.fromEntries(seriesEntities), provenance }));
console.log('Discovery cached; building chronology next');
