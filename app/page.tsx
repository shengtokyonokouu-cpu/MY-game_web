"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import snapshot from "./data/discovered.json";
import { SNAPSHOT_DATE } from "./data/games";
import { averageScore, curatedGames, libraryLabels, matchesQuery, mergeCatalog, releaseLabels, releaseState, type CatalogFeed, type CatalogGame, type LibraryStatus, type ReleaseState } from "./lib/catalog";
import { EmptyState, GameCover, Icon } from "./components/ui";
import { mergeNames, type GameNames } from "./lib/game-names";
import { GameNameRows } from "./components/game-names";
import { GameDetail } from "./components/game-detail";
import { CalendarView, SettingsView } from "./components/views";
import { LiveNewsView } from "./components/news-view";
import { AccountPanel } from "./components/account-panel";
import { usePersonalLibrary } from "./lib/use-personal-library";
import { IPProvider, useIP } from "./components/ip-provider";
import { IPDirectory, IPFacets, IPHub, IPNavigation, IPTags, IPSearch, PopularIPs, FollowingFeed, NotificationCenter } from "./components/ip-components";
import { franchiseById, gameFranchises } from "./lib/franchises";

type View = "discover" | "calendar" | "library" | "news" | "settings" | "ips" | "ip" | "notifications";
const navigation: { id: View; label: string; icon: string }[] = [{ id: "discover", label: "发现游戏", icon: "discover" }, { id: "calendar", label: "发售日历", icon: "calendar" }, { id: "library", label: "我的游戏架", icon: "library" }, { id: "news", label: "游戏新闻", icon: "news" }, { id: "ips", label: "IP 频道", icon: "tag" }];
const initialFeed = snapshot as CatalogFeed;
const initialCatalog = mergeCatalog(curatedGames, initialFeed.items);
const PAGE_SIZE = 12;
export const platforms = ["PC", "PS5", "PS4", "Switch 2", "Switch", "Xbox", "iOS", "Android"];

