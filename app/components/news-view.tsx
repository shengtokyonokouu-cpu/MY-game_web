"use client";
import { useMemo, useState } from "react";
import { Icon } from "./ui";
import { NewsView as SourceArchive } from "./views";
import type { CatalogGame } from "../lib/catalog";
import { articlePlatforms } from "../lib/franchises";
import { IPNewsFeed, PopularIPs } from "./ip-components";
import { useIP } from "./ip-provider";

export function LiveNewsView({ query, catalog, onOpen, ipFilter, onIPFilter, platform, onPlatform }: { query: string; catalog: CatalogGame[]; onOpen: (game: CatalogGame) => void; ipFilter: string; onIPFilter: (id: string) => void; platform: string; onPlatform: (value: string) => void }) {
  const { news: { feed, state, refresh }, articleFranchises, franchises, matchesNewsQuery } = useIP();
  const [filter, setFilter] = useState("all"); const [source, setSource] = useState("all"); const [language, setLanguage] = useState("all"); const [archive, setArchive] = useState(false);
  const beforeIP = useMemo(() => (feed?.items || []).filter((item) => (language === "all" || item.language === language) && (source === "all" || item.sourceId === source) && (filter === "all" || filter === item.sourceKind || filter === item.topic) && (platform === "all" || articlePlatforms(item).includes(platform)) && matchesNewsQuery(item, query, catalog)), [feed, filter, source, query, language, platform, catalog, matchesNewsQuery]);
  const items = beforeIP.filter((item) => ipFilter === "all" || articleFranchises(item).some((ip) => ip.id === ipFilter));
  const facets = franchises.map((ip) => ({ ...ip, count: beforeIP.filter((item) => articleFranchises(item).some((match) => match.id === ip.id)).length })).filter((ip) => ip.count);
  return <><div className="page-heading"><div><p className="eyebrow">LIVE GAME NEWS</p><h1>游戏新闻</h1><p>聚合中日英官方公告与媒体报道，来源约每 3 小时抓取，页面每 5 分钟检查快照。</p></div><button className="button" onClick={() => void refresh()} disabled={state === "loading"}><Icon name="refresh" className={state === "loading" ? "spin" : ""}/>{state === "loading" ? "正在更新…" : "刷新新闻"}</button></div>
    <div className="news-health" aria-live="polite"><span>{feed ? `上次获取 ${new Date(feed.fetchedAt).toLocaleString("zh-CN")}` : "正在连接新闻来源…"}</span>{feed?.sources.map((item) => <span className={item.ok ? "" : "danger"} key={item.id}>{item.name} · {item.ok ? `${item.count} 条` : "暂不可用"}</span>)}</div>
    {(state === "error" || feed?.stale) && <div className="notice">本次无法获取新新闻{feed ? "，以下为上次缓存，不代表最新资讯" : ""}。<button onClick={() => void refresh()}>重试</button></div>}
    <PopularIPs value={ipFilter} onChange={onIPFilter}/><div className="status-tabs" role="group" aria-label="新闻分类">{[["all", "全部新闻"], ["official", "官方公告"], ["media", "媒体报道"], ["interview", "访谈"], ["rumor", "传闻 / 爆料"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="news-toolbar"><label>平台 <select value={platform} onChange={(e) => onPlatform(e.target.value)}><option value="all">全部平台</option>{["Switch", "Switch 2", "PS5", "PS4", "PC", "Xbox"].map((item) => <option key={item}>{item}</option>)}</select></label><label>语言 <select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="all">中 / 日 / 英</option>{["中文", "日文", "英文"].map((item) => <option key={item}>{item}</option>)}</select></label><label>来源 <select value={source} onChange={(e) => setSource(e.target.value)}><option value="all">全部来源</option>{feed?.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>{items.length} 条 · 标题保留原文</span></div>
    <div className={query ? "search-results-layout" : ""}>{query && <aside className="ip-facets" aria-label="新闻搜索关联 IP"><h2>关联系列</h2><p>别名搜索也会扩展到关联 IP。</p><button className={ipFilter === "all" ? "active" : ""} onClick={() => onIPFilter("all")}>全部结果 <span>{beforeIP.length}</span></button>{facets.map((ip) => <button key={ip.id} aria-pressed={ipFilter === ip.id} className={ipFilter === ip.id ? "active" : ""} onClick={() => onIPFilter(ip.id)}>{ip.name}<span>{ip.count}</span></button>)}{!facets.length && <p>当前结果未识别到已收录 IP。</p>}</aside>}<div className="search-results-main"><IPNewsFeed key={`${query}-${filter}-${source}-${language}-${ipFilter}-${platform}`} items={items} loading={state === "loading"}/></div></div>
    <p className="catalog-footnote">新闻平台仅按标题与摘要明确提及的名称筛选；未知平台不计入。更新频率不等同于源站发稿频率；当前列表不是完整历史档案。媒体报道、关联 IP 标签和传闻不视为已核实的发售事实。</p><button className="text-button archive-toggle" aria-expanded={archive} onClick={() => setArchive(!archive)}>{archive ? "收起" : "查看"}人工资料与来源台账</button>{archive && <div className="source-archive"><SourceArchive onOpen={onOpen}/></div>}
  </>;
}
