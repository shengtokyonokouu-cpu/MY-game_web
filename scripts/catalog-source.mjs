import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cache = resolve('work/catalog-cache');
let requests = 0;
const limit = Number(process.env.CATALOG_REQUEST_BUDGET || 220);
export const provenance = [];
export async function sourceJSON(url, { ttl = 7 * 86400000, maxBytes = 35_000_000 } = {}) {
  const path = resolve(cache, createHash('sha256').update(url).digest('hex') + '.json');
  try { const saved = JSON.parse(await readFile(path, 'utf8')); if (Date.now() - saved.at < ttl) return saved.data; } catch { /* Cache miss. */ }
  if (++requests > limit) throw new Error('Public-source request budget exhausted; keep last published snapshot');
  console.log(`Source request ${requests}/${limit}: ${new URL(url).hostname}`);
  const response = await fetch(url, { headers: { 'User-Agent': 'ReleaseSignal/3.0 (https://github.com/shengtokyonokouu-cpu/MY-game_web; public game catalog)', Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Source ${response.status}; stop instead of retry storm: ${new URL(url).hostname}`);
  const reader = response.body.getReader(); const parts = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw new Error('Source exceeds byte budget'); } parts.push(value); }
  const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (data.error) throw new Error(`Source API: ${data.error.code || 'error'}`);
  await mkdir(cache, { recursive: true }); await writeFile(path, JSON.stringify({ at: Date.now(), data }));
  return data;
}
export async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  const data = await sourceJSON(url, { maxBytes: 100_000_000 });
  if (!Array.isArray(data.results?.bindings)) throw new Error('Invalid SPARQL response');
  provenance.push({ query, rows: data.results.bindings.length });
  return data.results.bindings.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])));
}
export const qid = uri => uri?.match(/Q\d+$/)?.[0] || '';
export async function entities(ids) {
  const result = new Map(); const unique = [...new Set(ids)].filter(id => /^Q\d+$/.test(id));
  for (let i = 0; i < unique.length; i += 50) {
    const params = new URLSearchParams({ action: 'wbgetentities', ids: unique.slice(i, i + 50).join('|'), props: 'labels|aliases|descriptions|claims|sitelinks', languages: 'zh|zh-cn|zh-hans|zh-hant|zh-tw|ja|en|mul', sitefilter: 'enwiki|jawiki|zhwiki', format: 'json' });
    const data = await sourceJSON('https://www.wikidata.org/w/api.php?' + params);
    for (const [id, entity] of Object.entries(data.entities || {})) result.set(id, entity);
  }
  return result;
}
export const values = (entity, property) => (entity?.claims?.[property] || []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
export const label = (entity, lang) => (lang === 'zh' ? ['zh-cn', 'zh-hans', 'zh', 'zh-tw', 'zh-hant'] : lang === 'en' ? ['en', 'mul'] : ['ja']).map(k => entity?.labels?.[k]?.value).find(Boolean) || '';
export const aliases = entity => [...new Set([...Object.values(entity?.labels || {}).map(v => v.value), ...Object.values(entity?.aliases || {}).flat().map(v => v.value)])];
