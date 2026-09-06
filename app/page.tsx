"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import snapshot from "./data/discovered.json";
import { SNAPSHOT_DATE } from "./data/games";
import { averageScore, curatedGames, LIBRARY_KEY, libraryLabels, matchesQuery, mergeCatalog, migrateLibrary, releaseLabels, releaseState, type CatalogFeed, type CatalogGame, type Library, type LibraryStatus, type ReleaseState } from "./lib/catalog";
import { EmptyState, GameCover, Icon } from "./components/ui";
import { GameDetail } from "./components/game-detail";
import { CalendarView, NewsView, SettingsView } from "./components/views";

type View = "discover" | "calendar" | "library" | "news" | "settings";
const navigation: { id: View; label: string; icon: string }[] = [{ id: "discover", label: "发现游戏", icon: "discover" }, { id: "calendar", label: "发售日历", icon: "calendar" }, { id: "library", label: "我的游戏架", icon: "library" }, { id: "news", label: "情报与来源", icon: "news" }];
const initialFeed = snapshot as CatalogFeed;
const initialCatalog = mergeCatalog(curatedGames, initialFeed.items);
const PAGE_SIZE = 12;
export const platforms = ["PC", "PS5", "PS4", "Switch 2", "Switch", "Xbox", "iOS", "Android"];

