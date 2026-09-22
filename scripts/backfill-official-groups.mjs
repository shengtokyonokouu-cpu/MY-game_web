// Curated source-backed identity bridges also repair missing P179 relationships.
// The pipeline is generic: adding an official group never requires UI changes.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {entities,values,label,aliases} from './catalog-source.mjs';
import groups from '../app/data/official-subseries.json' with {type:'json'};
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');
const index=JSON.parse(await readFile(resolve(out,'index.json'),'utf8'));
const works=await entities(groups.flatMap(g=>g.workEntities));
const related=await entities([...works.values()].flatMap(e=>['P178','P123','P400'].flatMap(p=>values(e,p).map(v=>v.id))));
const channels=new Map();const day=new Date().toISOString().slice(0,10);
for(const group of groups){
  for(const id of [group.id,group.parentId])if(!channels.has(id))channels.set(id,JSON.parse(await readFile(resolve(out,'series',id+'.json'),'utf8')));
  for(const entity of group.workEntities){const e=works.get(entity);if(!e)continue;
    const dates=values(e,'P577').map(d=>({date:d.time.replace(/^\+/,'').slice(0,10),precision:d.precision})).sort((a,b)=>a.date.localeCompare(b.date));const first=dates[0];
    const names=Object.fromEntries(['zh','ja','en'].map(l=>[l,label(e,l)]).filter(([,text])=>text).map(([l,text])=>[l,{text,kind:'index',sourceUrl:'https://www.wikidata.org/wiki/'+entity}]));
    const titles=p=>values(e,p).map(v=>label(related.get(v.id),'zh')||label(related.get(v.id),'en')).filter(Boolean).join(' / ');
    const game={id:'wd-'+entity.toLowerCase(),entityId:entity,title:names.zh?.text||names.ja?.text||names.en?.text,originalTitle:names.en?.text||names.ja?.text||names.zh?.text,names,articleTitle:e.sitelinks?.enwiki?.title||'',developer:titles('P178'),publisher:titles('P123'),region:'',country:'',platforms:values(e,'P400').map(v=>label(related.get(v.id),'en')).filter(Boolean).map(p=>({'Microsoft Windows':'PC','PlayStation 4':'PS4','Nintendo Switch':'Switch'})[p]||p),genres:[],releaseDate:first?.precision>=11?first.date:null,dateLabel:first?first.date.slice(0,first.precision>=11?10:4):'日期待补充',year:first?Number(first.date.slice(0,4)):undefined,declaredStatus:first&&first.date<=day?'released':first?'upcoming':'check',summary:e.descriptions?.zh?.value||'',ipIds:[group.id,group.parentId],subseriesIds:[group.id],editionKind:'original',searchTerms:aliases(e),characterIds:[],source:{label:'官方子系列清单 + Wikidata 作品资料',type:'index',url:group.sourceUrl,checkedAt:day,evidence:group.evidence+'；日期与平台来自对应 Wikidata 实体的最早记录，尚非官方逐项核验。'}};
    for(const id of [group.id,group.parentId]){const c=channels.get(id);const old=c.games.find(g=>g.entityId===entity);if(old){old.ipIds=[...new Set([...old.ipIds,...game.ipIds])];old.subseriesIds=[...new Set([...old.subseriesIds||[],group.id])];}else c.games.push(game);}
  }
}
for(const[id,c]of channels){await writeFile(resolve(out,'series',id+'.json'),JSON.stringify(c));const ip=index.items.find(ip=>ip.id===id);ip.gameCount=c.games.length;ip.originalCount=c.games.filter(g=>g.editionKind==='original'&&g.declaredStatus==='released').length;}
await writeFile(resolve(out,'index.json'),JSON.stringify(index));
console.log('Official group identities reconciled:',channels.size);