export default function Home() {
  const cloud = usePersonalLibrary();
  return <IPProvider key={cloud.session.user?.id || "guest"} session={cloud.session}><Workspace cloud={cloud}/></IPProvider>;
}
function Workspace({ cloud }: { cloud: ReturnType<typeof usePersonalLibrary> }) {
  const [routeReady, setRouteReady] = useState(false);
  const [view, setView] = useState<View>("discover");
  const [feed, setFeed] = useState<CatalogFeed>(initialFeed);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const ipStore = useIP();
  const [ipFilter, setIPFilter] = useState("all");
  const [hubId, setHubId] = useState("");
  const [homeTab, setHomeTab] = useState("discover");
  const { library, setLibrary, ready, storageError } = cloud;
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
  const [nameRecords, setNameRecords] = useState<Record<string, { names?: GameNames; image?: string }>>({});
  const attemptedNames = useRef(new Set<string>());
  const [onlineResults, setOnlineResults] = useState<CatalogGame[]>([]);
  const [onlineState, setOnlineState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [searchSources, setSearchSources] = useState<{ name: string; ok: boolean; count: number }[]>([]);
  const [searchRetry, setSearchRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let preferences: { theme?: string; scale?: number; density?: string } = {};
    try {
      preferences = JSON.parse(localStorage.getItem("release-signal-preferences-v2") || "{}");
      preferences.theme ??= localStorage.getItem("release-signal-theme-v1") || "light";
    } catch { /* Use default appearance when browser preferences are unavailable. */ }
    queueMicrotask(() => {
      setTheme(preferences.theme === "dark" ? "dark" : "light");
      setScale(typeof preferences.scale === "number" && preferences.scale >= .9 && preferences.scale <= 1.5 ? preferences.scale : 1);
      setDensity(preferences.density === "compact" ? "compact" : "comfortable");
      const params = new URLSearchParams(location.search); const wanted = params.get("view");
      if (["discover", "calendar", "library", "news", "settings", "ips", "ip", "notifications"].includes(wanted || "")) setView(wanted as View);
      setQuery(params.get("q") || ""); setHubId(params.get("ip") || ""); setHomeTab(params.get("tab") === "following" ? "following" : "discover"); setIPFilter(franchiseById(params.get("series") || "") ? params.get("series")! : "all"); setPlatform(params.get("platform") || "all"); const id = params.get("game");
      if (id) setSelected(initialCatalog.find((game) => game.id === id) ?? null);
      if (params.has("auth_error")) setToast("GitHub 登录未完成，请在账号设置中重试。");
      setRouteReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty("--ui-scale", String(scale));
    try { localStorage.setItem("release-signal-preferences-v2", JSON.stringify({ theme, scale, density })); } catch { /* Session-local preferences remain usable. */ }
  }, [theme, scale, density, ready]);
  useEffect(() => {
    if (!ready || !routeReady) return; const url = new URL(location.href);
    for (const [key, value] of [["view", view === "discover" ? "" : view], ["q", query], ["game", selected?.id || ""], ["ip", view === "ip" ? hubId : ""], ["series", ipFilter === "all" ? "" : ipFilter], ["platform", platform === "all" ? "" : platform], ["tab", view === "discover" && homeTab === "following" ? "following" : ""]]) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    history.replaceState(null, "", url);
  }, [view, query, selected, ready, routeReady, hubId, ipFilter, platform, homeTab]);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(location.search); const wanted = params.get("view") || "discover"; setView((["discover", "calendar", "library", "news", "settings", "ips", "ip", "notifications"].includes(wanted) ? wanted : "discover") as View); setHubId(params.get("ip") || ""); setQuery(params.get("q") || ""); setIPFilter(params.get("series") || "all"); setPlatform(params.get("platform") || "all"); setHomeTab(params.get("tab") === "following" ? "following" : "discover"); setSelected(null); setPage(1); };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const refresh = useCallback(async () => {
    setSyncState("loading");
    try { const response = await fetch("/api/catalog", { signal: AbortSignal.timeout(40000) }); if (!response.ok) throw new Error(); const next = await response.json() as CatalogFeed; if (!Array.isArray(next.items) || !next.items.length) throw new Error(); setFeed(next); setSyncState(next.stale ? "error" : "ready"); } catch { setSyncState("error"); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 200); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30 * 60 * 1000); return () => { clearTimeout(timer); clearInterval(interval); }; }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2 || view !== "discover" || homeTab !== "discover") { setOnlineResults([]); setOnlineState("idle"); return; }
      setOnlineResults([]); setSearchSources([]); setOnlineState("loading");
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
        .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((data: { items: CatalogGame[]; sources?: { name: string; ok: boolean; count: number }[] }) => { if (!controller.signal.aborted) { setOnlineResults(data.items); setSearchSources(data.sources || []); setOnlineState("ready"); } })
        .catch(() => { if (!controller.signal.aborted) { setOnlineResults([]); setOnlineState("error"); } });
    }, 400); return () => { clearTimeout(timer); controller.abort(); };
  }, [query, view, searchRetry, homeTab]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);

  const catalog = useMemo(() => mergeCatalog(curatedGames, feed.items), [feed.items]);
  const searchable = useMemo(() => mergeCatalog(catalog, onlineResults).map((game) => {
    const record = nameRecords[game.id]; if (!record) return game;
    const names = mergeNames(game.names, record.names);
    return { ...game, names, image: game.image || record.image, title: names.zh?.text || game.title, originalTitle: names.en?.text || game.originalTitle };
  }), [catalog, onlineResults, nameRecords]);
  const genres = Array.from(new Set(catalog.flatMap((game) => game.genres))).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh"));
  const counts = catalog.reduce((acc, game) => { acc[releaseState(game)]++; return acc; }, { released: 0, upcoming: 0, development: 0, check: 0 });
  const beforeIP = useMemo(() => {
    const source = view === "library" ? Object.values(library).filter((entry) => shelfFilter === "all" || entry.status === shelfFilter).map((entry) => searchable.find((game) => game.id === entry.game.id) || entry.game) : searchable;
    return source.filter((game) => (view === "library" || status === "all" || releaseState(game) === status) && (platform === "all" || game.platforms.includes(platform)) && (genre === "all" || game.genres.includes(genre)) && (region === "all" || game.region === region) && matchesQuery(game, query)).sort((a, b) => {
      if (sort === "date-asc") return (a.releaseDate || "9999").localeCompare(b.releaseDate || "9999");
      if (sort === "date-desc") return (b.releaseDate || "0000").localeCompare(a.releaseDate || "0000");
      if (sort === "name") return a.title.localeCompare(b.title, "zh");
      if (sort === "rating") return (averageScore(library[b.id]?.scores) ?? -1) - (averageScore(library[a.id]?.scores) ?? -1);
      if (view === "library") return (library[b.id]?.updatedAt || "").localeCompare(library[a.id]?.updatedAt || "");
      return Number(!!b.featured) - Number(!!a.featured) || (b.releaseDate || "").localeCompare(a.releaseDate || "");
    });
  }, [view, library, shelfFilter, searchable, status, platform, genre, region, query, sort]);
  const filtered = useMemo(() => beforeIP.filter((game) => ipFilter === "all" || gameFranchises(game).some((ip) => ip.id === ipFilter)), [beforeIP, ipFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pages); const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visibleIds = visible.map((game) => game.id).join(",");
  useEffect(() => {
    if (view !== "discover" && view !== "library") return;
    const attempted = attemptedNames.current;
    const games = visibleIds.split(",").map((id) => searchable.find((game) => game.id === id)).filter((game): game is CatalogGame => !!game && !(game.names?.zh && game.names?.ja && game.names?.en) && !attempted.has(game.id));
    if (!games.length) return;
    // Each request is bounded to 3 identities / 12 upstream calls. No unbounded
    // catalog-wide query burst, and no writes to personal records.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const ids = games.map((game) => game.id); ids.forEach((id) => attempted.add(id));
      for (let i = 0; i < ids.length; i += 3) {
        const batch = ids.slice(i, i + 3);
        void fetch("/api/names?ids=" + encodeURIComponent(batch.join(",")), { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(); return response.json();
        }).then((data: { items: { id: string; names?: GameNames; image?: string; state: string }[] }) => {
          if (controller.signal.aborted) return;
          setNameRecords((current) => ({ ...current, ...Object.fromEntries(data.items.filter((item) => item.names).map((item) => [item.id, item])) }));
        }).catch(() => { /* Existing names remain visible when a source is down. */ });
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); games.forEach((game) => attempted.delete(game.id)); };
  // Only a page/view change starts lookup; returned metadata must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, view]);
  const latestDirect = catalog.flatMap((game) => game.events || []).sort((a, b) => b.date.localeCompare(a.date))[0];
  const shelfCounts = Object.values(library).reduce((acc, entry) => { acc[entry.status]++; return acc; }, { wishlist: 0, playing: 0, finished: 0, paused: 0 });
  function navigate(next: View) { const url = new URL(location.href); url.search = next === "discover" ? "" : `?view=${next}`; history.pushState(null, "", url); setIPFilter("all"); setHomeTab("discover"); setView(next); setPage(1); setQuery(""); setOnlineResults([]); setPlatform("all"); setGenre("all"); setRegion("all"); setStatus("all"); window.scrollTo({ top: 0 }); }
  function openIP(id: string) { navigate("ip"); setHubId(id); setSelected(null); }
  function pickIP(id: string) { setIPFilter(id); setPage(1); }
  function clearFilters() { setIPFilter("all"); setQuery(""); setPlatform("all"); setGenre("all"); setRegion("all"); setStatus("all"); setShelfFilter("all"); setPage(1); }
  function saveGame(game: CatalogGame) { setLibrary((current) => ({ ...current, [game.id]: { game, notes: "", scores: {}, status: "wishlist", updatedAt: new Date().toISOString() } })); setToast("已加入「想玩」"); }
  function changePage(next: number) { setPage(next); document.getElementById("results")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  function renderCard(game: CatalogGame, index: number) {
    const entry = library[game.id]; const average = averageScore(entry?.scores);
    return <article className="game-card" key={game.id}><button className="card-image-button" onClick={() => setSelected(game)} aria-label={`查看${game.title}`}><GameCover key={game.id} game={game} eager={index < 4}/><span className={`release-pill ${releaseState(game)}`}>{releaseLabels[releaseState(game)]}</span></button><div className="card-body"><div className="card-date"><time>{game.releaseDate?.replaceAll("-", ".") || game.dateLabel || "日期待定"}</time><span className={`source-dot ${game.source.type}`} title={game.source.label}>{game.source.type === "official" ? "官方来源" : game.source.type === "store" ? "商店资料" : "公共索引"}</span></div><h2><button onClick={() => setSelected(game)}>{game.title}</button></h2><GameNameRows game={game}/><IPTags items={gameFranchises(game)}/><p className="card-developer">{game.developer || game.originalTitle}</p><div className="platforms">{game.platforms.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{game.platforms.length > 4 && <span>+{game.platforms.length - 4}</span>}{!game.platforms.length && <span>平台待确认</span>}</div><div className="card-footer"><span className="card-genre">{average !== null ? `我的评分 ${average.toFixed(1)}` : game.genres.slice(0, 2).join(" · ") || "类型待确认"}</span><button className={`save-button ${entry ? "saved" : ""}`} disabled={!ready || cloud.cacheBlocked || (!!storageError && !cloud.session.user)} onClick={() => entry ? setSelected(game) : saveGame(game)} aria-label={entry ? `管理${game.title}` : `收藏${game.title}`}><Icon name={entry ? "check" : "plus"}/>{entry ? libraryLabels[entry.status] : "想玩"}</button></div></div></article>;
  }
  function pagination() {
    if (pages <= 1) return null; const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter((value) => value === 1 || value === pages || Math.abs(value - currentPage) <= 1);
    return <nav className="pagination" aria-label="游戏目录分页"><button className="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</button><div>{numbers.map((value, index) => <span key={value}>{index > 0 && value > numbers[index - 1] + 1 && <i>…</i>}<button aria-label={`第 ${value} 页`} aria-current={currentPage === value ? "page" : undefined} className={value === currentPage ? "active" : ""} onClick={() => changePage(value)}>{value}</button></span>)}</div><button className="button" disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>下一页</button></nav>;
  }
  function filters() { return <><PopularIPs value={ipFilter} onChange={pickIP}/><div className="filters"><label><span>平台</span><select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}><option value="all">全部平台</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>类型</span><select value={genre} onChange={(e) => { setGenre(e.target.value); setPage(1); }}><option value="all">全部类型</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>地区</span><select value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }}><option value="all">全部地区</option><option>日本</option><option>欧美</option><option>其他</option><option value="">待确认</option></select></label><label className="sort-control"><span>排序</span><select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="recommended">{view === "library" ? "最近更新" : "精选优先"}</option><option value="date-desc">日期：从新到旧</option><option value="date-asc">日期：从旧到新</option><option value="name">游戏名称</option><option value="rating">我的评分</option></select></label></div><div id="results" className="results-meta"><span>共 <strong>{filtered.length}</strong> 部游戏{filtered.length > PAGE_SIZE && ` · 第 ${currentPage} / ${pages} 页`}{onlineState === "loading" && query.length > 1 && " · 正在搜索更多…"}</span>{(query || ipFilter !== "all" || platform !== "all" || genre !== "all" || region !== "all" || status !== "all" || shelfFilter !== "all") && <button className="text-button" onClick={clearFilters}>清除筛选 <Icon name="close"/></button>}</div></>; }

  return <IPNavigation.Provider value={openIP}><div className={`app-shell density-${density}`}><a className="skip-link" href="#main">跳转到内容</a><aside className="sidebar"><button className="brand" onClick={() => navigate("discover")}><span className="brand-mark"><Icon name="game"/></span><span>发售信号<small>RELEASE SIGNAL</small></span></button><p className="sidebar-label">你的游戏空间</p><nav aria-label="主要导航">{navigation.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/>{item.label}{item.id === "library" && <small>{Object.keys(library).length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="online-indicator"/>公开来源 · 持续更新<small>{cloud.session.user ? `@${cloud.session.user.login} · ${cloud.syncState === "synced" ? "已云同步" : "查看同步状态"}` : "登录后可跨设备同步"}</small></div><button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Icon name="settings"/>设置与数据</button></div></aside>
    <div className="workspace"><header className="app-header"><div className="breadcrumb">我的空间 <span>/</span> {navigation.find((item) => item.id === view)?.label || (view === "ip" ? franchiseById(hubId)?.name || "IP 频道" : view === "notifications" ? "通知中心" : "设置与数据")}</div><IPSearch query={query} catalog={searchable} inputRef={searchRef} onChange={(value) => { setQuery(value); setOnlineResults([]); setPage(1); if (!["discover", "library", "calendar", "news"].includes(view)) setView("discover"); }}/><button className="icon-button notification-button" aria-label={`通知中心，${ipStore.unread} 条未读`} onClick={() => navigate("notifications")}><Icon name="bell"/>{ipStore.unread > 0 && <span>{ipStore.unread > 99 ? "99+" : ipStore.unread}</span>}</button><button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? "切换为深色主题" : "切换为浅色主题"}><Icon name={theme === "light" ? "moon" : "sun"}/></button><button className="profile-button" onClick={() => navigate("settings")} aria-label="个人设置">我</button></header>
      <main id="main" className="main-content">{ipStore.error && <div className="notice error" role="alert">{ipStore.error}<button disabled={ipStore.busy} onClick={() => void ipStore.retry()}>重试云端读取</button></div>}{view === "discover" && <div className="home-feed-tabs" role="group" aria-label="首页内容"><button className={homeTab === "discover" ? "active" : ""} aria-pressed={homeTab === "discover"} onClick={() => setHomeTab("discover")}>发现游戏</button><button className={homeTab === "following" ? "active" : ""} aria-pressed={homeTab === "following"} onClick={() => setHomeTab("following")}>我的关注<small>{ipStore.following.length}</small></button></div>}{view === "discover" && homeTab === "following" && <FollowingFeed query={query}/>}{storageError && <div className="notice error" role="alert">{storageError}<button onClick={() => navigate("settings")}>打开数据管理</button></div>}
        {((view === "discover" && homeTab === "discover") || view === "library") && <><div className="page-heading"><div><p className="eyebrow">{view === "discover" ? "DISCOVER YOUR NEXT GAME" : "YOUR PERSONAL COLLECTION"}</p><h1>{view === "discover" ? "发现下一款好游戏" : "我的游戏架"}</h1><p>{view === "discover" ? "从新作到下一次冒险，找到值得投入的世界。" : "收藏、游玩进度、四维评价，都在这里。"}</p></div>{view === "discover" ? <button className="button" onClick={() => void refresh()} disabled={syncState === "loading"}><Icon name="refresh" className={syncState === "loading" ? "spin" : ""}/>{syncState === "loading" ? "正在更新" : "更新游戏"}</button> : <button className="button" onClick={() => navigate("settings")}><Icon name="download"/>备份记录</button>}</div>
          {view === "discover" ? <><div className="catalog-summary"><span><strong>{catalog.length}</strong> 部收录</span><span><strong>{counts.upcoming}</strong> 部将发布</span><span><strong>{Object.keys(library).length}</strong> 部在游戏架</span><span className="updated-text">{feed.updatedAt ? `目录更新 ${feed.updatedAt.slice(0, 10)}` : `精选快照 ${SNAPSHOT_DATE}`}</span></div>{syncState === "error" && <div className="notice">新数据暂时无法更新，已保留上次可用目录。<button onClick={() => void refresh()}>重试</button></div>}<div className="status-tabs" role="group" aria-label="发售状态筛选">{(["all", "released", "upcoming", "development", "check"] as const).map((value) => <button key={value} className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === "all" ? "全部游戏" : releaseLabels[value]}<small>{value === "all" ? catalog.length : counts[value]}</small></button>)}</div></> : <div className="status-tabs" role="group" aria-label="游戏架筛选">{(["all", "wishlist", "playing", "finished", "paused"] as const).map((value) => <button key={value} className={shelfFilter === value ? "active" : ""} aria-pressed={shelfFilter === value} onClick={() => { setShelfFilter(value); setPage(1); }}>{value === "all" ? "全部收藏" : libraryLabels[value]}<small>{value === "all" ? Object.keys(library).length : shelfCounts[value]}</small></button>)}</div>}
          {view === "discover" && !query && latestDirect && <div className="discovery-sources"><button className="text-button" onClick={() => { clearFilters(); setQuery(`Nintendo Direct ${latestDirect.date}`); }}>查看 {latestDirect.title} 的游戏</button><span>官方目录每 30 分钟检查；中日英名称按公开资料补充</span></div>}{filters()}{view === "discover" && query.length > 1 && onlineState === "ready" && <div className="search-sources" aria-live="polite">{searchSources.map((source) => <span key={source.name} className={source.ok ? "" : "danger"}>{source.name} · {source.ok ? `${source.count} 条匹配` : "暂不可用，已保留其他来源结果"}</span>)}</div>}{onlineState === "error" && query.length > 1 && view === "discover" && <div className="notice">在线搜索暂时不可用，以下为本地目录结果。<button onClick={() => setSearchRetry((value) => value + 1)}>重试搜索</button></div>}
          <div className={query ? "search-results-layout" : ""}>{query && <IPFacets games={beforeIP} query={query} value={ipFilter} onChange={pickIP}/>}<div className="search-results-main">{visible.length ? <><div className="game-grid">{visible.map(renderCard)}</div>{pagination()}</> : <EmptyState title={view === "library" && !Object.keys(library).length ? "从第一款想玩的游戏开始" : "没有找到匹配的游戏"} description={view === "library" && !Object.keys(library).length ? "在发现页点击「想玩」，就能记录游玩进度、评分和笔记。" : onlineState === "loading" ? "正在检索更多游戏，请稍候。" : "支持中日英名称；可切换平台或清除筛选，来源缺失时也欢迎提供官方链接。"} action={<button className="button primary" onClick={() => view === "library" && !Object.keys(library).length ? navigate("discover") : clearFilters()}>{view === "library" && !Object.keys(library).length ? "去发现游戏" : "清除筛选"}</button>}/>}</div></div>
          {view === "discover" && <p className="catalog-footnote">名称支持中日英原文检索；未取得可靠名称的语言不猜译。发售时间以各地区商店和官方公告为准。「待复核」表示原计划日期已过、尚无新证据；公共索引作品可先收藏，再查看来源确认。</p>}
        </>}
        {view === "calendar" && <CalendarView catalog={mergeCatalog(searchable, Object.values(library).map((entry) => entry.game))} query={query} onOpen={setSelected} onUndated={() => { navigate("discover"); setStatus("development"); }}/>}
        {view === "news" && <LiveNewsView query={query} catalog={searchable} onOpen={setSelected} ipFilter={ipFilter} onIPFilter={pickIP} platform={platform} onPlatform={setPlatform}/>}
        {view === "ips" && <IPDirectory catalog={searchable}/>}
        {view === "ip" && <IPHub key={hubId} id={hubId} catalog={searchable} onOpen={setSelected} onBack={() => navigate("ips")}/>}
        {view === "notifications" && <NotificationCenter/>}
        {view === "settings" && <SettingsView account={<AccountPanel cloud={cloud}/>} cloudUser={cloud.session.user?.id} library={library} onLibrary={setLibrary} storageError={storageError} clearError={cloud.clearError} theme={theme} onTheme={setTheme} scale={scale} onScale={setScale} density={density} onDensity={setDensity} feed={feed} syncState={syncState} refresh={refresh} notify={setToast}/>}
      </main><footer className="app-footer"><span>发售信号 · 你的下一次冒险</span><span>资料和图片归各权利人所有 · 登录后支持云同步</span></footer></div>
    <nav className="mobile-nav" aria-label="移动端导航">{[...navigation, { id: "settings" as View, label: "设置", icon: "settings" }].map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/><span>{item.id === "library" ? "游戏架" : item.id === "news" ? "情报" : item.label.replace("游戏", "")}</span></button>)}</nav>
    {selected && <GameDetail key={selected.id} game={searchable.find((game) => game.id === selected.id) || selected} entry={library[selected.id]} disabled={!ready || cloud.cacheBlocked || (!!storageError && !cloud.session.user)} onClose={() => setSelected(null)} onSave={(status, scores, notes) => { setLibrary((current) => ({ ...current, [selected.id]: { game: searchable.find((game) => game.id === selected.id) || selected, status, scores, notes, updatedAt: new Date().toISOString() } })); setToast(cloud.session.user ? "修改已保存，正在同步到云端" : "游戏记录已保存到本机"); }} onRemove={() => { setLibrary((current) => { const next = { ...current }; delete next[selected.id]; return next; }); setToast("已从游戏架移除"); setSelected(null); }}/>}
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast("")} aria-label="关闭通知"><Icon name="close"/></button></div>}
  </div></IPNavigation.Provider>;
}
