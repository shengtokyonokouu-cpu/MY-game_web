"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import snapshot from "./data/discovered.json";
import { SNAPSHOT_DATE } from "./data/games";
import { experienceScore, curatedGames, libraryLabels, matchesQuery, mergeCatalog, releaseLabels, releaseState, type CatalogFeed, type CatalogGame, type LibraryStatus } from "./lib/catalog";
import { EmptyState, GameCover, Icon } from "./components/ui";
import { detectLanguage, mergeNames, type GameNames } from "./lib/game-names";
import { GameNameRows } from "./components/game-names";
import { GameDetail } from "./components/game-detail";
import { CalendarView, SettingsView } from "./components/views";
import { LiveNewsView } from "./components/news-view";
import { AccountPanel } from "./components/account-panel";
import { usePersonalLibrary } from "./lib/use-personal-library";
import { IPProvider, useIP } from "./components/ip-provider";
import { IPDirectory, IPFacets, IPHub, IPNavigation, IPTags, IPSearch, PopularIPs, FollowingFeed, FollowStorageNotice, NotificationCenter } from "./components/ip-components";
import { publicData } from "./lib/public-data";
import { canRecordGame, searchRank } from "./lib/game-identity";
import { changeLibraryStatus } from "./lib/catalog";
import { gameFacets, gameplayOptions, themeOptions, modeOptions, platformMatch, releaseWindow } from "./lib/game-facets";
import { useBrowseRoute } from "./lib/use-browse-route";
import { defaultRoute, type View } from "./lib/browse-route";

const navigation: { id: View; label: string; icon: string }[] = [{ id: "discover", label: "发现游戏", icon: "discover" }, { id: "calendar", label: "发售日历", icon: "calendar" }, { id: "library", label: "我的游戏架", icon: "library" }, { id: "news", label: "游戏新闻", icon: "news" }, { id: "ips", label: "IP 频道", icon: "tag" }];
const initialFeed = snapshot as CatalogFeed;
const PAGE_SIZE = 12;
export const platforms = ["PC", "PS5", "PS4", "Switch 2", "Switch", "Xbox", "iOS", "Android"];

