import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {canRecordGame, entityKind, searchRank} from "../app/lib/game-identity.ts";
import {curatedGames, changeLibraryStatus, experienceScore, mergeCatalog, validateLibrary, type CatalogGame} from "../app/lib/catalog.ts";
import {membershipResolver} from "../app/lib/catalog-membership.ts";
import {franchises, gameFranchises} from "../app/lib/franchises.ts";
import {gameFacets, platformMatch, releaseWindow} from "../app/lib/game-facets.ts";
import {defaultRoute, parseRoute, routeURL} from "../app/lib/browse-route.ts";
import {decodeLocalFollows, encodeLocalFollows} from "../app/lib/local-follows.ts";
import {searchWikiGames} from "../app/lib/multilingual-search.ts";
const base=curatedGames[0];
const claim=(id:string)=>({mainsnak:{datavalue:{value:{id}}}});
test("entity type follows P31/P279; appearances and dated character categories cannot certify games",async()=>{
  const characters={claims:{P31:[claim("Q95074")],P1441:[claim("Q7889")]}};
  assert.equal(entityKind(characters),"character");
  assert.equal(entityKind({claims:{P31:[claim("Q7058673")]}}),"series");
  assert.equal(entityKind({claims:{P31:[claim("Q100")]}},{Q100:{claims:{P279:[claim("Q7889")]}}}),"game");
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(String(input));
    if(u.hostname==="www.wikidata.org")return Response.json({entities:{Q1:{claims:{P31:[claim("Q7889")]}},Q2:characters,Q95074:{claims:{}}}});
    return Response.json({query:{pages:[{title:"塞尔达传说 王国之泪",pageprops:{wikibase_item:"Q1"}},{title:"塞尔达公主",pageprops:{wikibase_item:"Q2"},categories:[{title:"Category:1986年推出的电子游戏角色"}]},{title:"花冠之泪",categories:[{title:"Category:2005年电子游戏"}]}]}});
  };
  try{const games=await searchWikiGames("王国之泪","zh");assert.deepEqual(games.map(g=>g.title),["塞尔达传说 王国之泪"]);assert.equal(games[0].entityKind,"game");}finally{globalThis.fetch=oldFetch;}
});
test("untyped old Wikipedia hits are quarantined without deleting notes",()=>{
  const game={...base,source:{...base.source,label:"Wikipedia · ZH"}};
  assert.equal(canRecordGame(game),false);assert.equal(canRecordGame({...game,entityKind:"game"}),true);
  assert.equal(canRecordGame({...base,entityKind:"character"}),false);
  const entry={game,status:"finished",scores:{story:8},notes:"保留我写的旧笔记",updatedAt:"2026-10-04"};
  assert.equal(validateLibrary({version:2,entries:{[game.id]:entry}})[game.id].notes,entry.notes);
});
test("exact titles outrank metadata and full-text hints",()=>{
  const named=(title:string,extra:Partial<CatalogGame>={})=>({...base,title,originalTitle:title,articleTitle:title,names:{},searchTerms:[],...extra});
  assert.ok(searchRank(named("王国之泪"),"王国之泪")>searchRank(named("塞尔达传说 王国之泪"),"王国之泪"));
  assert.ok(searchRank(named("塞尔达传说 王国之泪"),"王国之泪")>searchRank(named("花冠之泪"),"王国之泪"));
  assert.equal(searchRank(named("塞尔达公主"),"王国之泪"),0);
});
test("shared title words and legacy ipIds are not membership proof; exact identities are",()=>{
  const registry=[...franchises,{...franchises[0],id:"thief",name:"俠盜",en:"Thief",aliases:["俠盜","Thief"]},{...franchises[0],id:"blood",name:"Blood",aliases:["Blood"]}];
  for(const title of ["俠盜獵車手VI","Melty Blood"]){assert.deepEqual(gameFranchises({...base,title,originalTitle:title,articleTitle:title,names:{},ipIds:["thief","blood"]},registry),[]);}
  const assign=membershipResolver([{id:"gta",names:["Grand Theft Auto VI"],ipIds:["gta-series"],evidence:"official"}]);
  const game=assign({...base,title:"Grand Theft Auto VI",originalTitle:"Grand Theft Auto VI",articleTitle:"",names:{},ipIds:["thief"]});
  assert.deepEqual(game.ipIds,["gta-series"]);assert.deepEqual(assign({...game,id:"different",title:"Grand Theft Auto VII",originalTitle:"Grand Theft Auto VII"}).ipIds,[]);
  assert.deepEqual(mergeCatalog([{...game,ipEvidence:undefined,ipIds:["thief"]}],[game])[0].ipIds,["gta-series"]);
});
test("controlled gameplay facets unify RPG subgenres without admitting countries/player counts",()=>{
  for(const genre of ["角色扮演","JRPG","回合制 RPG","Action RPG","Role-playing"]){assert.ok(gameFacets({genres:[genre]}).gameplay.includes("角色扮演"));}
  const facets=gameFacets({genres:["日本","单人","最多 8 人","Unknown","Horror"]});
  assert.deepEqual(facets.gameplay,[]);assert.deepEqual(facets.themes,["恐怖"]);assert.deepEqual(facets.modes,["单人","多人"]);
  assert.equal(platformMatch(["Xbox Series X/S"],"PC,Xbox"),true);assert.equal(platformMatch(["Switch 2"],"Switch,PS5"),false);
});
test("route round trip retains facets, page, query, and dynamic game identity",()=>{
  const state={...defaultRoute,query:"王国之泪",genre:"角色扮演",platform:"Switch,PS5",themeFilter:"奇幻",mode:"单人",page:4,game:"wd-q64577191",title:"The Legend of Zelda: Tears of the Kingdom",lang:"en"};
  assert.deepEqual(parseRoute(routeURL(state).slice(1)),state);
  assert.equal(parseRoute("?page=-1&view=invalid").page,1);assert.equal(parseRoute("?page=Infinity").page,10000);
});
test("anticipation and experience remain separate through backup/cloud schema",()=>{
  const entry={game:base,status:"wishlist" as const,scores:{story:8},notes:"",updatedAt:"2026-10-04",expectation:5};
  assert.equal(experienceScore(entry),null);assert.equal(experienceScore({...entry,reviewConfirmed:true}),8);
  assert.equal(experienceScore(changeLibraryStatus(entry,"finished")),null,"quick status changes must not turn anticipation into reviews");
  const restored=validateLibrary({version:2,entries:{[base.id]:{...entry,reviewConfirmed:false}}})[base.id];
  assert.equal(restored.expectation,5);assert.equal(restored.scores.story,8);assert.equal(experienceScore(restored),null);
  assert.throws(()=>validateLibrary({version:2,entries:{[base.id]:{...entry,expectation:10}}}));
});
test("local follows round trip, deduplicate, and reject corruption rather than overwriting",()=>{
  assert.deepEqual(decodeLocalFollows(encodeLocalFollows(["zelda","atelier","zelda"])),["zelda","atelier"]);
  assert.throws(()=>decodeLocalFollows('{"version":1,"following":[null]}'));assert.deepEqual(decodeLocalFollows(null),[]);
});
test("release shortcuts only use known dates and confirmed recent release status",()=>{
  const game={...base,releaseDate:"2026-10-02",declaredStatus:"released" as const};const today=new Date(2026,9,4);
  assert.ok(releaseWindow(game,"recent",today));assert.ok(releaseWindow(game,"month",today));
  assert.equal(releaseWindow({...game,declaredStatus:"check"},"recent",today),false);assert.equal(releaseWindow({...game,releaseDate:null},"month",today),false);
});
test("published game memberships no longer place GTA in Thief or Melty Blood in Blood",()=>{
  const catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url),'utf8')).items as CatalogGame[];
  const gta=catalog.find(g=>g.originalTitle==="Grand Theft Auto VI")!;assert.ok(gta);assert.deepEqual(gta.ipIds,["wd-q132730"]);
  for(const game of catalog.filter(g=>/Melty Blood/i.test(g.originalTitle)))assert.ok(!game.ipIds?.includes("wd-q120198179"));
});
test("official release facts override deprecated planned years without changing saved records",()=>{
  const game={...base,id:"wd-q64577191",entityId:"Q64577191",releaseDate:null,year:2022};
  const merged=mergeCatalog([game],[])[0];assert.equal(merged.releaseDate,"2023-05-12");assert.equal(merged.year,2023);assert.equal(game.year,2022);assert.equal(merged.modes?.[0],"单人");
});
