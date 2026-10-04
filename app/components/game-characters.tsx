"use client";
/* Official artwork is direct-linked to avoid per-image Worker processing. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import type { CatalogGame } from "../lib/catalog";
import type { CharacterProfile } from "../lib/series-types";
import { identityNames } from "../lib/game-names";
import { publicData } from "../lib/public-data";
type CastIndex={characters:Record<string,CharacterProfile>;games:Record<string,string[]>};
const normalized=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
let cached:CastIndex|null=null;
export function GameCharacters({game}:{game:CatalogGame}){
  const [cast,setCast]=useState<CharacterProfile[]>([]),[state,setState]=useState("loading"),[open,setOpen]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{if(!open)return;const run=new AbortController();const timer=setTimeout(()=>{void (cached?Promise.resolve(cached):publicData<CastIndex>("cast.json",run.signal)).then(data=>{if(!data.characters||!data.games)throw new Error();cached=data;const keys=[game.entityId||game.id,...identityNames(game).map(normalized)];const ids=new Set([...(game.characterIds||[]),...keys.flatMap(k=>data.games[k]||[])]);if(!run.signal.aborted){setCast([...ids].map(id=>data.characters[id]).filter(Boolean).sort((a,b)=>Number(b.role==="main")-Number(a.role==="main")));setState("ready");}}).catch(()=>{if(!run.signal.aborted)setState("error");});},0);return()=>{clearTimeout(timer);run.abort();};},[game,attempt,open]);
  return <section className="character-section"><div className="section-heading"><div><p className="eyebrow">CHARACTERS</p><h2>认识游戏中的角色</h2></div><button className="button" aria-expanded={open} aria-controls="game-cast-pane" onClick={()=>setOpen(!open)}>{open?"收起角色窗格":`查看角色${cast.length?" · "+cast.length:""}`}</button></div>{open&&<div id="game-cast-pane" className="character-pane" role="region" aria-label={`${game.title}角色资料`}>
    {state==="loading"?<p role="status">正在载入人物资料…</p>:state==="error"?<p role="status">人物资料暂不可用。<button onClick={()=>setAttempt(n=>n+1)}>重试</button></p>:!cast.length?<div className="ip-empty-inline"><h3>该作品的角色资料待补充</h3><p>暂未找到可靠的作品—角色关联，不用同系列其他作品或配音演员照片代替。</p><a href={game.source.url} target="_blank" rel="noreferrer">查看作品资料 ↗</a></div>:cast.map(character=><CharacterCard key={character.id} character={character}/>)}
    <p className="catalog-footnote">“主要角色”来自具体作品的官方介绍；“出场角色”仅表示知识库记录了关联，未推断主次。图片权利归原权利人，不代表开放转载许可。</p>
  </div>}</section>;
}
function CharacterCard({character}:{character:CharacterProfile}){const [failed,setFailed]=useState(false);return <article className="character-card"><div className="character-portrait">{character.image&&!failed?<img src={character.image} alt={character.name} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span>{failed?"图片暂无法载入":"来源未提供人物图"}</span>}</div><div><span className="source-tag">{character.role==="main"?"主要角色 · 官方资料":"出场角色 · 公开索引"}</span><h3>{character.name}</h3>{(character.ja||character.en)&&<p className="muted">{[character.ja,character.en].filter(Boolean).join(" / ")}</p>}<p>{character.description}</p><a href={character.sourceUrl} target="_blank" rel="noreferrer">人物介绍来源 ↗</a>{character.imageSourceUrl&&<a href={character.imageSourceUrl} target="_blank" rel="noreferrer">图片出处 ↗</a>}<small>{character.credit}</small></div></article>;}
