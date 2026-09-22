"use client";
import { useMemo, useState } from "react";
import { releaseLabels, releaseState, type CatalogGame } from "../lib/catalog";
import { GameNameRows } from "./game-names";
import { GameCover } from "./ui";
import { useIP } from "./ip-provider";
import type { Franchise } from "../lib/franchises";
export function SeriesChronology({ip,games,onOpen,loading,error,retry}:{ip:Franchise;games:CatalogGame[];onOpen:(game:CatalogGame)=>void;loading:boolean;error:boolean;retry:()=>void}){
  const {franchiseById}=useIP();const [order,setOrder]=useState("oldest");const [edition,setEdition]=useState("all");const [branch,setBranch]=useState("all");const [query,setQuery]=useState("");const [page,setPage]=useState(1);
  const filtered=useMemo(()=>games.filter(g=>(edition==="all"||(g.editionKind||"original")===edition)&&(branch==="all"||g.ipIds?.includes(branch))&&[g.title,g.originalTitle,...Object.values(g.names||{}).map(n=>n.text)].join(" ").toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{const dateA=a.releaseDate||String(a.year||9999),dateB=b.releaseDate||String(b.year||9999);return (order==="oldest"?1:-1)*dateA.localeCompare(dateB);}),[games,edition,branch,query,order]);
  const pages=Math.max(1,Math.ceil(filtered.length/12));const current=Math.min(page,pages);
  return <section className="series-chronology"><div className="section-heading"><div><p className="eyebrow">SERIES CHRONOLOGY</p><h2>从初代开始，探索这个系列</h2></div><span>{filtered.length} 部作品 / 版本</span></div><div className="news-toolbar"><label>排列<select value={order} onChange={e=>{setOrder(e.target.value);setPage(1);}}><option value="oldest">初代 → 最新</option><option value="newest">最新 → 初代</option></select></label><label>类型<select value={edition} onChange={e=>{setEdition(e.target.value);setPage(1);}}><option value="all">全部作品及版本</option><option value="original">独立作品</option><option value="remake">重制 / 复刻</option><option value="collection">合集</option></select></label>{!!ip.childIds?.length&&<label>子系列<select value={branch} onChange={e=>{setBranch(e.target.value);setPage(1);}}><option value="all">全部子系列</option>{ip.childIds.map(id=><option value={id} key={id}>{franchiseById(id)?.name||id}</option>)}</select></label>}<label>作品名称<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="中 / 日 / 英名称"/></label></div>
    {loading&&<p role="status" className="ip-empty-inline">正在读取系列历史目录…</p>}{error&&<p role="status" className="notice">完整目录暂不可用，下面仅显示已载入记录。<button onClick={retry}>重试</button></p>}
    <div className="chronology-grid">{filtered.slice((current-1)*12,current*12).map(game=><article key={game.id}><button className="chronology-open" onClick={()=>onOpen(game)} aria-label={`查看${game.title}`}><GameCover game={game}/><div className="chronology-date"><time>{game.dateLabel||game.releaseDate||"日期待补充"}</time><span className={`release-pill ${releaseState(game)}`}>{releaseLabels[releaseState(game)]}</span></div><h3>{game.title}</h3><GameNameRows game={game}/></button><p>{game.platforms.join(" · ")||"平台资料待补充"}</p><footer><span>{game.editionKind==="remake"?"重制 / 复刻":game.editionKind==="collection"?"合集":"独立作品"}</span><button className="text-button" onClick={()=>onOpen(game)}>详情与角色</button></footer></article>)}</div>
    {!filtered.length&&!loading&&<p className="ip-empty-inline">没有符合条件的作品。试试取消平台、类型或子系列筛选。</p>}
    {pages>1&&<nav className="pagination" aria-label="系列历史作品分页"><button className="button" disabled={current===1} onClick={()=>setPage(current-1)}>上一页</button><span>{current} / {pages} · 每页 12 部</span><button className="button" disabled={current===pages} onClick={()=>setPage(current+1)}>下一页</button></nav>}
    <p className="catalog-footnote">按最早收录的发售时间排列；不把移植平台等同于新作品。{ip.coverage||"目录尚在补齐"}。尚未确定日期的条目保留“待复核”，不推测发售情况。</p>
  </section>;
}
