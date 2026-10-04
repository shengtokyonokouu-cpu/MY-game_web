import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {matchFranchises,suggestFranchises,ipTimeline,type Franchise} from '../app/lib/franchises.ts';
import {parseAnnualFeed} from '../app/lib/release-feed.ts';
const read=(path:string)=>JSON.parse(readFileSync(new URL('../public/data/'+path,import.meta.url),'utf8'));
const registry=read('index.json').items as Franchise[];
test('bulk catalogue contains historical origins, not just recent releases',()=>{
  for(const[id,year]of Object.entries({kirby:1992,atelier:1997,'devil-may-cry':2001,'star-ocean':1996,'monster-hunter':2004,persona:1996,'final-fantasy':1987})){
    const ip=registry.find(i=>i.id===id)!;assert.ok(ip);assert.equal(ip.firstYear,year);assert.ok(read('series/'+id+'.json').games.length>=2);
  }
});
test('official subseries are searchable through their parent and include all four originals',()=>{
  for(const q of ['亚兰德','不可思议系列'])assert.ok(suggestFranchises(q,[],registry).some(ip=>ip.id==='atelier'));
  for(const id of ['atelier-arland','atelier-mysterious'])assert.ok(read('series/'+id+'.json').games.length>=4);
});
test('ordinary words and unrelated atelier titles do not create franchise tags',()=>{
  assert.ok(!matchFranchises('CaTHaRSiS: The last of atelier',registry).some(ip=>ip.id==='atelier'));
  assert.ok(!matchFranchises('A&R Atelier announced Ecco the Dolphin',registry).some(ip=>ip.id==='atelier'));
  assert.ok(matchFranchises('Atelier Yumia: The Alchemist of Memories',registry).some(ip=>ip.id==='atelier'));
  assert.ok(!matchFranchises('The Night Kingdom & the Guide of Memories',registry).some(ip=>ip.en==='Kingdom'));
});
test('explicit remake relation repairs a missing P179 without inventing original identity',()=>{
  const game=read('series/star-ocean.json').games.find((g:{entityId:string})=>g.entityId==='Q119833222');
  assert.ok(game);assert.equal(game.editionKind,'remake');assert.ok(game.ipIds.includes('star-ocean'));
});
test('unknown old dates do not appear as future release plans',()=>{
  const game=read('series/atelier.json').games[0];
  assert.equal(ipTimeline([{...game,releaseDate:null,releases:undefined,declaredStatus:'check'}]).length,0);
});
test('embedded encyclopedia CSS never becomes a genre',()=>{
  const games=parseAnnualFeed('<table class="wikitable"><tr><th>Title</th><th>Release date</th><th>Genre(s)</th></tr><tr><td><i>Example</i></td><td>May 1</td><td><style>.mw-parser-output{height:1px}</style>RPG</td></tr></table>',2026,'2026-09-22');
  assert.deepEqual(games[0].genres,['角色扮演']);
});
