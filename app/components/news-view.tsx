"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NewsFeed } from "../lib/news";
import { validateNewsFeed } from "../lib/news-cache";
import { EmptyState, Icon } from "./ui";
import { NewsView as SourceArchive } from "./views";
import type { CatalogGame } from "../lib/catalog";

export function LiveNewsView({ query, onOpen }: { query: string; onOpen: (game: CatalogGame) => void }) {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [state, setState] = useState("loading"); const [filter, setFilter] = useState("all"); const [source, setSource] = useState("all"); const [page, setPage] = useState(1); const [archive, setArchive] = useState(false);
  const requestRef = useRef<AbortController | null>(null); const checkedAt = useRef(0);
  const refresh = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    setState("loading");
    try { const response = await fetch("/api/news", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) }); if (!response.ok) throw new Error(); const next = validateNewsFeed(await response.json()); if (controller.signal.aborted) return; setFeed(next); setState("ready"); checkedAt.current = Date.now(); try { localStorage.setItem("release-signal-news-cache", JSON.stringify(next)); } catch { /* Optional reading cache. */ } }
    catch { if (!controller.signal.aborted) setState("error"); }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { try { const raw = localStorage.getItem("release-signal-news-cache"); if (raw && raw.length < 1_000_000) setFeed({ ...validateNewsFeed(JSON.parse(raw)), stale: true }); } catch { /* Bad caches are ignored. */ } void refresh(); }, 0);
    const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300000);
    const focus = () => { if (document.visibilityState === "visible" && Date.now() - checkedAt.current >= 300000) void refresh(); }; window.addEventListener("focus", focus); window.addEventListener("online", focus);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); requestRef.current?.abort(); requestRef.current = null; };
  }, [refresh]);
  const items = useMemo(() => (feed?.items || []).filter((item) => (source === "all" || item.sourceId === source) && (filter === "all" || filter === item.sourceKind || filter === item.topic) && `${item.title} ${item.excerpt} ${item.sourceName}`.toLowerCase().includes(query.toLowerCase())), [feed, filter, source, query]);
  const previousQuery = useRef(query);
  useEffect(() => { if (previousQuery.current !== query) { previousQuery.current = query; const timer = setTimeout(() => setPage(1), 0); return () => clearTimeout(timer); } }, [query]);
  const pages = Math.max(1, Math.ceil(items.length / 12)); const current = Math.min(page, pages);
  return <><div className="page-heading"><div><p className="eyebrow">LIVE GAME NEWS</p><h1>游戏新闻</h1><p>聚合官方公告与媒体报道，每 5 分钟检查更新。</p></div><button className="button" onClick={() => void refresh()} disabled={state === "loading"}><Icon name="refresh" className={state === "loading" ? "spin" : ""}/>{state === "loading" ? "正在更新…" : "刷新新闻"}</button></div>
    <div className="news-health" aria-live="polite"><span>{feed ? `上次获取 ${new Date(feed.fetchedAt).toLocaleString("zh-CN")}` : "正在连接新闻来源…"}</span>{feed?.sources.map((item) => <span className={item.ok ? "" : "danger"} key={item.id}>{item.name} · {item.ok ? `${item.count} 条` : "暂不可用"}</span>)}</div>
    {(state === "error" || feed?.stale) && <div className="notice">本次无法获取新新闻{feed ? "，以下为上次缓存，不代表最新资讯" : ""}。<button onClick={() => void refresh()}>重试</button></div>}
    <div className="status-tabs" role="group" aria-label="新闻分类">{[["all", "全部新闻"], ["official", "官方公告"], ["media", "媒体报道"], ["interview", "访谈"], ["rumor", "传闻 / 爆料"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setPage(1); }}>{label}</button>)}</div>
    <div className="news-toolbar"><label>来源 <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}><option value="all">全部来源</option>{feed?.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>{items.length} 条 · 标题保留原文，全文请前往来源网站</span></div>
    {items.length ? <div className="news-list live-news-list">{items.slice((current - 1) * 12, current * 12).map((item) => <article key={item.id}><div><span className={`source-tag ${item.sourceKind}`}>{item.sourceKind === "official" ? "官方" : "媒体"} · {item.sourceName}</span><span>{item.language}</span></div><h2><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h2>{item.topic !== "news" && <span className="news-topic">{item.topic === "rumor" ? "传闻 / 爆料 · 未经官方证实" : "访谈"}</span>}{item.excerpt && <p>{item.excerpt}…</p>}<footer><time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><a href={item.url} target="_blank" rel="noreferrer">阅读原文<Icon name="external"/></a></footer></article>)}</div> : <EmptyState title={state === "loading" ? "正在获取新闻" : "暂无匹配的新闻"} description={filter === "rumor" ? "当前订阅源没有对应报道，不为填满栏目而编造传闻。" : "可以切换分类、来源或清除顶部搜索词。"}/>}
    {pages > 1 && <nav className="pagination" aria-label="新闻分页"><button className="button" disabled={current === 1} onClick={() => setPage(current - 1)}>上一页</button><span>{current} / {pages}</span><button className="button" disabled={current === pages} onClick={() => setPage(current + 1)}>下一页</button></nav>}
    <p className="catalog-footnote">更新频率不等同于源站发稿频率。媒体报道和标题中的传闻不视为已核实事实；日期及平台仍以各地区官方公告为准。</p><button className="text-button archive-toggle" aria-expanded={archive} onClick={() => setArchive(!archive)}>{archive ? "收起" : "查看"}人工资料与来源台账</button>{archive && <div className="source-archive"><SourceArchive onOpen={onOpen}/></div>}
  </>;
}
