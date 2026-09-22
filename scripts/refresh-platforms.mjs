import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import{fetchNintendoDirect}from'../app/lib/nintendo-feed.ts';import{fetchAnnualFeed}from'../app/lib/release-feed.ts';
import{curatedGames,mergeCatalog,stabilizeCatalogIds}from'../app/lib/catalog.ts';import{matchFranchises}from'../app/lib/franchises.ts';
import snapshot from '../app/data/discovered.json' with {type:'json'};
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');const index=JSON.parse(await readFile(resolve(out,'index.json'),'utf8'));const year=new Date().getUTCFullYear();
let previous=snapshot;try{previous=JSON.parse(await readFile(resolve(out,'catalog.json'),'utf8'));}catch{/*First bootstrap*/}
const [annual,direct]=await Promise.allSettled([fetchAnnualFeed([year,year+1]),fetchNintendoDirect()]);
const sources=[{name:'Nintendo Direct · 日本官方',ok:direct.status==='fulfilled',count:direct.status==='fulfilled'?direct.value.length:0},{name:'Wikipedia · 当年及次年发售索引',ok:annual.status==='fulfilled',count:annual.status==='fulfilled'?annual.value.items.length:0}];
const fresh=mergeCatalog(curatedGames,[...(direct.status==='fulfilled'?direct.value:[]),...(annual.status==='fulfilled'?annual.value.items:[])]);
const items=stabilizeCatalogIds(mergeCatalog(fresh,previous.items),previous.items);
for(const g of items)g.ipIds=matchFranchises([g.title,g.originalTitle,...Object.values(g.names||{}).map(n=>n.text)].join('\n'),index.items).map(ip=>ip.id);
// Official announcements and newly indexed releases extend historical channels,
// but never establish a franchise merely because a headline contains two names.
let changed=0;for(const ip of index.items){const matches=items.filter(g=>g.ipIds.includes(ip.id));if(!matches.length)continue;const file=resolve(out,'series',ip.id+'.json');const channel=JSON.parse(await readFile(file,'utf8'));channel.games=mergeCatalog(matches,channel.games);ip.gameCount=channel.games.length;const years=channel.games.map(g=>g.year||Number((g.releaseDate||'').slice(0,4))).filter(y=>y>1900);if(years.length){ip.firstYear=Math.min(...years);ip.lastYear=Math.max(...years);}await writeFile(file,JSON.stringify(channel));changed++;}
await writeFile(resolve(out,'index.json'),JSON.stringify(index));await writeFile(resolve(out,'catalog.json'),JSON.stringify({items,updatedAt:sources.some(s=>s.ok)?new Date().toISOString():previous.updatedAt,years:[year,year+1],sources,partial:sources.some(s=>!s.ok),stale:sources.every(s=>!s.ok)}));
console.log(JSON.stringify({games:items.length,channelsExtended:changed,sources}));
