import {readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import{sourceJSON}from'./catalog-source.mjs';
import officialCast from '../app/data/official-cast.json' with {type:'json'};
const out=resolve(process.env.CATALOG_OUTPUT||'public/data');const index=JSON.parse(await readFile(resolve(out,'index.json'),'utf8'));const characters=JSON.parse(await readFile(resolve(out,'characters.json'),'utf8'));
const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const castGames={};
for(const[id,c]of Object.entries(characters))if(!c.name)delete characters[id];
for(const item of officialCast){characters[item.id]={...item,imageSourceUrl:item.sourceUrl};delete characters[item.id].games;for(const name of item.games)(castGames[normalized(name)]||=[]).push(item.id);}
let savedCovers={};try{savedCovers=JSON.parse(await readFile(resolve(out,'artwork.json'),'utf8'));}catch{/* Initial bootstrap. */}
let checked={};try{checked=JSON.parse(await readFile(resolve(out,'artwork-checks.json'),'utf8'));}catch{/* Initial bootstrap. */}
const covers=new Map(Object.entries(savedCovers));const priority=['atelier','kirby','devil-may-cry','star-ocean','monster-hunter','persona','final-fantasy','zelda','pokemon','trails','xenoblade','fire-emblem'];
const channels=[];for(const ip of index.items){channels.push(JSON.parse(await readFile(resolve(out,'series',ip.id+'.json'),'utf8')));}
const games=[...new Map(channels.flatMap(c=>c.games).map(g=>[g.id,g])).values()].sort((a,b)=>Number(priority.some(id=>b.ipIds.includes(id)))-Number(priority.some(id=>a.ipIds.includes(id))));
for(const g of games)if(g.articleTitle&&g.image)covers.set(normalized(g.articleTitle),g.image);
for(const g of games)g.image||=covers.get(normalized(g.articleTitle));
let requested=0;const limit=Number(process.env.COVER_REQUEST_BUDGET||18);
const pending=games.filter(g=>g.articleTitle&&!g.image&&(!checked[normalized(g.articleTitle)]||Date.now()-checked[normalized(g.articleTitle)]>30*86400000));for(let i=0;i<pending.length&&requested<limit;i+=50){const batch=pending.slice(i,i+50);const params=new URLSearchParams({action:'query',titles:batch.map(g=>g.articleTitle).join('|'),prop:'pageimages',piprop:'thumbnail',pithumbsize:'480',pilicense:'any',pilimit:'50',format:'json',formatversion:'2'});
  requested++;try{const data=await sourceJSON('https://en.wikipedia.org/w/api.php?'+params);for(const page of data.query?.pages||[]){const image=page.thumbnail?.source;if(image?.startsWith('https://upload.wikimedia.org/'))covers.set(normalized(page.title),image);}for(const game of batch)checked[normalized(game.articleTitle)]=Date.now();}catch(e){console.warn('Artwork source unavailable:',e.message);break;}}
for(const c of channels){for(const game of c.games){game.image||=covers.get(normalized(game.articleTitle));const keys=[game.entityId,...[game.title,game.originalTitle,...Object.values(game.names||{}).map(n=>n.text)].map(normalized)];const ids=[...new Set([...(game.characterIds||[]),...keys.flatMap(k=>castGames[k]||[])])];game.characterIds=ids;if(game.entityId)castGames[game.entityId]=ids;for(const id of ids)if(characters[id])c.characters[id]=characters[id];}await writeFile(resolve(out,'series',c.id+'.json'),JSON.stringify(c));}
await writeFile(resolve(out,'cast.json'),JSON.stringify({updatedAt:new Date().toISOString(),characters,games:castGames}));
await writeFile(resolve(out,'artwork.json'),JSON.stringify(Object.fromEntries(covers)));
// Negative lookups advance the daily cursor too; do not retry the same missing
// first 600 covers forever. They become eligible again after thirty days.
await writeFile(resolve(out,'artwork-checks.json'),JSON.stringify(checked));
index.stats.characters=Object.keys(characters).length;
await writeFile(resolve(out,'index.json'),JSON.stringify(index));
console.log(JSON.stringify({officialProfiles:officialCast.length,profiles:Object.keys(characters).length,coverRequests:requested,newCovers:covers.size}));
