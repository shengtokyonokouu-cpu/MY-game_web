// One-time migration from the previously published, explicitly verified remake
// records. Does not trust title matching or restore removed lexical assignments.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const repo=resolve('work/catalog-publish'),out=resolve(process.env.CATALOG_OUTPUT||'public/data');
const files=execFileSync('git',['grep','-l','Wikidata · 明确重制 / 复刻关系','HEAD','--','v1/series'],{cwd:repo,encoding:'utf8'}).trim().split('\n');let restored=0;
for(const ref of files){if(!/^HEAD:v1\/series\/[a-z0-9-]+\.json$/.test(ref))throw new Error('Unexpected snapshot path');const previous=JSON.parse(execFileSync('git',['show',ref],{cwd:repo,encoding:'utf8',maxBuffer:20_000_000}));
  const path=resolve(out,'series',previous.id+'.json');let channel;try{channel=JSON.parse(await readFile(path,'utf8'));}catch{continue;}
  for(const game of previous.games.filter(g=>g.source.label==='Wikidata · 明确重制 / 复刻关系'&&g.editionKind==='remake')){
    if(!channel.games.some(g=>g.entityId===game.entityId)){channel.games.push({...game,ipEvidence:'entity',entityKind:'game'});restored++;}
  }
  await writeFile(path,JSON.stringify(channel));
}
console.log(JSON.stringify({restoredExplicitEditionRecords:restored}));
