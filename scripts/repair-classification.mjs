// Offline, repeatable repair. No D1 queries, network requests or private records.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {claimIds} from '../app/lib/game-identity.ts';
import {identityNames} from '../app/lib/game-names.ts';
import {membershipResolver} from '../app/lib/catalog-membership.ts';
import {verifiedWorkFacts} from '../app/lib/verified-work-facts.ts';
import groups from '../app/data/official-subseries.json' with {type:'json'};
import official from '../app/data/verified-memberships.json' with {type:'json'};
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const index=await read(resolve(out,'index.json'));
const channels=new Map();for(const ip of index.items)channels.set(ip.id,await read(resolve(out,'series',ip.id+'.json')));
let records;
if(process.argv.includes('--rebuild')){
  const discovery=await read('work/series-discovery.json');
  const byEntity=new Map(index.items.filter(ip=>ip.entityId).map(ip=>[ip.entityId,ip]));
  const byId=new Map(index.items.map(ip=>[ip.id,ip]));const memberships=new Map();
  const canonical=id=>{const seen=new Set();while(index.redirects?.[id]&&!seen.has(id)){seen.add(id);id=index.redirects[id];}return id;};
  const ancestry=(id,set=new Set())=>{id=canonical(id);if(set.has(id)||!byId.has(id))return set;set.add(id);for(const parent of byId.get(id).parentIds||[])ancestry(parent,set);return set;};
  const link=(entity,series)=>{const ip=byEntity.get(series);if(!ip)return;const set=memberships.get(entity)||new Set();for(const id of ancestry(ip.id))set.add(id);memberships.set(entity,set);};
  for(const row of discovery.memberships)link(row.g.split('/').at(-1),row.s.split('/').at(-1));
  for(const [id,e] of Object.entries(discovery.entities))for(const game of claimIds(e,'P527'))link(game,id);
  for(const group of groups)for(const entity of group.workEntities){const set=memberships.get(entity)||new Set();for(const id of [group.id,group.parentId])if(byId.has(id))set.add(id);memberships.set(entity,set);}
  const trusted=new Map();
  for(const channel of channels.values())for(const game of channel.games){
    const entityId=game.entityId||(/^wd-q\d+$/.test(game.id)?game.id.slice(3).toUpperCase():null);
    const ipIds=[...new Set([...memberships.get(entityId)||[],...(game.ipEvidence==='entity'?game.ipIds||[]:[])])];if(!ipIds.length)continue;
    const existing=trusted.get(entityId);const names=[...identityNames(game),...(game.searchTerms||[])];
    trusted.set(entityId,{id:'wd-'+entityId.toLowerCase(),entityId,names:[...new Set([...existing?.names||[],...names])],ipIds,evidence:'entity'});
  }
  records=[...trusted.values(),...official.filter(r=>r.ipIds.every(id=>byId.has(id)))];
  await writeFile(resolve(out,'memberships.json'),JSON.stringify(records));
  for(const ip of index.items){const classes=claimIds(discovery.entities[ip.entityId],'P31');if(classes.includes('Q7058673'))ip.channelKind='game-series';else if(classes.includes('Q196600'))ip.channelKind='media-franchise';}
}else records=await read(resolve(out,'memberships.json'));
const validIds=new Set(index.items.map(ip=>ip.id));
for(const r of records)r.ipIds=[...new Set(r.ipIds.map(id=>{const seen=new Set();while(index.redirects?.[id]&&!seen.has(id)){seen.add(id);id=index.redirects[id];}return id;}))].filter(id=>validIds.has(id));
await writeFile(resolve(out,'memberships.json'),JSON.stringify(records));
const resolveMembership=membershipResolver(records);const assign=game=>verifiedWorkFacts(resolveMembership(game));
const catalog=await read(resolve(out,'catalog.json'));catalog.items=catalog.items.map(assign);
let removed=0;const search=new Map();
for(const ip of index.items){const channel=channels.get(ip.id);const old=channel.games.length;
  channel.games=channel.games.map(assign).filter(g=>g.ipIds.includes(ip.id));removed+=old-channel.games.length;
  for(const g of channel.games){g.entityKind='game';const prior=search.get(g.id);search.set(g.id,{id:g.id,names:[...new Set([...prior?.names||[],...identityNames(g),...g.searchTerms||[]])],ipIds:g.ipIds});}
  ip.gameCount=channel.games.length;ip.originalCount=channel.games.filter(g=>(!g.editionKind||g.editionKind==='original')&&g.declaredStatus==='released').length;
  await writeFile(resolve(out,'series',ip.id+'.json'),JSON.stringify(channel));
}
// Keep a clearly labelled cross-media topic without a second indistinguishable
// popular entry. Never merge unrelated same-name franchises without evidence.
for(const ip of index.items)if(ip.id==='wd-q124251354'){ip.channelKind='media-franchise';ip.name='Dragon Quest · 跨媒体专题';ip.description='跨媒体品牌条目；游戏作品请优先查看「勇者斗恶龙系列」。此专题保留原有订阅与链接。';}
index.stats.works=new Set([...search.values()].map(g=>g.id)).size;
await writeFile(resolve(out,'index.json'),JSON.stringify(index));await writeFile(resolve(out,'catalog.json'),JSON.stringify(catalog));await writeFile(resolve(out,'search.json'),JSON.stringify([...search.values()]));
console.log(JSON.stringify({membershipRecords:records.length,removedUnprovenChannelEntries:removed,works:search.size}));