export default function Home() {
  const cloud = usePersonalLibrary();
  return <IPProvider key={cloud.session.user?.id || "guest"} session={cloud.session}><Workspace cloud={cloud}/></IPProvider>;
}
function Workspace({ cloud }: { cloud: ReturnType<typeof usePersonalLibrary> }) {
  const {route, update: updateRoute, ready: routeReady} = useBrowseRoute();
  const {view, query, status, platform, genre, region, sort, page, shelfFilter, ipFilter, hubId, homeTab, themeFilter, mode, window: dateWindow} = route;
  const setPage=(page:number)=>updateRoute({page});
  const setIPFilter=(ipFilter:string)=>updateRoute({ipFilter,page:1});
  const setPlatform=(platform:string)=>updateRoute({platform,page:1});
  const setStatus=(status:string)=>updateRoute({status,page:1});
  const setShelfFilter=(shelfFilter:string)=>updateRoute({shelfFilter,page:1});
  const setHomeTab=(homeTab:string)=>updateRoute({homeTab});
  const [feed, setFeed] = useState<CatalogFeed>(initialFeed);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const ipStore = useIP(); const { franchiseById, gameFranchises } = ipStore;
  const { library, setLibrary, ready, storageError } = cloud;
  const [selected, setSelected] = useState<CatalogGame | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry,setDetailRetry] = useState(0);
  const openedGames=useRef(new Map<string,CatalogGame>());
  const [advanced,setAdvanced] = useState(false);
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
      const params = new URLSearchParams(location.search);
      if (params.has("auth_error")) setToast("GitHub 登录未完成，请在账号设置中重试。");
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty("--ui-scale", String(scale));
    try { localStorage.setItem("release-signal-preferences-v2", JSON.stringify({ theme, scale, density })); } catch { /* Session-local preferences remain usable. */ }
  }, [theme, scale, density, ready]);
  const refresh = useCallback(async () => {
    setSyncState("loading");
    try { const next = await publicData<CatalogFeed>("catalog.json"); if (!Array.isArray(next.items) || !next.items.length) throw new Error(); setFeed(next); setSyncState(next.stale ? "error" : "ready"); } catch { setSyncState("error"); }
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

  const catalog = useMemo(() => mergeCatalog(curatedGames, feed.items).filter(canRecordGame), [feed.items]);
  const searchable = useMemo(() => mergeCatalog(catalog, onlineResults).map((game) => {
    const record = nameRecords[game.id]; if (!record) return game;
    const names = mergeNames(game.names, record.names);
    return { ...game, names, image: game.image || record.image, title: names.zh?.text || game.title, originalTitle: names.en?.text || game.originalTitle };
  }), [catalog, onlineResults, nameRecords]);
  useEffect(()=>{
    if(!routeReady)return;
    setDetailError("");
    if(!route.game){setSelected(null);return;}
    const known=openedGames.current.get(route.game)||searchable.find(g=>g.id===route.game)||library[route.game]?.game;
    if(known){setSelected(known);return;}
    setSelected(null);const controller=new AbortController();
    const params=new URLSearchParams({id:route.game,title:route.title,lang:route.lang});
    void fetch(`/api/games?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);return data.game as CatalogGame;}).then(game=>{if(!controller.signal.aborted){openedGames.current.set(game.id,game);setSelected(game);}}).catch(e=>{if(!controller.signal.aborted)setDetailError(e instanceof Error?e.message:"无法加载游戏详情");});
    return()=>controller.abort();
  },[route.game,route.title,route.lang,routeReady,searchable,library,detailRetry]);
  const counts = catalog.reduce((acc, game) => { acc[releaseState(game)]++; return acc; }, { released: 0, upcoming: 0, development: 0, check: 0 });
  const beforeIP = useMemo(() => {
    const source = view === "library" ? Object.values(library).filter((entry) => shelfFilter === "all" || entry.status === shelfFilter).map((entry) => searchable.find((game) => game.id === entry.game.id) || entry.game) : searchable;
    return source.filter((game) => (view === "library" || canRecordGame(game)) && (view === "library" || status === "all" || releaseState(game) === status) && platformMatch(game.platforms,platform) && (genre === "all" || gameFacets(game).gameplay.includes(genre)) && (themeFilter === "all" || gameFacets(game).themes.includes(themeFilter)) && (mode === "all" || gameFacets(game).modes.includes(mode)) && releaseWindow(game,dateWindow) && (region === "all" || game.region === region) && matchesQuery(game, query)).sort((a, b) => {
      if(query && searchRank(a,query)!==searchRank(b,query))return searchRank(b,query)-searchRank(a,query);
      if (sort === "date-asc") return (a.releaseDate || "9999").localeCompare(b.releaseDate || "9999");
      if (sort === "date-desc") return (b.releaseDate || "0000").localeCompare(a.releaseDate || "0000");
      if (sort === "name") return a.title.localeCompare(b.title, "zh");
      if (sort === "rating") return (experienceScore(library[b.id]) ?? -1) - (experienceScore(library[a.id]) ?? -1);
      if (view === "library") return (library[b.id]?.updatedAt || "").localeCompare(library[a.id]?.updatedAt || "");
      return Number(!!b.featured) - Number(!!a.featured) || (b.releaseDate || "").localeCompare(a.releaseDate || "");
    });
  }, [view, library, shelfFilter, searchable, status, platform, genre, region, query, sort,themeFilter,mode,dateWindow]);
  const filtered = useMemo(() => beforeIP.filter((game) => ipFilter === "all" || gameFranchises(game).some((ip) => ip.id === ipFilter)), [beforeIP, ipFilter, gameFranchises]);
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
  function navigate(next: View) { updateRoute({...defaultRoute,view:next},true);setSelected(null);setOnlineResults([]);window.scrollTo({top:0,behavior:"instant"}); }
  function openIP(id: string) { updateRoute({...defaultRoute,view:"ip",hubId:id},true);setSelected(null);window.scrollTo({top:0,behavior:"instant"}); }
  function openGame(game: CatalogGame) { openedGames.current.set(game.id,game);updateRoute({game:game.id,title:game.articleTitle||game.originalTitle,lang:detectLanguage(game.articleTitle||game.originalTitle)},true);setSelected(game); }
  function closeGame() { updateRoute({game:"",title:"",lang:""});setSelected(null); }
  function pickIP(id: string) { setIPFilter(id); setPage(1); }
  function clearFilters() { updateRoute({...defaultRoute,view}); }
  function saveGame(game: CatalogGame) { if(!canRecordGame(game))return;setLibrary((current) => ({ ...current, [game.id]: { game, notes: "", scores: {}, status: "wishlist", updatedAt: new Date().toISOString() } })); setToast("已加入「想玩」"); }
  function changePage(next: number) { setPage(next); document.getElementById("results")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  function renderCard(game: CatalogGame, index: number) {
    const entry = library[game.id]; const average = experienceScore(entry);const facets=gameFacets(game);const valid=canRecordGame(game);
    return <article className="game-card" key={game.id}><button className="card-image-button" onClick={() => openGame(game)} aria-label={`查看${game.title}`}><GameCover key={game.id} game={game} eager={index < 4}/><span className={`release-pill ${releaseState(game)}`}>{releaseLabels[releaseState(game)]}</span></button><div className="card-body"><div className="card-date"><time>{game.releaseDate?.replaceAll("-", ".") || game.dateLabel || "日期待定"}</time><span className={`source-dot ${game.source.type}`} title={game.source.label}>{game.source.type === "official" ? "官方来源" : game.source.type === "store" ? "商店资料" : "公共索引"}</span></div><h2><button onClick={() => openGame(game)}>{game.title}</button></h2><p className="card-summary">{game.fit || game.summary || (facets.gameplay.length ? `${facets.gameplay.join(" / ")}作品，玩法简介待来源补充。` : "玩法简介待补充，可打开详情核对来源。")}</p><div className="decision-tags">{[...new Set([...facets.features,...facets.gameplay,...facets.modes])].slice(0,4).map(tag=><span key={tag}>{tag}</span>)}<span>{game.chineseSupport?.text||"中文支持待确认"}</span></div><IPTags items={gameFranchises(game)}/><div className="platforms">{game.platforms.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{game.platforms.length > 4 && <span>+{game.platforms.length - 4}</span>}{!game.platforms.length && <span>平台待确认</span>}</div><details className="card-aliases"><summary>其他语言名称</summary><GameNameRows game={game}/></details>{!valid&&<p className="danger">旧记录的游戏身份未核验；保留笔记，暂停评分。</p>}<div className="card-footer"><span className="card-genre">{average !== null ? `体验评分 ${average.toFixed(1)}` : entry?.expectation ? `期待 ${entry.expectation} / 5 · 未评价` : entry ? "未评价" : game.developer || "开发商待确认"}</span><button className={`save-button ${entry ? "saved" : ""}`} disabled={!ready || cloud.cacheBlocked || (!!storageError && !cloud.session.user) || (!entry&&!valid)} onClick={() => entry ? openGame(game) : saveGame(game)} aria-label={entry ? `管理${game.title}` : `收藏${game.title}`}><Icon name={entry ? "check" : "plus"}/>{entry ? libraryLabels[entry.status] : "想玩"}</button></div>{view==="library"&&entry&&valid&&<label className="quick-status">游玩状态<select aria-label={`${game.title}游玩状态`} value={entry.status} disabled={!ready||cloud.cacheBlocked|| (!!storageError&&!cloud.session.user)} onChange={e=>{const status=e.target.value as LibraryStatus;setLibrary(current=>({...current,[game.id]:changeLibraryStatus(current[game.id],status)}));}}>{Object.entries(libraryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}</div></article>;
  }
  function pagination() {
    if (pages <= 1) return null; const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter((value) => value === 1 || value === pages || Math.abs(value - currentPage) <= 1);
    return <nav className="pagination" aria-label="游戏目录分页"><button className="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</button><div>{numbers.map((value, index) => <span key={value}>{index > 0 && value > numbers[index - 1] + 1 && <i>…</i>}<button aria-label={`第 ${value} 页`} aria-current={currentPage === value ? "page" : undefined} className={value === currentPage ? "active" : ""} onClick={() => changePage(value)}>{value}</button></span>)}</div><button className="button" disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>下一页</button></nav>;
  }
  function filters() {
    const active=[genre,platform,themeFilter,mode,region,ipFilter,dateWindow].filter(v=>v!=="all").length;
    return <><div className="browse-toolbar"><label>玩法<select value={genre} onChange={e=>updateRoute({genre:e.target.value,page:1})}><option value="all">全部类型</option>{gameplayOptions.map(item=><option key={item}>{item}</option>)}</select></label><button className="button" aria-expanded={advanced} aria-controls="advanced-filters" onClick={()=>setAdvanced(v=>!v)}><Icon name="settings"/>筛选{active ? ` · ${active}` : ""}</button><label className="sort-control"><span className="sr-only">排序</span><select aria-label="排序" value={sort} onChange={e=>updateRoute({sort:e.target.value,page:1})}><option value="recommended">{query?"相关度优先":view==="library"?"最近更新":"精选优先"}</option><option value="date-desc">日期从新到旧</option><option value="date-asc">日期从旧到新</option><option value="name">游戏名称</option><option value="rating">体验评分</option></select></label></div>
      <div id="advanced-filters" className="advanced-filters" hidden={!advanced}><fieldset className="platform-checks"><legend>平台 · 可多选，匹配其中任一平台</legend>{platforms.map(item=><label key={item}><input type="checkbox" checked={platform.split(",").includes(item)} onChange={e=>{const picks=platform.split(",").filter(p=>p!=="all"&&p!==item);if(e.target.checked)picks.push(item);setPlatform(picks.join(",")||"all");}}/>{item}</label>)}</fieldset><div className="filters"><label>题材<select value={themeFilter} onChange={e=>updateRoute({themeFilter:e.target.value,page:1})}><option value="all">全部题材</option>{themeOptions.map(item=><option key={item}>{item}</option>)}</select></label><label>游玩人数 / 模式<select value={mode} onChange={e=>updateRoute({mode:e.target.value,page:1})}><option value="all">全部模式</option>{modeOptions.map(item=><option key={item}>{item}</option>)}</select></label><label>制作地区<select value={region} onChange={e=>updateRoute({region:e.target.value,page:1})}><option value="all">全部地区</option><option>日本</option><option>欧美</option><option>其他</option></select></label></div><PopularIPs value={ipFilter} onChange={pickIP}/><p className="muted">同义玩法已合并；人数、题材分别筛选。无来源的标签保留未知，不推断。</p>{latestDirect&&<button className="text-button" onClick={()=>updateRoute({...defaultRoute,query:`Nintendo Direct ${latestDirect.date}`})}>查看 {latestDirect.title} 的游戏</button>}</div>
      <div id="results" className="results-meta"><span>共 <strong>{filtered.length}</strong> 部游戏{filtered.length>PAGE_SIZE&&` · ${currentPage} / ${pages} 页`}{onlineState==="loading"&&query.length>1&&" · 检索中…"}</span>{(query||active||status!=="all"||shelfFilter!=="all")?<button className="text-button" onClick={clearFilters}>清除筛选 <Icon name="close"/></button>:null}</div>{active>0&&<div className="active-filters" aria-label="当前筛选条件">{[genre,platform,themeFilter,mode,region,dateWindow==="recent"?"近 30 天发售":dateWindow==="month"?"本月新作":"all",ipFilter==="all"?"all":franchiseById(ipFilter)?.name||ipFilter].filter(v=>v!=="all").map((label,i)=><span key={i}>{label.replaceAll(","," / ")}</span>)}</div>}</>;
  }

  return <IPNavigation.Provider value={openIP}><div className={`app-shell density-${density}`}><a className="skip-link" href="#main">跳转到内容</a><aside className="sidebar"><button className="brand" onClick={() => navigate("discover")}><span className="brand-mark"><Icon name="game"/></span><span>发售信号<small>RELEASE SIGNAL</small></span></button><p className="sidebar-label">你的游戏空间</p><nav aria-label="主要导航">{navigation.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/>{item.label}{item.id === "library" && <small>{Object.keys(library).length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="online-indicator"/>公开来源 · 持续更新<small>{cloud.session.user ? `@${cloud.session.user.login} · ${cloud.syncState === "synced" ? "已云同步" : "查看同步状态"}` : "登录后可跨设备同步"}</small></div><button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Icon name="settings"/>设置与数据</button></div></aside>
    <div className="workspace"><header className="app-header"><div className="breadcrumb">我的空间 <span>/</span> {navigation.find((item) => item.id === view)?.label || (view === "ip" ? franchiseById(hubId)?.name || "IP 频道" : view === "notifications" ? "通知中心" : "设置与数据")}</div><IPSearch query={query} catalog={searchable} inputRef={searchRef} onChange={(value) => { updateRoute({query:value,page:1,...(!["discover","library","calendar","news"].includes(view)?{view:"discover"}: {})});setOnlineResults([]); }}/><button className="icon-button notification-button" aria-label={`通知中心，${ipStore.unread} 条未读`} onClick={() => navigate("notifications")}><Icon name="bell"/>{ipStore.unread > 0 && <span>{ipStore.unread > 99 ? "99+" : ipStore.unread}</span>}</button><button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? "切换为深色主题" : "切换为浅色主题"}><Icon name={theme === "light" ? "moon" : "sun"}/></button><button className="profile-button" onClick={() => navigate("settings")} aria-label="个人设置">我</button></header>
      <main id="main" className="main-content">{ipStore.error && <div className="notice error" role="alert">{ipStore.error}{ipStore.user && <button disabled={ipStore.busy} onClick={() => void ipStore.retry()}>重试云端读取</button>}</div>}{view === "discover" && <div className="home-feed-tabs" role="group" aria-label="首页内容"><button className={homeTab === "discover" ? "active" : ""} aria-pressed={homeTab === "discover"} onClick={() => setHomeTab("discover")}>发现游戏</button><button className={homeTab === "following" ? "active" : ""} aria-pressed={homeTab === "following"} onClick={() => setHomeTab("following")}>我的关注<small>{ipStore.following.length}</small></button></div>}{view === "discover" && homeTab === "following" && <FollowingFeed query={query}/>}{storageError && <div className="notice error" role="alert">{storageError}<button onClick={() => navigate("settings")}>打开数据管理</button></div>}
        {((view === "discover" && homeTab === "discover") || view === "library") && <><div className="page-heading browse-heading"><div><h1>{view === "discover" ? "发现下一款好游戏" : "我的游戏架"}</h1></div>{view === "discover" ? <button className="text-button" onClick={() => void refresh()} disabled={syncState === "loading"}><Icon name="refresh" className={syncState === "loading" ? "spin" : ""}/>{syncState === "loading" ? "更新中" : "刷新"}</button> : <button className="text-button" onClick={() => navigate("settings")}><Icon name="download"/>备份</button>}</div>
          {view === "discover" ? <><div className="catalog-summary"><span><strong>{catalog.length}</strong> 部收录</span><span><strong>{counts.upcoming}</strong> 部将发布</span><span><strong>{Object.keys(library).length}</strong> 部在游戏架</span><span className="updated-text">{feed.updatedAt ? `目录更新 ${feed.updatedAt.slice(0, 10)}` : `精选快照 ${SNAPSHOT_DATE}`}</span></div>{syncState === "error" && <div className="notice">新数据暂时无法更新，已保留上次可用目录。<button onClick={() => void refresh()}>重试</button></div>}<div className="status-tabs" role="group" aria-label="发售状态筛选">{(["all", "released", "upcoming", "development", "check"] as const).map((value) => <button key={value} className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === "all" ? "全部游戏" : releaseLabels[value]}<small>{value === "all" ? catalog.length : counts[value]}</small></button>)}</div></> : <div className="status-tabs" role="group" aria-label="游戏架筛选">{(["all", "wishlist", "playing", "finished", "paused"] as const).map((value) => <button key={value} className={shelfFilter === value ? "active" : ""} aria-pressed={shelfFilter === value} onClick={() => { setShelfFilter(value); setPage(1); }}>{value === "all" ? "全部收藏" : libraryLabels[value]}<small>{value === "all" ? Object.keys(library).length : shelfCounts[value]}</small></button>)}</div>}
          {view === "discover" && !query && <div className="quick-windows" aria-label="发售快捷入口">{[["recent","近期发售"],["month","本月新作"]].map(([value,label])=><button key={value} aria-pressed={dateWindow===value} onClick={()=>updateRoute({window:dateWindow===value?"all":value,status:"all",sort:"date-desc",page:1})}>{label} ↗</button>)}</div>}{filters()}{view === "discover" && query.length > 1 && onlineState === "ready" && <details className="search-source-details"><summary>已核验游戏类型 · 精确名称优先 · 查看检索来源</summary><div className="search-sources" aria-live="polite">{searchSources.map((source) => <span key={source.name} className={source.ok ? "" : "danger"}>{source.name} · {source.ok ? `${source.count} 条匹配` : "暂不可用，已保留其他来源结果"}</span>)}</div></details>}{onlineState === "error" && query.length > 1 && view === "discover" && <div className="notice">在线搜索暂时不可用，以下为本地目录结果。<button onClick={() => setSearchRetry((value) => value + 1)}>重试搜索</button></div>}
          <div className={query ? "search-results-layout" : ""}>{query && <IPFacets games={beforeIP} query={query} value={ipFilter} onChange={pickIP}/>}<div className="search-results-main">{visible.length ? <><div className="game-grid">{visible.map(renderCard)}</div>{pagination()}</> : <EmptyState title={view === "library" && !Object.keys(library).length ? "从第一款想玩的游戏开始" : "没有找到匹配的游戏"} description={view === "library" && !Object.keys(library).length ? "在发现页点击「想玩」，就能记录游玩进度、评分和笔记。" : onlineState === "loading" ? "正在检索更多游戏，请稍候。" : "支持中日英名称；可切换平台或清除筛选，来源缺失时也欢迎提供官方链接。"} action={<button className="button primary" onClick={() => view === "library" && !Object.keys(library).length ? navigate("discover") : clearFilters()}>{view === "library" && !Object.keys(library).length ? "去发现游戏" : "清除筛选"}</button>}/>}</div></div>
          {view === "discover" && <p className="catalog-footnote">名称支持中日英原文检索；未取得可靠名称的语言不猜译。发售时间以各地区商店和官方公告为准。「待复核」表示原计划日期已过、尚无新证据；公共索引作品可先收藏，再查看来源确认。</p>}
        </>}
        {((view==="discover"&&homeTab==="following")||view==="ip"||view==="settings")&&<FollowStorageNotice/>}
        {view === "calendar" && <CalendarView catalog={mergeCatalog(searchable, Object.values(library).map((entry) => entry.game)).filter(canRecordGame)} query={query} onOpen={openGame} onUndated={() => { navigate("discover"); setStatus("development"); }}/>}
        {view === "news" && <LiveNewsView query={query} catalog={searchable} onOpen={openGame} ipFilter={ipFilter} onIPFilter={pickIP} platform={platform} onPlatform={setPlatform}/>}
        {view === "ips" && <IPDirectory catalog={searchable}/>}
        {view === "ip" && <IPHub key={hubId} id={hubId} catalog={searchable} onOpen={openGame} onBack={() => navigate("ips")}/>}
        {view === "notifications" && <NotificationCenter/>}
        {view === "settings" && <SettingsView account={<AccountPanel cloud={cloud}/>} cloudUser={cloud.session.user?.id} library={library} onLibrary={setLibrary} storageError={storageError} clearError={cloud.clearError} theme={theme} onTheme={setTheme} scale={scale} onScale={setScale} density={density} onDensity={setDensity} feed={feed} syncState={syncState} refresh={refresh} notify={setToast}/>}
      </main><footer className="app-footer"><span>发售信号 · 你的下一次冒险</span><span>资料和图片归各权利人所有 · 登录后支持云同步</span></footer></div>
    <nav className="mobile-nav" aria-label="移动端导航">{[...navigation, { id: "settings" as View, label: "设置", icon: "settings" }].map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/><span>{item.id === "library" ? "游戏架" : item.id === "news" ? "情报" : item.label.replace("游戏", "")}</span></button>)}</nav>
    {route.game&&!selected&&<div className="detail-loading" role="status">{detailError||"正在恢复游戏详情…"}{detailError&&<button onClick={()=>setDetailRetry(n=>n+1)}>重试</button>}<button onClick={closeGame}>关闭</button></div>}
    {selected && <GameDetail key={selected.id} game={searchable.find((game) => game.id === selected.id) || selected} entry={library[selected.id]} disabled={!ready || cloud.cacheBlocked || (!!storageError && !cloud.session.user)} onClose={closeGame} onSave={(status, scores, notes, expectation, reviewConfirmed) => { if(!canRecordGame(selected))return;setLibrary((current) => ({ ...current, [selected.id]: { game: searchable.find((game) => game.id === selected.id) || selected, status, scores, notes, expectation, reviewConfirmed, updatedAt: new Date().toISOString() } })); setToast(cloud.session.user ? "修改已保存，正在同步到云端" : "游戏记录已保存到本机"); }} onRemove={() => { setLibrary((current) => { const next = { ...current }; delete next[selected.id]; return next; }); setToast("已从游戏架移除"); closeGame(); }}/>}
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast("")} aria-label="关闭通知"><Icon name="close"/></button></div>}
  </div></IPNavigation.Provider>;
}
