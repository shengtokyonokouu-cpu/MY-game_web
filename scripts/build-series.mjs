import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { qid, entities, values, label, aliases, sparql } from './catalog-source.mjs';
import { franchises as legacy } from '../app/lib/franchises.ts';
import officialGroups from '../app/data/official-subseries.json' with { type: 'json' };

const output = resolve(process.env.CATALOG_OUTPUT || 'public/data');
const discovery = JSON.parse(await readFile('work/series-discovery.json', 'utf8'));
const facts = JSON.parse(await readFile('work/series-facts.json', 'utf8'));
const names = JSON.parse(await readFile('work/series-names.json', 'utf8'));
const pages = new Map(JSON.parse(await readFile('work/series-pages.json', 'utf8')).map(r => [qid(r.g), r.page]));
const checkedAt = new Date().toISOString(); const day = checkedAt.slice(0, 10);
const source = id => 'https://www.wikidata.org/wiki/' + id;
const factsByGame = new Map(); const namesByGame = new Map();
for (const f of facts) { const id = qid(f.g); const row = factsByGame.get(id) || {}; const prop = f.p.split('/').at(-1); (row[prop] ||= new Set()).add(f.v); factsByGame.set(id, row); }
for (const n of names) { const id = qid(n.g); const row = namesByGame.get(id) || []; row.push(n); namesByGame.set(id, row); }
const precisions = await sparql('SELECT DISTINCT ?g ?date ?precision WHERE { ?g wdt:P31/wdt:P279* wd:Q7889; wdt:P179 ?s; p:P577 ?statement. ?statement psv:P577 ?time. ?time wikibase:timeValue ?date; wikibase:timePrecision ?precision. }');
const dates = new Map(); for (const r of precisions) { const list = dates.get(qid(r.g)) || []; list.push({ date: r.date.slice(0, 10), precision: Number(r.precision) }); dates.set(qid(r.g), list); }
// Entity identity, not substring guesses: P179/P361/P527 establish ancestry.
const graph = new Map(Object.entries(discovery.entities));
const parentEntityIds = [...graph.values()].flatMap(e => ['P179', 'P361', 'P8345'].flatMap(p => values(e, p).map(v => v.id))).filter(id => id && !graph.has(id));
for (const [id, e] of await entities(parentEntityIds)) graph.set(id, e);
const relatedIds = facts.filter(f => ['P400','P178','P123','P674','P31'].includes(f.p.split('/').at(-1))).map(f => qid(f.v));
const related = await entities(relatedIds);
const seriesTypes = new Set(['Q7058673', 'Q196600']);
const eligible = e => values(e, 'P31').some(v => seriesTypes.has(v.id));
const graphIds = new Set([...graph.values()].filter(eligible).map(e => e.id));
const parents = new Map();
function edge(child, parent) { if (child !== parent && graphIds.has(child) && graphIds.has(parent)) { const set = parents.get(child) || new Set(); set.add(parent); parents.set(child, set); } }
for (const e of graph.values()) {
  for (const p of ['P179','P361','P8345']) for (const v of values(e, p)) edge(e.id, v.id);
  for (const v of values(e, 'P527')) edge(v.id, e.id);
}
function ancestors(id, visited = new Set()) { if (visited.has(id)) return visited; visited.add(id); for (const p of parents.get(id) || []) ancestors(p, visited); return visited; }
const memberships = new Map();
for (const r of discovery.memberships) { const id = qid(r.g); const set = memberships.get(id) || new Set(); for (const p of ancestors(qid(r.s))) if (graphIds.has(p)) set.add(p); memberships.set(id, set); }
for (const e of graph.values()) if (graphIds.has(e.id)) for (const v of values(e, 'P527')) if (factsByGame.has(v.id)) { const set = memberships.get(v.id) || new Set(); for (const p of ancestors(e.id)) set.add(p); memberships.set(v.id, set); }
// Stable public IDs keep existing follows/bookmarks. Other franchises use QIDs.
const stable = new Map([['Q2569953','kirby'],['Q857825','atelier'],['Q436567','devil-may-cry'],['Q2303554','star-ocean'],['Q13822229','monster-hunter'],['Q1083352','persona'],['Q99416119','final-fantasy'],['Q20073229','trails']]);
for (const e of graph.values()) { const terms = aliases(e).map(s => s.toLowerCase()); const old = legacy.find(ip => terms.includes(ip.en.toLowerCase()) || terms.includes(ip.ja.toLowerCase())); if (old && ![...stable.values()].includes(old.id)) stable.set(e.id, old.id); }
const idFor = id => stable.get(id) || 'wd-' + id.toLowerCase();
const chars = {};
for (const id of new Set(facts.filter(f => f.p.endsWith('/P674')).map(f => qid(f.v)))) {
  const e = related.get(id); if (!e || !aliases(e).length) continue;
  const image = values(e, 'P18')[0];
  chars[id] = { id, name: label(e,'zh') || label(e,'ja') || label(e,'en'), ja: label(e,'ja'), en: label(e,'en'), description: e.descriptions?.['zh-cn']?.value || e.descriptions?.zh?.value || e.descriptions?.ja?.value || e.descriptions?.en?.value || '暂无可核验的人物介绍。', ...(image ? { image: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(image) + '?width=480', imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(image) } : {}), sourceUrl: source(id), credit: '角色及作品权利归原权利人；如有图片，授权信息见图片来源页。', role: 'cast' };
}
const normalizePlatform = name => ({ 'Microsoft Windows':'PC', 'Nintendo Switch':'Switch', 'Nintendo Switch 2':'Switch 2', 'PlayStation 5':'PS5', 'PlayStation 4':'PS4' })[name] || name;
const works = [];
for (const [entityId, ipEntities] of memberships) {
  if (!ipEntities.size) continue;
  const f = factsByGame.get(entityId) || {}; const n = namesByGame.get(entityId) || [];
  const named = lang => { const order = lang === 'zh' ? ['zh-cn','zh-hans','zh','zh-tw','zh-hant'] : lang === 'en' ? ['en','mul'] : ['ja']; return order.map(l => n.find(v => v.lang === l && v.kind.endsWith('#label'))?.name).find(Boolean) || ''; };
  const zh = named('zh'), ja = named('ja'), en = named('en'); if (!zh && !ja && !en) continue;
  const releases = (dates.get(entityId) || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).sort((a,b) => a.date.localeCompare(b.date) || b.precision-a.precision);
  const first = releases[0]; const dateLabel = first ? first.date.slice(0, first.precision >= 11 ? 10 : first.precision >= 10 ? 7 : 4) : '日期待补充';
  const classes = [...f.P31 || []].map(v => label(related.get(qid(v)), 'en')).join(' ');
  const editionKind = /remake|remaster/i.test(classes) || /\b(remake|remastered|HD remaster)\b/i.test(en) ? 'remake' : /compilation|collection/i.test(classes) ? 'collection' : 'original';
  const textFor = p => [...f[p] || []].map(v => { const e = related.get(qid(v)); return label(e,'zh') || label(e,'en') || label(e,'ja'); }).filter(Boolean).join(' / ');
  const page = pages.get(entityId); const image = [...f.P18 || []][0];
  const gameNames = Object.fromEntries([['zh',zh],['ja',ja],['en',en]].filter(([,v]) => v).map(([k,text]) => [k,{ text, sourceUrl: source(entityId), kind:'index' }]));
  const game = { id: 'wd-' + entityId.toLowerCase(), entityId, title: zh || ja || en, originalTitle: en || ja || zh, names: gameNames, developer: textFor('P178'), publisher: textFor('P123'), region:'未标注', country:'未标注', platforms:[...f.P400 || []].map(v => { const e=related.get(qid(v)); return normalizePlatform(label(e,'en') || label(e,'zh')); }).filter(Boolean), genres:[], releaseDate:first?.precision >= 11 ? first.date : null, dateLabel, year:first ? Number(first.date.slice(0,4)) : undefined, declaredStatus:first && first.date <= day ? 'released' : first ? 'upcoming' : 'check', summary:n.find(v => v.kind.endsWith('/description') && ['zh','zh-cn'].includes(v.lang))?.name || '', articleTitle:page ? decodeURIComponent(new URL(page).pathname.slice(6)).replaceAll('_',' ') : '', searchTerms:[...new Set(n.filter(v => !v.kind.endsWith('/description')).map(v => v.name))], ipIds:[...ipEntities].map(idFor), subseriesIds:[...ipEntities].filter(id => parents.has(id)).map(idFor), editionKind, characterIds:[...f.P674 || []].map(qid).filter(id => chars[id]), ...(image ? {image:image.replace(/^http:/,'https:')} : {}), source:{label:'Wikidata · 作品与系列关系',url:source(entityId),checkedAt:day,evidence:'公开知识库索引：P179/P527 系列关系、P577 最早记录。非官方全作品清单；各地区/移植时间可能不同。',type:'index'} };
  const cancelled = n.some(v=>v.kind.endsWith('/description')&&/cancelled|canceled|开发中止|開発中止|开发取消/i.test(v.name));
  if(cancelled)game.declaredStatus='check';
  else if(first && first.precision<11 && first.date.slice(0,first.precision>=10?7:4)===day.slice(0,first.precision>=10?7:4))game.declaredStatus='check';
  works.push(game);
}
const grouped = new Map(); for (const g of works) for (const id of g.ipIds) { const list = grouped.get(id) || []; list.push(g); grouped.set(id,list); }
const items = [];
for (const [entityId,e] of graph) {
  if (!graphIds.has(entityId)) continue; const id = idFor(entityId); const games = grouped.get(id) || [];
  const originals = games.filter(g => g.editionKind === 'original' && g.declaredStatus === 'released');
  if (originals.length < 2) continue;
  const old = legacy.find(ip => ip.id === id); const years = games.map(g => g.year).filter(Boolean);
  const ip = { ...old, id, entityId, name:old?.name || label(e,'zh') || label(e,'ja') || label(e,'en'), ja:old?.ja || label(e,'ja'), en:old?.en || label(e,'en'), description:e.descriptions?.['zh-cn']?.value || e.descriptions?.zh?.value || '系列作品年表、发售计划与中日英动态。', aliases:[...new Set([...aliases(e),...old?.aliases || []])].filter(Boolean), sourceUrl:values(e,'P856').find(v => /^https:\/\//.test(v)) || source(entityId), color:old?.color || ['blue','green','amber','red'][Number(entityId.slice(1))%4], gameCount:games.length, originalCount:originals.length, parentIds:[...parents.get(entityId) || []].map(idFor), childIds:[], firstYear:years.length?Math.min(...years):undefined,lastYear:years.length?Math.max(...years):undefined, platforms:[...new Set(games.flatMap(g => g.platforms))], updatedAt:Date.parse(checkedAt), newsCount:0, coverage:'索引覆盖；尚未逐项通过官方完整清单核验' };
  if (!ip.name) continue; items.push(ip);
}
for (const group of officialGroups) {
  const root = items.find(ip=>ip.id===group.parentId); if(!root)continue;
  const members=works.filter(g=>group.workEntities.includes(g.entityId)); if(members.length<2)continue;
  for(const g of members){g.ipIds=[...new Set([...g.ipIds,group.id,group.parentId])];g.subseriesIds=[...new Set([...g.subseriesIds,group.id])];}
  grouped.set(group.id,members);
  items.push({id:group.id,name:group.name,ja:group.ja,en:group.en,aliases:group.aliases.filter(a=>!['不可思议','不可思議'].includes(a)),searchAliases:group.aliases,description:group.evidence,sourceUrl:group.sourceUrl,color:root.color,parentIds:[root.id],childIds:[],gameCount:members.length,originalCount:members.filter(g=>g.editionKind==='original').length,firstYear:Math.min(...members.map(g=>g.year).filter(Boolean)),lastYear:Math.max(...members.map(g=>g.year).filter(Boolean)),platforms:[...new Set(members.flatMap(g=>g.platforms))],coverage:'子系列归属经官方来源核验；版本记录仍在补齐',updatedAt:Date.parse(checkedAt),newsCount:0});
  root.searchAliases=[...root.searchAliases||[],...group.aliases];
}
for(const ip of legacy)if(!items.some(i=>i.id===ip.id))items.push({...ip,gameCount:0,originalCount:0,parentIds:[],childIds:[],coverage:'保留的专题频道 · 未达到双作品建档条件'});
const validIds = new Set(items.map(ip=>ip.id));
for(const game of works){game.ipIds=game.ipIds.filter(id=>validIds.has(id));game.subseriesIds=game.subseriesIds.filter(id=>validIds.has(id));}
for (const ip of items) { ip.parentIds=ip.parentIds.filter(id=>validIds.has(id)); ip.childIds=items.filter(child=>child.parentIds.includes(ip.id)).map(child=>child.id); }
// Include work names in the search-only index, not in broad news mention rules.
const search = works.map(g => ({id:g.id,names:[...new Set([g.title,g.originalTitle,...Object.values(g.names).map(n=>n.text),...g.searchTerms])],ipIds:g.ipIds.filter(id=>validIds.has(id))}));
for(const ip of items)ip.searchAliases=[...new Set([...(ip.searchAliases||[]),...(grouped.get(ip.id)||[]).flatMap(g=>[g.title,g.originalTitle,...Object.values(g.names).map(n=>n.text)])])];
await mkdir(resolve(output,'series'),{recursive:true});
for (const ip of items) {
  const games=(grouped.get(ip.id)||[]).sort((a,b)=>(a.year||9999)-(b.year||9999)||(a.releaseDate||'').localeCompare(b.releaseDate||'')||a.title.localeCompare(b.title));
  const characterIds=new Set(games.flatMap(g=>g.characterIds));
  await writeFile(resolve(output,'series',ip.id+'.json'),JSON.stringify({id:ip.id,updatedAt:checkedAt,games,characters:Object.fromEntries([...characterIds].map(id=>[id,chars[id]])),coverage:ip.coverage}));
}
const index={version:1,updatedAt:checkedAt,items:items.sort((a,b)=>b.gameCount-a.gameCount),stats:{channels:items.length,works:works.filter(g=>g.ipIds.some(id=>validIds.has(id))).length,characters:Object.keys(chars).length,withDates:works.filter(g=>g.year).length},coverage:'按至少两部非重制/合集作品自动建立频道；知识库并非完整官方目录，保留未补齐状态。',sources:[{name:'Wikidata · CC0 structured data',url:'https://www.wikidata.org/wiki/Wikidata:Licensing'},{name:'Nintendo 官方新作',url:'https://www.nintendo.com/jp/nintendo-direct/index.html'},{name:'PlayStation 官方新闻',url:'https://blog.playstation.com/'},{name:'Xbox 官方新闻',url:'https://news.xbox.com/'}]};
await writeFile(resolve(output,'index.json'),JSON.stringify(index));
await writeFile(resolve(output,'search.json'),JSON.stringify(search));
await writeFile(resolve(output,'characters.json'),JSON.stringify(chars));
console.log(JSON.stringify(index.stats));
console.log(items.filter(ip=>['atelier','kirby','devil-may-cry','star-ocean','monster-hunter','persona','final-fantasy','zelda','trails'].includes(ip.id)).map(ip=>({id:ip.id,games:ip.gameCount,first:ip.firstYear,last:ip.lastYear,children:ip.childIds})));
