import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import{sparql,qid,entities,values,label,aliases}from'./catalog-source.mjs';
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');const index=JSON.parse(await readFile(resolve(out,'index.json'),'utf8'));const byEntity=new Map(index.items.filter(ip=>ip.entityId).map(ip=>[ip.entityId,ip]));
// "Based on" alone is NOT sufficient. Require the explicit remake/remaster role
// qualifier; inspired-by games and licensed adaptations do not inherit an IP.
const rows=await sparql('SELECT DISTINCT ?g ?base ?s ?role WHERE { VALUES ?role {wd:Q4393107 wd:Q65963104} ?g p:P144 ?statement. ?statement ps:P144 ?base; pq:P2868 ?role. ?base wdt:P179 ?s. }');
const candidates=rows.filter(r=>byEntity.has(qid(r.s)));const editions=await entities(candidates.map(r=>qid(r.g)));
const related=await entities([...editions.values()].flatMap(e=>['P400','P178','P123'].flatMap(p=>values(e,p).map(v=>v.id))));
const channels=new Map();const day=new Date().toISOString().slice(0,10);let added=0;
for(const e of editions.values()){
  const target=candidates.filter(r=>qid(r.g)===e.id).map(r=>byEntity.get(qid(r.s)));if(!target.length)continue;
  const names=Object.fromEntries(['zh','ja','en'].map(l=>[l,label(e,l)]).filter(([,v])=>v).map(([l,text])=>[l,{text,kind:'index',sourceUrl:'https://www.wikidata.org/wiki/'+e.id}]));if(!Object.keys(names).length)continue;
  const dates=values(e,'P577').map(d=>({date:d.time.replace(/^\+/, '').slice(0,10),precision:d.precision})).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)).sort((a,b)=>a.date.localeCompare(b.date));const first=dates[0];
  const titles=p=>values(e,p).map(v=>label(related.get(v.id),'zh')||label(related.get(v.id),'en')).filter(Boolean).join(' / ');
  const platform=p=>({'Microsoft Windows':'PC','Nintendo Switch':'Switch','Nintendo Switch 2':'Switch 2','PlayStation 5':'PS5','PlayStation 4':'PS4'})[p]||p;
  const ipIds=new Set(target.map(ip=>ip.id));for(const id of ipIds)for(const p of index.items.find(ip=>ip.id===id)?.parentIds||[])ipIds.add(p);
  const game={id:'wd-'+e.id.toLowerCase(),entityId:e.id,title:names.zh?.text||names.ja?.text||names.en?.text,originalTitle:names.en?.text||names.ja?.text||names.zh?.text,names,developer:titles('P178'),publisher:titles('P123'),region:'未标注',country:'未标注',platforms:values(e,'P400').map(v=>platform(label(related.get(v.id),'en'))).filter(Boolean),genres:[],releaseDate:first?.precision>=11?first.date:null,dateLabel:first?first.date.slice(0,first.precision>=11?10:first.precision>=10?7:4):'日期待补充',year:first?Number(first.date.slice(0,4)):undefined,declaredStatus:first&&first.date<=day?'released':first?'upcoming':'check',summary:e.descriptions?.zh?.value||'',articleTitle:e.sitelinks?.enwiki?.title||'',searchTerms:aliases(e),ipIds:[...ipIds],editionKind:'remake',characterIds:[],source:{label:'Wikidata · 明确重制 / 复刻关系',url:'https://www.wikidata.org/wiki/'+e.id,checkedAt:day,evidence:'P144 原作关系及 P2868 重制/复刻限定。不是依据标题相似推断；版本不重复计入独立作品门槛。',type:'index'}};
  for(const id of ipIds){const ip=index.items.find(ip=>ip.id===id);if(!ip)continue;let c=channels.get(id);if(!c){c=JSON.parse(await readFile(resolve(out,'series',id+'.json'),'utf8'));channels.set(id,c);}const existing=c.games.find(g=>g.entityId===e.id);if(existing){existing.editionKind='remake';continue;}c.games.push(game);added++;ip.gameCount=c.games.length;if(game.year)ip.lastYear=Math.max(ip.lastYear||0,game.year);}
}
for(const[id,c]of channels)await writeFile(resolve(out,'series',id+'.json'),JSON.stringify(c));await writeFile(resolve(out,'index.json'),JSON.stringify(index));console.log(JSON.stringify({verifiedEditionRelations:candidates.length,editions:editions.size,channelRecordsAdded:added}));
