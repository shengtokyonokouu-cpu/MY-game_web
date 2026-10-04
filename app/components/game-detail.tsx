"use client";
import { useEffect, useRef, useState } from "react";
import type { ScoreSet } from "../data/games";
import { experienceScore, releaseLabels, releaseState, type CatalogGame, type Library, type LibraryStatus } from "../lib/catalog";
import { canRecordGame } from "../lib/game-identity";
import { PersonalEditor } from "./personal-editor";
import { GameNameRows } from "./game-names";
import { detectLanguage } from "../lib/game-names";
import { Dialog, GameCover, Icon } from "./ui";
import { GameCharacters } from "./game-characters";
export function GameDetail({ game, entry, disabled, onClose, onSave, onRemove }: { game: CatalogGame; entry?: Library[string]; disabled: boolean; onClose: () => void; onSave: (status: LibraryStatus, scores: Partial<ScoreSet>, notes: string, expectation?: number, reviewConfirmed?: boolean) => void; onRemove: () => void }) {
  const [status, setStatus] = useState<LibraryStatus>(entry?.status ?? "wishlist"); const [scores, setScores] = useState<Partial<ScoreSet>>(entry?.scores ?? {}); const [notes, setNotes] = useState(entry?.notes ?? ""); const [saved, setSaved] = useState(false); const [confirmRemove, setConfirmRemove] = useState(false); const [confirmClose, setConfirmClose] = useState(false);
  const [summary, setSummary] = useState(game.summary);
  const [expectation,setExpectation]=useState(entry?.expectation);
  const initialReview=entry?.reviewConfirmed ?? (experienceScore(entry)!==null);
  const [reviewConfirmed,setReview]=useState(initialReview);
  const valid=canRecordGame(game);
  const [detailState, setDetailState] = useState("idle");
  const [detailRetry, setDetailRetry] = useState(0);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (game.summary || !game.articleTitle) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setDetailState("loading");
      const title = game.articleTitle;
      const language = detectLanguage(title);
      void fetch(`/api/details?title=${encodeURIComponent(title)}&lang=${language}`, { signal: controller.signal })
        .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((data: { summary?: string }) => { if (!controller.signal.aborted) { setSummary(data.summary || ""); setDetailState("ready"); } })
        .catch(() => { if (!controller.signal.aborted) setDetailState("error"); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [game.summary, game.articleTitle, game.title, game.originalTitle, detailRetry]);
  useEffect(() => { if (confirmClose || confirmRemove) { confirmationRef.current?.scrollIntoView({ block: "center" }); confirmationRef.current?.querySelector("button")?.focus(); } }, [confirmClose, confirmRemove]);
  const dirty = status !== (entry?.status ?? "wishlist") || notes !== (entry?.notes ?? "") || expectation!==entry?.expectation || reviewConfirmed!==initialReview || JSON.stringify(scores) !== JSON.stringify(entry?.scores ?? {});
  const close = () => { if (dirty) setConfirmClose(true); else onClose(); }; function save() { if(disabled||!valid)return;onSave(status, scores, notes, expectation, reviewConfirmed); setSaved(true); }
  return <Dialog title={game.title} onClose={close}><div className="detail-cover"><GameCover game={game} eager/></div><div className="detail-content"><div className="detail-kicker"><span className={`release-pill ${releaseState(game)}`}>{releaseLabels[releaseState(game)]}</span><span>{game.source.type === "official" ? "附官方来源" : game.source.type === "store" ? "商店资料" : "公共索引 · 待官方核验"}</span></div><h1>{game.title}</h1><GameNameRows game={game} sources/><p className="muted">名称来自对应地区官方 / 商店或百科索引；名称语言不代表游戏字幕语言。</p><div className="detail-facts"><div><span>发售时间</span><strong>{game.releaseDate?.replaceAll("-", ".") || game.dateLabel || "日期待定"}</strong></div><div><span>开发商</span><strong>{game.developer || "待确认"}</strong></div><div><span>发行商</span><strong>{game.publisher || "待确认"}</strong></div><div><span>地区</span><strong>{game.country || "待确认"}</strong></div></div><div className="platforms">{game.platforms.map((item) => <span key={item}>{item}</span>)}</div><p className="description">{summary || (detailState === "loading" ? "正在加载游戏简介…" : "暂无可用简介，可通过下方来源查看游戏资料。")}</p>{detailState === "error" && <button className="text-button" onClick={() => setDetailRetry((value) => value + 1)}>重试加载简介</button>}{game.fit && <div className="fit-note"><strong>为什么值得关注</strong><p>{game.fit}</p>{game.caution && <p className="muted">游玩前：{game.caution}</p>}</div>}<div className="tag-list">{game.genres.map((item) => <span key={item}>{item}</span>)}</div>
    <GameCharacters game={game}/>
    {game.releases && game.releases.length > 1 && <section className="release-versions"><h3>各版本发布记录</h3><p className="muted">公共索引记录；移植版和不同平台的时间可能不同。</p>{game.releases.map((release, index) => <div key={index}><time>{release.label}</time><span>{release.platforms.join(" · ") || "平台待定"}</span><small>{release.kind}</small></div>)}</section>}
    {!valid&&<div className="notice error">这条旧记录尚未核验为游戏，已暂停收藏、状态与评分修改。原有笔记没有删除；可导出备份，或重新搜索已核验的游戏。</div>}
    <PersonalEditor status={status} onStatus={v=>{setStatus(v);setSaved(false);}} scores={scores} onScores={v=>{setScores(v);setSaved(false);}} notes={notes} onNotes={v=>{setNotes(v);setSaved(false);}} expectation={expectation} onExpectation={v=>{setExpectation(v);setSaved(false);}} reviewConfirmed={reviewConfirmed} onReview={v=>{setReview(v);setSaved(false);}} disabled={disabled||!valid} saved={saved} hasEntry={!!entry}/>
    <section className="detail-source"><div><h3>{game.source.label}</h3><p>{game.source.evidence}</p><small>{game.source.type === "official" ? "来源核验" : "资料检索"}：{game.source.checkedAt || "未知"}</small></div><a className="button" href={game.source.url} target="_blank" rel="noreferrer">查看来源<Icon name="external"/></a></section>
    <div ref={confirmationRef}>{confirmRemove && <div className="notice error" role="alert">移除后，这款游戏的评分和笔记也会删除。<button onClick={onRemove}>确认移除</button><button onClick={() => setConfirmRemove(false)}>取消</button></div>}{confirmClose && <div className="notice" role="alert">还有未保存的修改。<button onClick={() => { save(); onClose(); }} disabled={disabled}>保存并关闭</button><button onClick={onClose}>放弃修改</button><button onClick={() => setConfirmClose(false)}>继续编辑</button></div>}</div>
    <footer className="detail-actions">{entry && <button className="text-button danger" onClick={() => setConfirmRemove(true)} disabled={disabled}>从游戏架移除</button>}<button className="button" onClick={close}>关闭</button><button className="button primary" onClick={save} disabled={disabled||!valid}><Icon name="check"/>{entry ? "保存修改" : "保存到游戏架"}</button></footer></div></Dialog>;
}