export default function Home() {
  const [view, setView] = useState<View>("discover");
  const [feed, setFeed] = useState<CatalogFeed>(initialFeed);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [library, setLibrary] = useState<Library>({});
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ReleaseState>("all");
  const [platform, setPlatform] = useState("all");
  const [genre, setGenre] = useState("all");
  const [region, setRegion] = useState("all");
  const [sort, setSort] = useState("recommended");
  const [page, setPage] = useState(1);
  const [shelfFilter, setShelfFilter] = useState<"all" | LibraryStatus>("all");
  const [selected, setSelected] = useState<CatalogGame | null>(null);
  const [theme, setTheme] = useState("light");
  const [scale, setScale] = useState(1);
  const [density, setDensity] = useState("comfortable");
  const [toast, setToast] = useState("");
  const [onlineResults, setOnlineResults] = useState<CatalogGame[]>([]);
  const [onlineState, setOnlineState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [searchRetry, setSearchRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let nextLibrary: Library = {}; let error = "";
    let preferences: { theme?: string; scale?: number; density?: string } = {};
    try {
      nextLibrary = migrateLibrary(localStorage.getItem(LIBRARY_KEY), localStorage.getItem("release-signal-personal-v1"));
      preferences = JSON.parse(localStorage.getItem("release-signal-preferences-v2") || "{}");
      preferences.theme ??= localStorage.getItem("release-signal-theme-v1") || "light";
    } catch { error = "无法读取本机记录。原始数据已保留，可先导出备份。"; }
    queueMicrotask(() => {
      setLibrary(nextLibrary); setStorageError(error); setReady(true);
      setTheme(preferences.theme === "dark" ? "dark" : "light");
      setScale(typeof preferences.scale === "number" && preferences.scale >= .9 && preferences.scale <= 1.5 ? preferences.scale : 1);
      setDensity(preferences.density === "compact" ? "compact" : "comfortable");
      const params = new URLSearchParams(location.search); const wanted = params.get("view");
      if (["discover", "calendar", "library", "news", "settings"].includes(wanted || "")) setView(wanted as View);
      setQuery(params.get("q") || ""); const id = params.get("game");
      if (id) setSelected(initialCatalog.find((game) => game.id === id) ?? nextLibrary[id]?.game ?? null);
    });
  }, []);
  useEffect(() => {
    if (!ready || storageError) return;
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify({ version: 2, entries: library })); }
    catch { queueMicrotask(() => setStorageError("浏览器存储空间不可用，当前修改尚未保存。请立即导出备份。")); }
  }, [library, ready, storageError]);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty("--ui-scale", String(scale));
    try { localStorage.setItem("release-signal-preferences-v2", JSON.stringify({ theme, scale, density })); } catch { /* Session-local preferences remain usable. */ }
  }, [theme, scale, density, ready]);
  useEffect(() => {
    if (!ready) return; const url = new URL(location.href);
    for (const [key, value] of [["view", view === "discover" ? "" : view], ["q", query], ["game", selected?.id || ""]]) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    history.replaceState(null, "", url);
  }, [view, query, selected, ready]);
  const refresh = useCallback(async () => {
    setSyncState("loading");
    try { const response = await fetch("/api/catalog", { signal: AbortSignal.timeout(40000) }); if (!response.ok) throw new Error(); const next = await response.json() as CatalogFeed; if (!Array.isArray(next.items) || !next.items.length) throw new Error(); setFeed(next); setSyncState(next.stale ? "error" : "ready"); } catch { setSyncState("error"); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 200); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30 * 60 * 1000); return () => { clearTimeout(timer); clearInterval(interval); }; }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2 || view !== "discover") { setOnlineResults([]); setOnlineState("idle"); return; }
      setOnlineResults([]); setOnlineState("loading");
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
        .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((data: { items: CatalogGame[] }) => { if (!controller.signal.aborted) { setOnlineResults(data.items); setOnlineState("ready"); } })
        .catch(() => { if (!controller.signal.aborted) { setOnlineResults([]); setOnlineState("error"); } });
    }, 400); return () => { clearTimeout(timer); controller.abort(); };
  }, [query, view, searchRetry]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);

  const catalog = useMemo(() => mergeCatalog(curatedGames, feed.items), [feed.items]);
  const searchable = useMemo(() => mergeCatalog(catalog, onlineResults), [catalog, onlineResults]);
  const genres = Array.from(new Set(catalog.flatMap((game) => game.genres))).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh"));
  const counts = catalog.reduce((acc, game) => { acc[releaseState(game)]++; return acc; }, { released: 0, upcoming: 0, development: 0, check: 0 });
  const filtered = useMemo(() => {
    const source = view === "library" ? Object.values(library).filter((entry) => shelfFilter === "all" || entry.status === shelfFilter).map((entry) => entry.game) : searchable;
    return source.filter((game) => (view === "library" || status === "all" || releaseState(game) === status) && (platform === "all" || game.platforms.includes(platform)) && (genre === "all" || game.genres.includes(genre)) && (region === "all" || game.region === region) && matchesQuery(game, query)).sort((a, b) => {
      if (sort === "date-asc") return (a.releaseDate || "9999").localeCompare(b.releaseDate || "9999");
      if (sort === "date-desc") return (b.releaseDate || "0000").localeCompare(a.releaseDate || "0000");
      if (sort === "name") return a.title.localeCompare(b.title, "zh");
      if (sort === "rating") return (averageScore(library[b.id]?.scores) ?? -1) - (averageScore(library[a.id]?.scores) ?? -1);
      if (view === "library") return (library[b.id]?.updatedAt || "").localeCompare(library[a.id]?.updatedAt || "");
      return Number(!!b.featured) - Number(!!a.featured) || (b.releaseDate || "").localeCompare(a.releaseDate || "");
    });
  }, [view, library, shelfFilter, searchable, status, platform, genre, region, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pages); const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const shelfCounts = Object.values(library).reduce((acc, entry) => { acc[entry.status]++; return acc; }, { wishlist: 0, playing: 0, finished: 0, paused: 0 });
  function navigate(next: View) { setView(next); setPage(1); setQuery(""); setOnlineResults([]); setPlatform("all"); setGenre("all"); setRegion("all"); setStatus("all"); window.scrollTo({ top: 0 }); }
  function clearFilters() { setQuery(""); setPlatform("all"); setGenre("all"); setRegion("all"); setStatus("all"); setShelfFilter("all"); setPage(1); }
  function saveGame(game: CatalogGame) { setLibrary((current) => ({ ...current, [game.id]: { game, notes: "", scores: {}, status: "wishlist", updatedAt: new Date().toISOString() } })); setToast("已加入「想玩」"); }
  function changePage(next: number) { setPage(next); document.getElementById("results")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  function renderCard(game: CatalogGame, index: number) {
    const entry = library[game.id]; const average = averageScore(entry?.scores);
    return <article className="game-card" key={game.id}><button className="card-image-button" onClick={() => setSelected(game)} aria-label={`查看${game.title}`}><GameCover key={game.id} game={game} eager={index < 4}/><span className={`release-pill ${releaseState(game)}`}>{releaseLabels[releaseState(game)]}</span></button><div className="card-body"><div className="card-date"><time>{game.releaseDate?.replaceAll("-", ".") || game.dateLabel || "日期待定"}</time><span className={`source-dot ${game.source.type}`} title={game.source.label}>{game.source.type === "official" ? "官方来源" : game.source.type === "store" ? "商店资料" : "公共索引"}</span></div><h2><button onClick={() => setSelected(game)}>{game.title}</button></h2><p className="card-developer">{game.developer || game.originalTitle}</p><div className="platforms">{game.platforms.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{game.platforms.length > 4 && <span>+{game.platforms.length - 4}</span>}{!game.platforms.length && <span>平台待确认</span>}</div><div className="card-footer"><span className="card-genre">{average !== null ? `我的评分 ${average.toFixed(1)}` : game.genres.slice(0, 2).join(" · ") || "类型待确认"}</span><button className={`save-button ${entry ? "saved" : ""}`} disabled={!ready || !!storageError} onClick={() => entry ? setSelected(game) : saveGame(game)} aria-label={entry ? `管理${game.title}` : `收藏${game.title}`}><Icon name={entry ? "check" : "plus"}/>{entry ? libraryLabels[entry.status] : "想玩"}</button></div></div></article>;
  }
  function pagination() {
    if (pages <= 1) return null; const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter((value) => value === 1 || value === pages || Math.abs(value - currentPage) <= 1);
    return <nav className="pagination" aria-label="游戏目录分页"><button className="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</button><div>{numbers.map((value, index) => <span key={value}>{index > 0 && value > numbers[index - 1] + 1 && <i>…</i>}<button aria-label={`第 ${value} 页`} aria-current={currentPage === value ? "page" : undefined} className={value === currentPage ? "active" : ""} onClick={() => changePage(value)}>{value}</button></span>)}</div><button className="button" disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>下一页</button></nav>;
  }
  function filters() { return <><div className="filters"><label><span>平台</span><select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}><option value="all">全部平台</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>类型</span><select value={genre} onChange={(e) => { setGenre(e.target.value); setPage(1); }}><option value="all">全部类型</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>地区</span><select value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }}><option value="all">全部地区</option><option>日本</option><option>欧美</option><option>其他</option><option value="">待确认</option></select></label><label className="sort-control"><span>排序</span><select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="recommended">{view === "library" ? "最近更新" : "精选优先"}</option><option value="date-desc">日期：从新到旧</option><option value="date-asc">日期：从旧到新</option><option value="name">游戏名称</option><option value="rating">我的评分</option></select></label></div><div id="results" className="results-meta"><span>共 <strong>{filtered.length}</strong> 部游戏{filtered.length > PAGE_SIZE && ` · 第 ${currentPage} / ${pages} 页`}{onlineState === "loading" && query.length > 1 && " · 正在搜索更多…"}</span>{(query || platform !== "all" || genre !== "all" || region !== "all" || status !== "all" || shelfFilter !== "all") && <button className="text-button" onClick={clearFilters}>清除筛选 <Icon name="close"/></button>}</div></>; }

  return <div className={`app-shell density-${density}`}><a className="skip-link" href="#main">跳转到内容</a><aside className="sidebar"><button className="brand" onClick={() => navigate("discover")}><span className="brand-mark"><Icon name="game"/></span><span>发售信号<small>RELEASE SIGNAL</small></span></button><p className="sidebar-label">你的游戏空间</p><nav aria-label="主要导航">{navigation.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/>{item.label}{item.id === "library" && <small>{Object.keys(library).length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="online-indicator"/>公开来源 · 持续更新<small>个人记录保存在此浏览器</small></div><button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Icon name="settings"/>设置与数据</button></div></aside>
    <div className="workspace"><header className="app-header"><div className="breadcrumb">我的空间 <span>/</span> {navigation.find((item) => item.id === view)?.label || "设置与数据"}</div><label className="global-search"><Icon name="search"/><span className="sr-only">搜索游戏、系列或开发商</span><input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setOnlineResults([]); setPage(1); if (!["discover", "library", "calendar"].includes(view)) setView("discover"); }} placeholder="搜索游戏、系列、开发商"/><kbd>Ctrl K</kbd>{query && <button onClick={() => { setQuery(""); setOnlineResults([]); setPage(1); }} aria-label="清除搜索"><Icon name="close"/></button>}</label><button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? "切换为深色主题" : "切换为浅色主题"}><Icon name={theme === "light" ? "moon" : "sun"}/></button><button className="profile-button" onClick={() => navigate("settings")} aria-label="个人设置">我</button></header>
      <main id="main" className="main-content">{storageError && <div className="notice error" role="alert">{storageError}<button onClick={() => navigate("settings")}>打开数据管理</button></div>}
        {(view === "discover" || view === "library") && <><div className="page-heading"><div><p className="eyebrow">{view === "discover" ? "DISCOVER YOUR NEXT GAME" : "YOUR PERSONAL COLLECTION"}</p><h1>{view === "discover" ? "发现下一款好游戏" : "我的游戏架"}</h1><p>{view === "discover" ? "从新作到下一次冒险，找到值得投入的世界。" : "收藏、游玩进度、四维评价，都在这里。"}</p></div>{view === "discover" ? <button className="button" onClick={() => void refresh()} disabled={syncState === "loading"}><Icon name="refresh" className={syncState === "loading" ? "spin" : ""}/>{syncState === "loading" ? "正在更新" : "更新游戏"}</button> : <button className="button" onClick={() => navigate("settings")}><Icon name="download"/>备份记录</button>}</div>
          {view === "discover" ? <><div className="catalog-summary"><span><strong>{catalog.length}</strong> 部收录</span><span><strong>{counts.upcoming}</strong> 部将发布</span><span><strong>{Object.keys(library).length}</strong> 部在游戏架</span><span className="updated-text">{feed.updatedAt ? `目录更新 ${feed.updatedAt.slice(0, 10)}` : `精选快照 ${SNAPSHOT_DATE}`}</span></div>{syncState === "error" && <div className="notice">新数据暂时无法更新，已保留上次可用目录。<button onClick={() => void refresh()}>重试</button></div>}<div className="status-tabs" role="group" aria-label="发售状态筛选">{(["all", "released", "upcoming", "development", "check"] as const).map((value) => <button key={value} className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === "all" ? "全部游戏" : releaseLabels[value]}<small>{value === "all" ? catalog.length : counts[value]}</small></button>)}</div></> : <div className="status-tabs" role="group" aria-label="游戏架筛选">{(["all", "wishlist", "playing", "finished", "paused"] as const).map((value) => <button key={value} className={shelfFilter === value ? "active" : ""} aria-pressed={shelfFilter === value} onClick={() => { setShelfFilter(value); setPage(1); }}>{value === "all" ? "全部收藏" : libraryLabels[value]}<small>{value === "all" ? Object.keys(library).length : shelfCounts[value]}</small></button>)}</div>}
          {filters()}{onlineState === "error" && query.length > 1 && view === "discover" && <div className="notice">在线搜索暂时不可用，以下为本地目录结果。<button onClick={() => setSearchRetry((value) => value + 1)}>重试搜索</button></div>}
          {visible.length ? <><div className="game-grid">{visible.map(renderCard)}</div>{pagination()}</> : <EmptyState title={view === "library" && !Object.keys(library).length ? "从第一款想玩的游戏开始" : "没有找到匹配的游戏"} description={view === "library" && !Object.keys(library).length ? "在发现页点击「想玩」，就能记录游玩进度、评分和笔记。" : onlineState === "loading" ? "正在检索更多游戏，请稍候。" : "试试英文原名、其他平台，或清除当前筛选。"} action={<button className="button primary" onClick={() => view === "library" && !Object.keys(library).length ? navigate("discover") : clearFilters()}>{view === "library" && !Object.keys(library).length ? "去发现游戏" : "清除筛选"}</button>}/>}
          {view === "discover" && <p className="catalog-footnote">发售时间以各地区商店和官方公告为准。「待复核」表示原计划日期已过、尚无新证据；公共索引作品可先收藏，再查看来源确认。</p>}
        </>}
        {view === "calendar" && <CalendarView catalog={mergeCatalog(catalog, Object.values(library).map((entry) => entry.game))} query={query} onOpen={setSelected} onUndated={() => { navigate("discover"); setStatus("development"); }}/>}
        {view === "news" && <NewsView onOpen={setSelected}/>}
        {view === "settings" && <SettingsView library={library} onLibrary={setLibrary} storageError={storageError} clearError={() => setStorageError("")} theme={theme} onTheme={setTheme} scale={scale} onScale={setScale} density={density} onDensity={setDensity} feed={feed} syncState={syncState} refresh={refresh} notify={setToast}/>}
      </main><footer className="app-footer"><span>发售信号 · 你的下一次冒险</span><span>资料和图片归各权利人所有 · 个人记录仅本机保存</span></footer></div>
    <nav className="mobile-nav" aria-label="移动端导航">{[...navigation, { id: "settings" as View, label: "设置", icon: "settings" }].map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/><span>{item.id === "library" ? "游戏架" : item.id === "news" ? "情报" : item.label.replace("游戏", "")}</span></button>)}</nav>
    {selected && <GameDetail key={selected.id} game={selected} entry={library[selected.id]} disabled={!ready || !!storageError} onClose={() => setSelected(null)} onSave={(status, scores, notes) => { setLibrary((current) => ({ ...current, [selected.id]: { game: selected, status, scores, notes, updatedAt: new Date().toISOString() } })); setToast("游戏记录已保存"); }} onRemove={() => { setLibrary((current) => { const next = { ...current }; delete next[selected.id]; return next; }); setToast("已从游戏架移除"); setSelected(null); }}/>}
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast("")} aria-label="关闭通知"><Icon name="close"/></button></div>}
  </div>;
}
