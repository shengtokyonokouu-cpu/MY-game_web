import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newsSources, parseNews } from '../app/lib/news.ts';
import { matchFranchises } from '../app/lib/franchises.ts';
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');
const index=JSON.parse(await readFile(resolve(out,'index.json'),'utf8'));
const search=JSON.parse(await readFile(resolve(out,'search.json'),'utf8'));
let previous={items:[],fetchedAt:'',sources:[]};try{previous=JSON.parse(await readFile(resolve(out,'news.json'),'utf8'));}catch{/*First bootstrap.*/}
const maxRequests=Number(process.env.NEWS_REQUEST_BUDGET||60);let requests=0;
async function readFeed(source,url=source.url){
  let response;
  for(let hop=0;hop<3;hop++){
    if(++requests>maxRequests)throw new Error('News request budget exhausted');
    response=await fetch(url,{headers:{'User-Agent':'ReleaseSignal/3.0 (+https://release-signal.pages.dev)',Accept:'application/rss+xml,application/xml,text/xml'},redirect:'manual',signal:AbortSignal.timeout(18000)});
    if(![301,302,303,307,308].includes(response.status))break;
    const next=new URL(response.headers.get('location')||'',url);await response.body?.cancel();if(next.origin!==new URL(source.site).origin||next.username||next.password)throw new Error('Cross-origin feed redirect refused');url=next.href;
  }
  if(!response.ok)throw new Error('HTTP '+response.status);
  const reader=response.body.getReader();let length=0;const parts=[];
  for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>2_000_000){await reader.cancel();throw new Error('RSS size budget');}parts.push(value);}
  const items=parseNews(Buffer.concat(parts).toString('utf8'),source);if(!items.length)throw new Error('No valid entries');return items;
}
const health=[];const fresh=[];
// Bounded concurrency, no automatic retry. Failed sources keep their old data.
const retagOnly=process.argv.includes('--retag-only');
if(retagOnly)health.push(...previous.sources);
else for(let i=0;i<newsSources.length;i+=2){await Promise.all(newsSources.slice(i,i+2).map(async source=>{try{const items=await readFeed(source);fresh.push(...items);health.push({id:source.id,name:source.name,ok:true,count:items.length});}catch(e){health.push({id:source.id,name:source.name,ok:false,count:0});console.warn(source.id,e.message);}}));}
if(!retagOnly&&!fresh.length)throw new Error('All news sources failed; leave last published snapshot unchanged');
const priority=['atelier','kirby','devil-may-cry','star-ocean','monster-hunter','persona','final-fantasy','zelda','pokemon','trails','xenoblade','fire-emblem'];
const roots=index.items.filter(ip=>!ip.parentIds?.length).sort((a,b)=>b.gameCount-a.gameCount);
const offset=(Math.floor(Date.now()/10800000)*5)%Math.max(1,roots.length);
const candidates=process.argv.includes('--wide')?roots.slice(0,80):process.argv.includes('--bootstrap')?priority.map(id=>index.items.find(ip=>ip.id===id)).filter(Boolean):[...roots,...roots].slice(offset,offset+5);
for(const ip of retagOnly?[]:candidates){for(const sourceId of process.argv.includes('--wide')?['gematsu']:['gematsu','playstation-ja','playstation-zh']){
  if(requests>=maxRequests)break;
  const source=newsSources.find(s=>s.id===sourceId);const term=sourceId.endsWith('-ja')?ip.ja:sourceId.endsWith('-zh')?ip.name:ip.en;if(!term)continue;
  const url=new URL(sourceId==='gematsu'?source.site+'/':source.url);if(sourceId==='gematsu')url.searchParams.set('feed','rss2');url.searchParams.set('s',term.replace(/系列$|シリーズ$|\s+series$/i,''));
  try{fresh.push(...await readFeed(source,url.href));}catch{/*A source may not support a search feed; no invented news.*/}
}}
const forbidden=new Set(['new','lost','control','trails','shift','air','love','black','white','dark','one','it','the','project','world','evolution','不可思议','不可思議']);
const rules=index.items.map(ip=>({...ip,aliases:[...ip.aliases,ip.en,ip.ja,ip.name].filter(a=>a&&a.length>=3&&!forbidden.has(a.toLowerCase()))}));
const workRules=search.filter(g=>g.ipIds.length).map(g=>({id:g.id,aliases:g.names.filter(n=>n.length>=(/^[\x20-\x7E]+$/.test(n)?10:5)),ipIds:g.ipIds}));
const byId=new Map(index.items.map(ip=>[ip.id,ip]));
function tag(article){const text=article.title+'\n'+article.excerpt;const ids=new Set(matchFranchises(text,rules).map(ip=>ip.id));for(const work of matchFranchises(text,workRules))for(const id of work.ipIds)ids.add(id);const addParents=id=>{for(const p of byId.get(id)?.parentIds||[])if(!ids.has(p)){ids.add(p);addParents(p);}};for(const id of ids)addParents(id);return{...article,ipIds:[...ids].filter(id=>byId.has(id)).slice(0,100)};}
const items=[...new Map([...previous.items,...fresh].map(a=>[a.url,tag(a)])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,6000);
const now=Date.now();for(const ip of index.items){const related=items.filter(a=>a.ipIds.includes(ip.id));ip.newsCount=related.length;ip.recentCount=related.filter(a=>now-Date.parse(a.publishedAt)<86400000).length;ip.previousCount=related.filter(a=>now-Date.parse(a.publishedAt)>=86400000&&now-Date.parse(a.publishedAt)<172800000).length;ip.rising=ip.recentCount>=6&&ip.recentCount>=Math.max(1,ip.previousCount)*2;ip.latestNewsAt=related[0]?.publishedAt;}
const feed={items,fetchedAt:retagOnly?previous.fetchedAt:new Date().toISOString(),sources:health,stale:false,updateIntervalHours:3,requestCount:requests};
await writeFile(resolve(out,'news.json'),JSON.stringify(feed));await writeFile(resolve(out,'index.json'),JSON.stringify(index));
console.log(JSON.stringify({articles:items.length,requests,sources:health,priority:priority.map(id=>({id,count:index.items.find(ip=>ip.id===id)?.newsCount||0}))}));
