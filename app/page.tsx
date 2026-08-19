"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  games,
  platformLabels,
  signals,
  SNAPSHOT_DATE,
  type Game,
  type GameStatus,
  type Platform,
  type ScoreSet,
} from "./data/games";

type View = "radar" | "calendar" | "mine" | "sources";
type ShelfStatus = "interested" | "playing" | "finished" | "paused";
type StatusFilter = "all" | GameStatus;
type SortKey = "recommend" | "date-asc" | "date-desc" | "score";
type Theme = "light" | "dark";
type OnlineState = "idle" | "loading" | "done" | "error";
type FeedState = "loading" | "ready" | "error";
type UiScale = 0.9 | 1 | 1.1 | 1.2;

type OnlineGame = {
  pageid: number;
  title: string;
  extract?: string;
  fullurl: string;
  thumbnail?: { source: string; width: number; height: number };
};

type DiscoveredGame = {
  id: string;
  title: string;
  releaseDate: string | null;
  dateLabel: string;
  status: "released" | "upcoming";
  platforms: string[];
  platformText: string;
  genres: string[];
  developer: string;
  publisher: string;
  articleTitle: string;
  sourceUrl: string;
  image?: string;
  summary?: string;
};

type CatalogItem =
  | { kind: "verified"; game: Game }
  | { kind: "discovered"; game: DiscoveredGame };

const STORAGE_KEY = "release-signal-personal-v1";
const THEME_KEY = "release-signal-theme-v1";
const SCALE_KEY = "release-signal-ui-scale-v1";
const FEED_CACHE_KEY = `release-signal-annual-${new Date().getFullYear()}-next-v2`;
const PAGE_SIZE = 12;
const UI_SCALES: UiScale[] = [0.9, 1, 1.1, 1.2];
const coverCache = new Map<string, string | null>();
const coverRequests = new Map<string, Promise<string | null>>();
const scoreKeys: Array<{ key: keyof ScoreSet; label: string; short: string }> = [
  { key: "gameplay", label: "玩法", short: "玩" },
  { key: "story", label: "剧情", short: "剧" },
  { key: "visuals", label: "画面", short: "画" },
  { key: "music", label: "音乐", short: "乐" },
];

const statusLabels: Record<GameStatus, string> = {
  released: "已发售",
  upcoming: "待发售",
  development: "开发中",
};

const shelfLabels: Record<ShelfStatus, string> = {
  interested: "想玩",
  playing: "在玩",
  finished: "已通关",
  paused: "搁置",
};

function average(scores: ScoreSet) {
  return Object.values(scores).reduce((sum, value) => sum + value, 0) / 4;
}

function daysFromNow(date: string | null) {
  if (!date) return null;
  const release = new Date(`${date}T00:00:00+08:00`).getTime();
  const now = Date.now();
  return Math.ceil((release - now) / 86400000);
}

function countdownLabel(game: Pick<Game, "status" | "releaseDate">) {
  const days = daysFromNow(game.releaseDate);
  if (game.status === "development" || days === null) return "TBA";
  if (days < 0) return "OUT NOW";
  if (days === 0) return "TODAY";
  return `D-${days}`;
}

function artStyle(game: Game): CSSProperties {
  return {
    "--art-accent": game.accent,
    "--art-accent-2": game.accent2,
  } as CSSProperties;
}

function wikipediaLanguage(value: string) {
  return /[\u3400-\u9fff]/.test(value) ? "zh" : "en";
}

async function searchWikipedia(query: string, limit = 8, signal?: AbortSignal): Promise<OnlineGame[]> {
  const language = wikipediaLanguage(query);
  const endpoint = new URL(`https://${language}.wikipedia.org/w/api.php`);
  endpoint.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} ${language === "zh" ? "电子游戏" : "video game"}`,
    gsrnamespace: "0",
    gsrlimit: String(limit),
    prop: "pageimages|extracts|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    piprop: "thumbnail",
    pithumbsize: "640",
    pilimit: String(limit),
    format: "json",
    formatversion: "2",
    origin: "*",
  }).toString();

  const response = await fetch(endpoint, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Wikipedia search failed: ${response.status}`);
  const data = await response.json() as { query?: { pages?: OnlineGame[] } };
  return (data.query?.pages ?? []).filter((item) => item.fullurl && item.title);
}

function cleanCellText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "game";
}

function parseReleaseDate(value: string, year: number) {
  const match = value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i);
  if (!match) return null;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(match[1].toLowerCase()) + 1;
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function expandTable(table: HTMLTableElement) {
  const rows = Array.from(table.rows);
  const carries = new Map<number, { cell: HTMLTableCellElement; remaining: number }>();
  return rows.map((row) => {
    const existingColumns = new Set(carries.keys());
    const expanded: HTMLTableCellElement[] = [];
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while (carries.has(column)) {
        expanded[column] = carries.get(column)!.cell;
        column += 1;
      }
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      for (let offset = 0; offset < colSpan; offset += 1) {
        expanded[column + offset] = cell;
        if (rowSpan > 1) carries.set(column + offset, { cell, remaining: rowSpan - 1 });
      }
      column += colSpan;
    }
    const maxColumn = Math.max(expanded.length, ...Array.from(carries.keys(), (key) => key + 1));
    for (let index = 0; index < maxColumn; index += 1) {
      if (!expanded[index] && carries.has(index)) expanded[index] = carries.get(index)!.cell;
    }
    for (const index of existingColumns) {
      const carry = carries.get(index);
      if (!carry) continue;
      if (carry.remaining <= 1) carries.delete(index);
      else carry.remaining -= 1;
    }
    return expanded;
  });
}

function wikiPageUrl(title: string) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

function parseAnnualReleaseFeed(html: string, year: number): DiscoveredGame[] {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const today = todayLocal();
  const found: DiscoveredGame[] = [];

  for (const table of Array.from(documentNode.querySelectorAll<HTMLTableElement>("table.wikitable"))) {
    const rows = expandTable(table);
    const headerIndex = rows.findIndex((cells) => {
      const headers = cells.map((cell) => cleanCellText(cell.textContent).toLowerCase());
      return headers.includes("title") && (headers.includes("release date") || headers.includes("approximate date"));
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map((cell) => cleanCellText(cell.textContent).toLowerCase());
    const indexOf = (...names: string[]) => headers.findIndex((header) => names.some((name) => header === name || header.startsWith(name)));
    const titleIndex = indexOf("title");
    const dateIndex = indexOf("release date", "approximate date");
    const platformIndex = indexOf("platform");
    const genreIndex = indexOf("genre", "type");
    const developerIndex = indexOf("developer");
    const publisherIndex = indexOf("publisher");

    for (const cells of rows.slice(headerIndex + 1)) {
      const titleCell = cells[titleIndex];
      const dateCell = cells[dateIndex];
      if (!titleCell || !dateCell) continue;
      const title = cleanCellText(titleCell.querySelector("i")?.textContent || titleCell.textContent);
      const dateText = cleanCellText(dateCell.textContent);
      if (!title || title.length > 140 || /^title$/i.test(title)) continue;
      const anchor = titleCell.querySelector<HTMLAnchorElement>('a[rel~="mw:WikiLink"], a[href^="./"]');
      const articleTitle = cleanCellText(anchor?.getAttribute("title")) || title;
      const releaseDate = parseReleaseDate(dateText, year);
      const status: DiscoveredGame["status"] = releaseDate && releaseDate <= today ? "released" : "upcoming";
      const platformText = cleanCellText(cells[platformIndex]?.textContent) || "平台待核验";
      const genres = cleanCellText(cells[genreIndex]?.textContent).split(/,|\/|;/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
      const sourceUrl = articleTitle ? wikiPageUrl(articleTitle) : `https://en.wikipedia.org/wiki/List_of_video_games_released_in_${year}`;
      found.push({
        id: `auto-${slugify(title)}-${releaseDate ?? slugify(dateText)}`,
        title,
        releaseDate,
        dateLabel: releaseDate?.replaceAll("-", ".") ?? (dateText || "TBA"),
        status,
        platforms: platformText.split(/,|\/|;|\band\b/i).map((item) => item.trim()).filter(Boolean).slice(0, 6),
        platformText,
        genres,
        developer: cleanCellText(cells[developerIndex]?.textContent) || "开发商待核验",
        publisher: cleanCellText(cells[publisherIndex]?.textContent) || "发行商待核验",
        articleTitle,
        sourceUrl,
      });
    }
  }

  const unique = Array.from(new Map(found.map((game) => [`${game.title.toLowerCase()}|${game.releaseDate ?? game.dateLabel}`, game])).values());
  const released = unique.filter((game) => game.status === "released" && game.releaseDate).sort((a, b) => b.releaseDate!.localeCompare(a.releaseDate!)).slice(0, 96);
  const datedUpcoming = unique.filter((game) => game.status === "upcoming" && game.releaseDate).sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!)).slice(0, 144);
  const undated = unique.filter((game) => !game.releaseDate).slice(0, 48);
  return [...released, ...datedUpcoming, ...undated];
}

async function enrichDiscoveredGames(items: DiscoveredGame[], signal?: AbortSignal) {
  const chunks: DiscoveredGame[][] = [];
  for (let index = 0; index < items.length; index += 50) chunks.push(items.slice(index, index + 50));
  const details = new Map<string, { image?: string; summary?: string; fullurl?: string }>();

  await Promise.all(chunks.map(async (chunk) => {
    const endpoint = new URL("https://en.wikipedia.org/w/api.php");
    endpoint.search = new URLSearchParams({
      action: "query",
      titles: chunk.map((item) => item.articleTitle).join("|"),
      redirects: "1",
      prop: "pageimages|extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exsentences: "2",
      piprop: "thumbnail",
      pithumbsize: "720",
      pilimit: String(chunk.length),
      format: "json",
      formatversion: "2",
      origin: "*",
    }).toString();
    const response = await fetch(endpoint, { signal, headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json() as {
      query?: {
        normalized?: Array<{ from: string; to: string }>;
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<OnlineGame & { missing?: boolean }>;
      };
    };
    const aliases = new Map(chunk.map((item) => [item.articleTitle, item.articleTitle]));
    for (const item of data.query?.normalized ?? []) aliases.set(item.from, item.to);
    for (const item of data.query?.redirects ?? []) aliases.set(item.from, item.to);
    const pageMap = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));
    for (const item of chunk) {
      let target = aliases.get(item.articleTitle) ?? item.articleTitle;
      target = aliases.get(target) ?? target;
      const page = pageMap.get(target);
      if (page && !page.missing) details.set(item.id, { image: page.thumbnail?.source, summary: page.extract, fullurl: page.fullurl });
    }
  }));

  return items.map((item) => ({ ...item, ...details.get(item.id), sourceUrl: details.get(item.id)?.fullurl ?? item.sourceUrl }));
}

async function fetchAnnualReleaseFeed(signal?: AbortSignal) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  const responses = await Promise.allSettled(years.map(async (year) => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/List_of_video_games_released_in_${year}`;
    const response = await fetch(url, { signal, headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`Annual release feed ${year} failed: ${response.status}`);
    return parseAnnualReleaseFeed(await response.text(), year);
  }));
  const parsed = responses.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!parsed.length) throw new Error("Annual release feeds are unavailable");
  const unique = Array.from(new Map(parsed.map((game) => [`${game.title.toLowerCase()}|${game.releaseDate ?? game.dateLabel}`, game])).values());
  return enrichDiscoveredGames(unique, signal);
}

function matchesPlatform(value: string, platform: Platform) {
  const normalized = value.toLowerCase();
  if (platform === "NS2") return /\bns2\b|switch 2/.test(normalized);
  if (platform === "Switch") return /\bns\b|nintendo switch/.test(normalized) && !/switch 2/.test(normalized);
  if (platform === "PS5") return /\bps5\b|playstation 5/.test(normalized);
  if (platform === "Xbox") return /\bxsx\b|\bxbx\b|\bxbo\b|xbox/.test(normalized);
  return /\bwin\b|windows|\bpc\b|\bosx\b|macos|\blin\b|linux/.test(normalized);
}

function fetchGameCover(title: string) {
  if (coverCache.has(title)) return Promise.resolve(coverCache.get(title) ?? null);
  const pending = coverRequests.get(title);
  if (pending) return pending;

  const request = searchWikipedia(`"${title}"`, 1)
    .then((items) => items[0]?.thumbnail?.source ?? null)
    .catch(() => null)
    .then((url) => {
      coverCache.set(title, url);
      coverRequests.delete(title);
      return url;
    });
  coverRequests.set(title, request);
  return request;
}

function useGameCover(title: string) {
  const [cover, setCover] = useState<string | null>(() => coverCache.get(title) ?? null);

  useEffect(() => {
    let active = true;
    void fetchGameCover(title).then((url) => {
      if (active) setCover(url);
    });
    return () => { active = false; };
  }, [title]);

  return cover;
}

function GameArtwork({ game, compact = false }: { game: Game; compact?: boolean }) {
  const cover = useGameCover(game.originalTitle);
  return (
    <div className={`game-artwork ${compact ? "compact" : ""} ${cover ? "has-cover" : ""}`} style={artStyle(game)} aria-hidden="true">
      {cover && (
        // Dynamic public thumbnails come from different Wikimedia hosts, so a fixed Next image allowlist is not viable.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="game-cover" src={cover} alt="" loading={compact ? "lazy" : "eager"} referrerPolicy="no-referrer" />
      )}
      <div className="art-grid" />
      <div className="art-orbit" />
      <span className="art-country">{game.country}</span>
      <strong>{game.mark}</strong>
      <span className="art-index">{game.id.slice(0, 2).toUpperCase()} / {game.dateLabel.slice(0, 4)}</span>
    </div>
  );
}

function DiscoveredArtwork({ game }: { game: DiscoveredGame }) {
  return (
    <div className={`discovered-artwork ${game.image ? "has-cover" : ""}`} aria-hidden="true">
      {game.image ? (
        // Wikimedia thumbnails are supplied by multiple public hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={game.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <>
          <div className="discovered-orbit" />
          <strong>{game.title.slice(0, 2).toUpperCase()}</strong>
        </>
      )}
      <span>{game.platforms[0] || "GAME"}</span>
    </div>
  );
}

function ScoreBars({ scores, compact = false }: { scores: ScoreSet; compact?: boolean }) {
  return (
    <div className={`score-bars ${compact ? "compact" : ""}`}>
      {scoreKeys.map(({ key, label, short }) => (
        <div key={key}>
          <span>{compact ? short : label}</span>
          <i><b style={{ width: `${scores[key] * 10}%` }} /></i>
          <strong>{scores[key].toFixed(1)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("radar");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [region, setRegion] = useState<"all" | Game["region"]>("all");
  const [sort, setSort] = useState<SortKey>("recommend");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [shelf, setShelf] = useState<Record<string, ShelfStatus>>({});
  const [ratings, setRatings] = useState<Record<string, ScoreSet>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [uiScale, setUiScale] = useState<UiScale>(1);
  const [onlineResults, setOnlineResults] = useState<OnlineGame[]>([]);
  const [onlineState, setOnlineState] = useState<OnlineState>("idle");
  const [discoveredGames, setDiscoveredGames] = useState<DiscoveredGame[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [catalogPage, setCatalogPage] = useState(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          wishlist?: string[];
          shelf?: Record<string, ShelfStatus>;
          ratings?: Record<string, ScoreSet>;
          notes?: Record<string, string>;
        };
        queueMicrotask(() => {
          setWishlist(saved.wishlist ?? []);
          setShelf(saved.shelf ?? {});
          setRatings(saved.ratings ?? {});
          setNotes(saved.notes ?? {});
        });
      }
    } catch {
      // Invalid local data is ignored so the catalog always remains usable.
    }
    queueMicrotask(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wishlist, shelf, ratings, notes }));
  }, [hydrated, wishlist, shelf, ratings, notes]);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "dark") queueMicrotask(() => setTheme("dark"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const savedScale = Number(localStorage.getItem(SCALE_KEY));
    if (UI_SCALES.includes(savedScale as UiScale)) queueMicrotask(() => setUiScale(savedScale as UiScale));
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    document.body.style.zoom = String(uiScale);
    localStorage.setItem(SCALE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    try {
      const raw = localStorage.getItem(FEED_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { items?: DiscoveredGame[] };
        if (cached.items?.length) queueMicrotask(() => {
          if (!active) return;
          setDiscoveredGames(cached.items ?? []);
          setFeedState("ready");
        });
      }
    } catch {
      // A stale cache never blocks a fresh public-index refresh.
    }

    const timer = window.setTimeout(() => {
      void fetchAnnualReleaseFeed(controller.signal)
        .then((items) => {
          if (!active) return;
          setDiscoveredGames(items);
          setFeedState("ready");
          localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), items }));
        })
        .catch((error: unknown) => {
          if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
          setFeedState((current) => current === "ready" ? current : "error");
        });
    }, 80);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      const resetTimer = window.setTimeout(() => {
        setOnlineResults([]);
        setOnlineState("idle");
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setOnlineState("loading");
      void searchWikipedia(term, 8, controller.signal)
        .then((results) => {
          setOnlineResults(results);
          setOnlineState("done");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setOnlineResults([]);
          setOnlineState("error");
        });
    }, 420);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const verifiedFiltered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return games
      .filter((game) => status === "all" || game.status === status)
      .filter((game) => platform === "all" || game.platforms.includes(platform))
      .filter((game) => region === "all" || game.region === region)
      .filter((game) => {
        if (!normalized) return true;
        return [
          game.title,
          game.originalTitle,
          game.developer,
          game.publisher,
          game.country,
          ...game.genres,
        ].some((value) => value.toLowerCase().includes(normalized));
      })
      .sort((a, b) => {
        if (sort === "date-asc") return (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999");
        if (sort === "date-desc") return (b.releaseDate ?? "0000").localeCompare(a.releaseDate ?? "0000");
        if (sort === "score") return average(b.scores) - average(a.scores);
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return (b.releaseDate ?? "0000").localeCompare(a.releaseDate ?? "0000");
      });
  }, [platform, query, region, sort, status]);

  const discoveredFiltered = useMemo(() => {
    if (region !== "all" || status === "development") return [];
    const normalized = query.trim().toLowerCase();
    const curatedTitles = new Set(games.flatMap((game) => [game.title.toLowerCase(), game.originalTitle.toLowerCase()]));
    return discoveredGames
      .filter((game) => status === "all" || game.status === status)
      .filter((game) => platform === "all" || matchesPlatform(game.platformText, platform))
      .filter((game) => !curatedTitles.has(game.title.toLowerCase()))
      .filter((game) => {
        if (!normalized) return true;
        return [game.title, game.developer, game.publisher, game.platformText, ...game.genres]
          .some((value) => value.toLowerCase().includes(normalized));
      });
  }, [discoveredGames, platform, query, region, status]);

  const catalogItems = useMemo<CatalogItem[]>(() => {
    const combined: CatalogItem[] = [
      ...verifiedFiltered.map((game) => ({ kind: "verified" as const, game })),
      ...discoveredFiltered.map((game) => ({ kind: "discovered" as const, game })),
    ];
    if (sort === "date-asc") return combined.sort((a, b) => (a.game.releaseDate ?? "9999").localeCompare(b.game.releaseDate ?? "9999"));
    if (sort === "date-desc") return combined.sort((a, b) => (b.game.releaseDate ?? "0000").localeCompare(a.game.releaseDate ?? "0000"));
    return combined;
  }, [discoveredFiltered, sort, verifiedFiltered]);

  const catalogTotalPages = Math.max(1, Math.ceil(catalogItems.length / PAGE_SIZE));
  const safeCatalogPage = Math.min(catalogPage, catalogTotalPages);
  const pagedCatalogItems = catalogItems.slice((safeCatalogPage - 1) * PAGE_SIZE, safeCatalogPage * PAGE_SIZE);
  const firstCatalogResult = catalogItems.length ? (safeCatalogPage - 1) * PAGE_SIZE + 1 : 0;
  const lastCatalogResult = Math.min(safeCatalogPage * PAGE_SIZE, catalogItems.length);
  const discoveredCounts = {
    all: discoveredGames.length,
    released: discoveredGames.filter((game) => game.status === "released").length,
    upcoming: discoveredGames.filter((game) => game.status === "upcoming").length,
    development: 0,
  };

  const heroGame = games.find((game) => game.id === "onimusha-way-of-the-sword") ?? games[0];
  const personalIds = new Set([...wishlist, ...Object.keys(shelf)]);
  const personalGames = games.filter((game) => personalIds.has(game.id));

  function changePage(page: number) {
    setCatalogPage(Math.min(Math.max(1, page), catalogTotalPages));
    document.querySelector("#catalog-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetCatalogPage() {
    setCatalogPage(1);
  }

  function announce(message: string) {
    setToast(message);
  }

  function toggleWishlist(id: string) {
    setWishlist((current) => {
      const exists = current.includes(id);
      announce(exists ? "已移出愿望单" : "已加入愿望单");
      return exists ? current.filter((item) => item !== id) : [...current, id];
    });
  }

  function openView(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scoreFor(game: Game) {
    return ratings[game.id] ?? game.scores;
  }

  function updateRating(game: Game, key: keyof ScoreSet, value: number) {
    setRatings((current) => ({
      ...current,
      [game.id]: { ...(current[game.id] ?? game.scores), [key]: value },
    }));
  }

  function renderOnlineSearch() {
    const term = query.trim();
    return (
      <section className="online-discovery" aria-live="polite">
        <header>
          <div>
            <p className="eyebrow">LIVE PUBLIC INDEX</p>
            <h3>动态检索更多游戏</h3>
          </div>
          <span>WIKIPEDIA / WIKIMEDIA · 实时查询</span>
        </header>
        {term.length < 2 ? (
          <div className="online-prompt"><b>⌕</b><p>输入至少 2 个字符，可在已核验目录之外继续检索游戏、系列与开发团队。</p></div>
        ) : onlineState === "loading" ? (
          <div className="online-loading"><i /><i /><i /><span>正在检索公共游戏索引…</span></div>
        ) : onlineState === "error" ? (
          <div className="online-prompt error"><b>!</b><p>公共索引暂时不可用。已核验目录仍可正常浏览，请稍后重试。</p></div>
        ) : onlineResults.length ? (
          <div className="online-grid">
            {onlineResults.map((item) => (
              <a className="online-card" href={item.fullurl} target="_blank" rel="noreferrer" key={item.pageid}>
                <div className="online-icon">
                  {item.thumbnail ? (
                    // Wikimedia thumbnail hosts vary by result.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnail.source} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : <span>{item.title.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div><span>公共索引 · 待官方核验</span><h4>{item.title}</h4><p>{item.extract || "打开公共资料页查看作品信息。"}</p></div>
                <b>↗</b>
              </a>
            ))}
          </div>
        ) : (
          <div className="online-prompt"><b>0</b><p>没有找到“{term}”的公共索引结果，可以尝试英文名、日文名或系列名。</p></div>
        )}
        <footer>动态结果用于发现，不自动进入真实性台账；日期、平台和厂商信息仍需通过官方来源核验后收录。</footer>
      </section>
    );
  }

  function renderCatalogItem(item: CatalogItem) {
    if (item.kind === "verified") {
      const game = item.game;
      return (
        <article className="catalog-card" key={`verified-${game.id}`}>
          <button className="card-art-button" type="button" onClick={() => setSelected(game)} aria-label={`打开${game.title}档案`}>
            <GameArtwork game={game} compact />
            <span className={`card-status status-${game.status}`}>{statusLabels[game.status]}</span>
            <span className="card-countdown">{countdownLabel(game)}</span>
          </button>
          <div className="catalog-card-copy">
            <div className="catalog-meta"><span>{game.country}</span><span>{game.signal}</span><span>{game.dateLabel}</span></div>
            <h3><button type="button" onClick={() => setSelected(game)}>{game.title}</button></h3>
            <p className="original-title">{game.originalTitle}</p>
            <p className="card-summary">{game.summary}</p>
            <div className="tag-row">{game.genres.slice(0, 3).map((genre) => <span key={genre}>{genre}</span>)}</div>
            <ScoreBars scores={scoreFor(game)} compact />
            <footer>
              <div className="platform-list">{game.platforms.map((entry) => <span key={entry}>{platformLabels[entry]}</span>)}</div>
              <button className={wishlist.includes(game.id) ? "wish-button active" : "wish-button"} type="button" onClick={() => toggleWishlist(game.id)} aria-label={wishlist.includes(game.id) ? `移除${game.title}愿望单` : `将${game.title}加入愿望单`}>{wishlist.includes(game.id) ? "♥" : "♡"}</button>
            </footer>
          </div>
        </article>
      );
    }

    const game = item.game;
    return (
      <article className="catalog-card discovered-card" key={`discovered-${game.id}`}>
        <a className="card-art-button" href={game.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开${game.title}公共资料`}>
          <DiscoveredArtwork game={game} />
          <span className={`card-status status-${game.status}`}>{statusLabels[game.status]}</span>
          <span className="card-countdown">{game.releaseDate ? (game.status === "released" ? "OUT NOW" : countdownLabel({ status: game.status, releaseDate: game.releaseDate })) : "TBA"}</span>
        </a>
        <div className="catalog-card-copy">
          <div className="catalog-meta"><span>自动发现</span><span>待官方核验</span><span>{game.dateLabel}</span></div>
          <h3><a href={game.sourceUrl} target="_blank" rel="noreferrer">{game.title} ↗</a></h3>
          <p className="original-title">{game.developer} · {game.publisher}</p>
          <p className="card-summary">{game.summary || "已从年度游戏发布索引发现这部作品；平台、日期和厂商信息将在进入真实性台账前继续核验。"}</p>
          <div className="tag-row">{(game.genres.length ? game.genres : ["类型待核验"]).slice(0, 3).map((genre) => <span key={genre}>{genre}</span>)}</div>
          <footer>
            <div className="platform-list">{(game.platforms.length ? game.platforms : ["TBA"]).slice(0, 4).map((entry) => <span key={entry}>{entry}</span>)}</div>
            <a className="source-link" href={game.sourceUrl} target="_blank" rel="noreferrer">资料 ↗</a>
          </footer>
        </div>
      </article>
    );
  }

  function renderPagination() {
    if (catalogTotalPages <= 1) return null;
    const pages = Array.from({ length: catalogTotalPages }, (_, index) => index + 1)
      .filter((page) => page === 1 || page === catalogTotalPages || Math.abs(page - safeCatalogPage) <= 2);
    return (
      <nav className="pagination" aria-label="游戏目录分页">
        <button type="button" disabled={safeCatalogPage === 1} onClick={() => changePage(safeCatalogPage - 1)}>← 上一页</button>
        <div>
          {pages.map((page, index) => (
            <span key={page}>
              {index > 0 && page - pages[index - 1] > 1 && <i>…</i>}
              <button type="button" className={page === safeCatalogPage ? "active" : ""} aria-current={page === safeCatalogPage ? "page" : undefined} onClick={() => changePage(page)}>{page}</button>
            </span>
          ))}
        </div>
        <button type="button" disabled={safeCatalogPage === catalogTotalPages} onClick={() => changePage(safeCatalogPage + 1)}>下一页 →</button>
      </nav>
    );
  }

  function renderRadar() {
    return (
      <>
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow"><span /> 个人游戏情报台 · {SNAPSHOT_DATE.replaceAll("-", ".")}</p>
            <h1>下一段值得<br />投入的<span>世界。</span></h1>
            <p className="hero-lede">从官方发布、开发者访谈到仍未定档的计划；每次打开自动刷新本年度与下一年度发布索引，核验档案与新发现分层展示。</p>
            <div className="hero-actions">
              <button className="primary-action" onClick={() => document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth" })}>浏览 {games.length + discoveredGames.length} 部游戏 <span>↓</span></button>
              <button className="text-action" onClick={() => openView("sources")}>真实性规则 ↗</button>
            </div>
          </div>
          <div className="signal-orbit" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-core"><b>{games.length + discoveredGames.length}</b><span>{feedState === "loading" ? "正在自动更新" : "核验 + 新发现"}</span></div>
            <i className="signal-dot dot-one" />
            <i className="signal-dot dot-two" />
            <i className="signal-dot dot-three" />
          </div>
        </section>

        <section className="signal-ticker" aria-label="最新情报">
          <span className="live-dot">LIVE</span>
          <div>
            <strong>{signals[0].title}</strong>
            <p>{signals[0].detail}</p>
          </div>
          <a href={signals[0].sourceUrl} target="_blank" rel="noreferrer">官方出处 ↗</a>
        </section>

        <section className="spotlight-section">
          <div className="section-title-row">
            <div><p className="eyebrow">NEXT ON YOUR RADAR</p><h2>本周焦点</h2></div>
            <span className="snapshot-note">所有日期核验于 {SNAPSHOT_DATE}</span>
          </div>
          <article className="spotlight-card">
            <button className="spotlight-art-button" type="button" onClick={() => setSelected(heroGame)} aria-label={`查看${heroGame.title}`}>
              <GameArtwork game={heroGame} />
              <span className="countdown-badge">{countdownLabel(heroGame)}</span>
            </button>
            <div className="spotlight-copy">
              <div className="card-kicker">
                <span className={`status status-${heroGame.status}`}>{statusLabels[heroGame.status]}</span>
                <span>{heroGame.country} · {heroGame.developer}</span>
              </div>
              <h3>{heroGame.title}</h3>
              <p className="original-title">{heroGame.originalTitle}</p>
              <p className="game-summary">{heroGame.summary}</p>
              <div className="fit-note"><span>WHY THIS</span><p>{heroGame.fit}</p></div>
              <ScoreBars scores={scoreFor(heroGame)} />
              <footer>
                <div><span>发售日</span><strong>{heroGame.dateLabel}</strong></div>
                <div className="platform-list">{heroGame.platforms.map((item) => <span key={item}>{platformLabels[item]}</span>)}</div>
                <button type="button" onClick={() => setSelected(heroGame)}>打开完整档案 <b>↗</b></button>
              </footer>
            </div>
          </article>
        </section>

        <section className="catalog-section" id="catalog">
          <div className="section-title-row catalog-heading">
            <div><p className="eyebrow">ADAPTIVE RELEASE CATALOG</p><h2>发售雷达</h2></div>
            <p>已核验档案与自动发现分层显示；网格随窗口和缩放自适应，没有日期时不做猜测。</p>
          </div>
          <div className="filter-panel">
            <div className="status-tabs" aria-label="状态筛选">
              {([
                ["all", "全部"],
                ["released", "已发售"],
                ["upcoming", "待发售"],
                ["development", "开发中"],
              ] as Array<[StatusFilter, string]>).map(([value, label]) => (
                <button className={status === value ? "active" : ""} type="button" key={value} onClick={() => { setStatus(value); resetCatalogPage(); }}>{label}<small>{(value === "all" ? games.length : games.filter((game) => game.status === value).length) + discoveredCounts[value]}</small></button>
              ))}
            </div>
            <div className="filter-controls">
              <label><span>平台</span><select value={platform} onChange={(event) => { setPlatform(event.target.value as "all" | Platform); resetCatalogPage(); }}><option value="all">全部平台</option>{Object.entries(platformLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>地区</span><select value={region} onChange={(event) => { setRegion(event.target.value as typeof region); resetCatalogPage(); }}><option value="all">全部地区</option><option value="日本">日本</option><option value="欧美">欧美</option><option value="其他">其他</option></select></label>
              <label><span>排序</span><select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); resetCatalogPage(); }}><option value="recommend">编辑推荐</option><option value="date-asc">日期由近到远</option><option value="date-desc">日期由远到近</option><option value="score">四维均分</option></select></label>
              <label className="catalog-search"><span className="visually-hidden">搜索档案</span><input value={query} onChange={(event) => { setQuery(event.target.value); resetCatalogPage(); }} placeholder="搜索游戏 / 公司 / 类型" /><b>⌕</b></label>
            </div>
          </div>

          <div className="result-row" id="catalog-results"><span>显示 <b>{firstCatalogResult}–{lastCatalogResult}</b> / {catalogItems.length} · 官方核验 {verifiedFiltered.length} · 自动发现 {discoveredFiltered.length} {feedState === "loading" && "· 正在刷新…"}{feedState === "error" && "· 自动索引暂不可用"}</span>{(query || status !== "all" || platform !== "all" || region !== "all") && <button type="button" onClick={() => { setQuery(""); setStatus("all"); setPlatform("all"); setRegion("all"); resetCatalogPage(); }}>清除筛选 ×</button>}</div>
          {catalogItems.length ? (
            <>
              <div className="game-grid">{pagedCatalogItems.map(renderCatalogItem)}</div>
              {renderPagination()}
            </>
          ) : <div className="empty-state"><span>NO VERIFIED SIGNAL</span><h3>已核验目录没有匹配项</h3><p>继续查看下方动态结果，或尝试英文名与系列名。</p></div>}
          {renderOnlineSearch()}
        </section>

        <section className="intel-section">
          <div className="section-title-row">
            <div><p className="eyebrow">SOURCE INTELLIGENCE</p><h2>情报变更记录</h2></div>
            <button className="text-action" onClick={() => openView("sources")}>查看全部来源 ↗</button>
          </div>
          <div className="intel-grid">
            {signals.slice(0, 4).map((signal, index) => (
              <article key={signal.id}>
                <span className="intel-index">0{index + 1}</span>
                <div><p>{signal.date.replaceAll("-", ".")} · {signal.kind}</p><h3>{signal.title}</h3><span>{signal.detail}</span></div>
                <a href={signal.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开${signal.sourceLabel}`}>↗</a>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderCalendar() {
    const dated = games.filter((game) => game.releaseDate).sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!));
    const groups = dated.reduce<Record<string, Game[]>>((acc, game) => {
      const month = game.releaseDate!.slice(0, 7);
      (acc[month] ??= []).push(game);
      return acc;
    }, {});
    return (
      <section className="subpage">
        <header className="subpage-hero"><p className="eyebrow">RELEASE CALENDAR</p><h1>发售日历</h1><p>用一条连续时间线看清已经发生、即将到来，以及仍没有日期的计划。</p></header>
        <div className="calendar-layout">
          <aside><strong>{dated.length}</strong><span>个已确认日期</span><strong>{games.filter((game) => !game.releaseDate).length}</strong><span>个未定档项目</span><small>快照 {SNAPSHOT_DATE}</small></aside>
          <div className="month-list">
            {Object.entries(groups).map(([month, monthGames]) => (
              <section key={month} className="month-group">
                <header><span>{month.slice(0, 4)}</span><strong>{month.slice(5)}</strong><i /></header>
                <div>{monthGames.map((game) => <button type="button" key={game.id} onClick={() => setSelected(game)}><time>{game.releaseDate!.slice(8)}</time><span><b>{game.title}</b><small>{game.originalTitle}</small></span><em className={`status-${game.status}`}>{statusLabels[game.status]}</em><strong>{game.platforms.map((item) => platformLabels[item]).join(" · ")}</strong><i>↗</i></button>)}</div>
              </section>
            ))}
            <section className="month-group undated"><header><span>TBA</span><strong>∞</strong><i /></header><div>{games.filter((game) => !game.releaseDate).map((game) => <button type="button" key={game.id} onClick={() => setSelected(game)}><time>—</time><span><b>{game.title}</b><small>{game.originalTitle}</small></span><em className="status-development">开发中</em><strong>{game.platforms.map((item) => platformLabels[item]).join(" · ")}</strong><i>↗</i></button>)}</div></section>
          </div>
        </div>
      </section>
    );
  }

  function renderMine() {
    const byShelf = (value: ShelfStatus) => personalGames.filter((game) => shelf[game.id] === value);
    return (
      <section className="subpage mine-page">
        <header className="subpage-hero"><p className="eyebrow">PERSONAL SHELF</p><h1>我的游戏架</h1><p>愿望、游玩状态、四维评分与私人笔记只保存在当前浏览器。</p></header>
        <div className="personal-stats">
          <div><strong>{wishlist.length}</strong><span>愿望单</span></div>
          <div><strong>{byShelf("playing").length}</strong><span>正在玩</span></div>
          <div><strong>{byShelf("finished").length}</strong><span>已通关</span></div>
          <div><strong>{Object.keys(ratings).length}</strong><span>自定义评分</span></div>
        </div>
        {personalGames.length ? (
          <div className="personal-list">
            {personalGames.map((game) => <article key={game.id}><GameArtwork game={game} compact /><div><span>{shelf[game.id] ? shelfLabels[shelf[game.id]] : "愿望单"}</span><h2>{game.title}</h2><p>{notes[game.id] || game.fit}</p><ScoreBars scores={scoreFor(game)} compact /></div><button type="button" onClick={() => setSelected(game)}>管理档案 ↗</button></article>)}
          </div>
        ) : <div className="empty-state mine-empty"><span>EMPTY SHELF</span><h3>你的游戏架还是空的</h3><p>回到雷达，把感兴趣的游戏加入愿望单，或在档案里设置游玩状态。</p><button className="primary-action" onClick={() => openView("radar")}>去发现游戏 →</button></div>}
      </section>
    );
  }

  function renderSources() {
    return (
      <section className="subpage sources-page">
        <header className="subpage-hero"><p className="eyebrow">TRUTH & SOURCES</p><h1>真实性台账</h1><p>“知道什么”和“不知道什么”同样重要。这里解释本站如何处理日期、平台、访谈与传闻。</p></header>
        <div className="truth-principles">
          <article><span>01</span><h2>官宣优先</h2><p>发售日与平台优先引用开发商、发行商或平台方。转载只用于定位原始出处，不反向替代官方。</p></article>
          <article><span>02</span><h2>新信息覆盖旧信息</h2><p>同一游戏发生延期或提前时，使用发布时间更晚的官方信息，同时保留变更记录。</p></article>
          <article><span>03</span><h2>发现与事实分层</h2><p>动态检索来自 Wikipedia / Wikimedia，只用于发现并明确标记“待核验”；没有官方日期就显示 TBA，不把公共索引写进真实性台账。</p></article>
          <article><span>04</span><h2>评分属于你</h2><p>四维数字是可编辑的个人参考，不冒充媒体均分或客观结论；待发售作品明确标为期待值。</p></article>
        </div>
        <div className="source-ledger">
          <header><div><p className="eyebrow">PRIMARY SOURCE LEDGER</p><h2>{games.length} 条游戏来源</h2></div><span>最近核验 {SNAPSHOT_DATE}</span></header>
          <div className="ledger-table">
            <div className="ledger-head"><span>作品</span><span>证据</span><span>状态</span><span>核验日</span><span>出处</span></div>
            {games.map((game) => <div className="ledger-row" key={game.id}><span><b>{game.title}</b><small>{game.developer}</small></span><span>{game.source.evidence}</span><span><em className={`status-${game.status}`}>{statusLabels[game.status]}</em></span><span>{game.source.checkedAt}</span><span><a href={game.source.url} target="_blank" rel="noreferrer">{game.source.label} ↗</a></span></div>)}
          </div>
        </div>
        <div className="update-guide"><div><p className="eyebrow">MAINTENANCE</p><h2>后续更新怎么做</h2></div><p>在线检索无需等待本站更新；通过官方来源核验后，作品再进入结构化目录，补充状态、平台、四维初始值与证据。日期验证测试会阻止缺少出处或把未定档写成确定日期的记录进入发布版本。</p></div>
      </section>
    );
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => openView("radar")} aria-label="发售信号首页"><span className="brand-mark">RS</span><span>RELEASE SIGNAL</span></button>
        <nav aria-label="主要导航">
          {([['radar', '雷达'], ['calendar', '日历'], ['mine', '我的'], ['sources', '来源']] as Array<[View, string]>).map(([value, label]) => <button className={view === value ? "active" : ""} type="button" key={value} onClick={() => openView(value)}>{label}</button>)}
        </nav>
        <div className="topbar-actions">
          <label className="top-search"><span className="visually-hidden">搜索游戏</span><input value={query} onChange={(event) => { setQuery(event.target.value); resetCatalogPage(); if (view !== "radar") setView("radar"); }} placeholder="动态搜索游戏" /><b>⌕</b></label>
          <div className="zoom-control" role="group" aria-label="界面缩放">
            <button type="button" disabled={uiScale === UI_SCALES[0]} onClick={() => setUiScale(UI_SCALES[Math.max(0, UI_SCALES.indexOf(uiScale) - 1)])} aria-label="缩小界面">A−</button>
            <button className="zoom-value" type="button" onClick={() => setUiScale(1)} aria-label="恢复百分之百缩放" title="恢复 100%">{Math.round(uiScale * 100)}%</button>
            <button type="button" disabled={uiScale === UI_SCALES.at(-1)} onClick={() => setUiScale(UI_SCALES[Math.min(UI_SCALES.length - 1, UI_SCALES.indexOf(uiScale) + 1)])} aria-label="放大界面">A+</button>
          </div>
          <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "切换为深色主题" : "切换为浅色主题"} title={theme === "light" ? "切换为深色主题" : "切换为浅色主题"}><span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span></button>
          <button className="shelf-shortcut" type="button" onClick={() => openView("mine")}><span>♡</span><b>{wishlist.length}</b></button>
        </div>
      </header>

      {view === "radar" && renderRadar()}
      {view === "calendar" && renderCalendar()}
      {view === "mine" && renderMine()}
      {view === "sources" && renderSources()}

      <footer className="site-footer"><div><span className="brand-mark">RS</span><p><b>发售信号</b><small>个人游戏发布与游玩档案</small></p></div><p>内容快照 {SNAPSHOT_DATE} · 游戏资料与名称归各权利人所有<br />只记录可追溯信号，不把期待写成事实。</p><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>回到顶部 ↑</button></footer>

      <nav className="mobile-nav" aria-label="移动端导航">{([['radar', '⌁', '雷达'], ['calendar', '▦', '日历'], ['mine', '♡', '我的'], ['sources', '✓', '来源']] as Array<[View, string, string]>).map(([value, icon, label]) => <button className={view === value ? "active" : ""} type="button" key={value} onClick={() => openView(value)}><span>{icon}</span>{label}</button>)}</nav>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label="关闭档案">×</button>
            <div className="modal-art"><GameArtwork game={selected} /><span className={`status status-${selected.status}`}>{statusLabels[selected.status]}</span></div>
            <div className="modal-content">
              <header><p>{selected.country} · {selected.developer}</p><h2 id="modal-title">{selected.title}</h2><span>{selected.originalTitle}</span></header>
              <div className="modal-platforms"><strong>{selected.dateLabel}</strong>{selected.platforms.map((item) => <span key={item}>{platformLabels[item]}</span>)}<em>{selected.signal}</em></div>
              <p className="modal-summary">{selected.summary}</p>
              <div className="modal-notes"><div><span>适合你，如果</span><p>{selected.fit}</p></div><div><span>先知道</span><p>{selected.caution}</p></div></div>
              <section className="rating-editor">
                <header><div><span>PERSONAL MATRIX</span><h3>我的四维评价</h3></div><em>{ratings[selected.id] ? "我的评分" : selected.scoreMode}</em></header>
                {scoreKeys.map(({ key, label }) => <label key={key}><span>{label}</span><input type="range" min="1" max="10" step="0.1" value={scoreFor(selected)[key]} onChange={(event) => updateRating(selected, key, Number(event.target.value))} style={{ "--range": `${scoreFor(selected)[key] * 10}%` } as CSSProperties} /><strong>{scoreFor(selected)[key].toFixed(1)}</strong></label>)}
                <div className="rating-average"><span>四维均值</span><strong>{average(scoreFor(selected)).toFixed(1)}</strong><button type="button" onClick={() => setRatings((current) => { const next = { ...current }; delete next[selected.id]; return next; })}>恢复初始参考</button></div>
              </section>
              <label className="note-editor"><span>私人笔记</span><textarea rows={3} maxLength={500} value={notes[selected.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="为什么想玩？玩到哪里？对剧情与音乐有什么感觉……" /><small>{(notes[selected.id] ?? "").length}/500 · 自动保存在本机</small></label>
              <section className="source-proof"><div><span>PRIMARY SOURCE</span><strong>{selected.source.label}</strong><p>{selected.source.evidence}</p><small>核验于 {selected.source.checkedAt}</small></div><a href={selected.source.url} target="_blank" rel="noreferrer">打开官方出处 ↗</a></section>
              <footer className="modal-actions"><button className={wishlist.includes(selected.id) ? "secondary-action active" : "secondary-action"} type="button" onClick={() => toggleWishlist(selected.id)}>{wishlist.includes(selected.id) ? "♥ 已在愿望单" : "♡ 加入愿望单"}</button><label><span className="visually-hidden">游玩状态</span><select value={shelf[selected.id] ?? ""} onChange={(event) => { const value = event.target.value as ShelfStatus | ""; setShelf((current) => { const next = { ...current }; if (value) next[selected.id] = value; else delete next[selected.id]; return next; }); announce(value ? `已标记：${shelfLabels[value]}` : "已清除游玩状态"); }}><option value="">设置游玩状态</option>{Object.entries(shelfLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="primary-action" type="button" onClick={() => { announce("评分与笔记已保存在本机"); setSelected(null); }}>保存档案 ✓</button></footer>
            </div>
          </section>
        </div>
      )}

      <div className={toast ? "toast visible" : "toast"} role="status"><span>✓</span>{toast}</div>
    </main>
  );
}
