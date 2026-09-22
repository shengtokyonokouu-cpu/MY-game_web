"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { franchises as bootstrap, franchiseIndex, type Franchise } from "./franchises";
import type { NewsArticle } from "./news";
import { publicData } from "./public-data";
import type { SeriesIndex } from "./series-types";
export type EngineStatus = { channels: number; articles: number; bodies: number; candidates: number; verified: number; pendingJobs: number; failedJobs: number; healthy: boolean; heartbeat: number | null; works?: number; characters?: number; updatedAt?: string; entityService?: { ok: boolean; retryAt: number } | null };
export function useIPRegistry() {
  const [items, setItems] = useState<Franchise[]>(bootstrap); const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort(); const run = new AbortController(); controller.current = run;
    try {
      const snapshot = await publicData<SeriesIndex>("index.json", run.signal);
      if(snapshot.version!==1||!Array.isArray(snapshot.items)||snapshot.items.length>20000||snapshot.items.some(ip=>!ip.id||!Array.isArray(ip.aliases)))throw new Error("Invalid directory");
      const next = snapshot.items;
      // Keep an explicitly followed single-game topic without presenting it as
      // an automatically qualified multi-game franchise.
      for(const ip of bootstrap)if(!next.some(v=>v.id===ip.id))next.push({...ip,coverage:"专题频道 · 未达到双作品门槛"});
      if (!run.signal.aborted) { setItems(next); setEngine({channels:snapshot.stats.channels,works:snapshot.stats.works,characters:snapshot.stats.characters,updatedAt:snapshot.updatedAt,articles:0,bodies:0,candidates:0,verified:0,pendingJobs:0,failedJobs:0,healthy:Date.now()-Date.parse(snapshot.updatedAt)<10*86400000,heartbeat:Date.parse(snapshot.updatedAt)}); setState("ready"); }
    } catch { if (!run.signal.aborted) setState("error"); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 1800000);
    return () => { clearTimeout(timer); clearInterval(interval); controller.current?.abort(); };
  }, [refresh]);
  const index = useMemo(() => franchiseIndex(items), [items]);
  return { ...index, registryState: state, engine, refreshRegistry: refresh };
}
export function useIPArchive(id: string) {
  const [items, setItems] = useState<NewsArticle[]>([]); const [cursor, setCursor] = useState<number | null>(0); const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"); const run = useRef<AbortController | null>(null);
  const load = useCallback(async (offset: number) => {
    run.current?.abort(); const controller = new AbortController(); run.current = controller; setState("loading");
    try {
      const feed = await publicData<{items:NewsArticle[]}>("news.json",controller.signal);
      const all = feed.items.filter(a=>a.ipIds?.includes(id)); const data={items:all.slice(offset,offset+100),total:all.length,nextCursor:offset+100<all.length?offset+100:null};
      if (!Array.isArray(data.items)) throw new Error("Archive invalid");
      if (!controller.signal.aborted) { setItems((previous) => [...new Map([...(offset ? previous : []), ...data.items].map((item: NewsArticle) => [item.id, item])).values()]); setCursor(data.nextCursor); setTotal(data.total); setState("ready"); }
    } catch { if (!controller.signal.aborted) setState("error"); }
  }, [id]);
  useEffect(() => { const timer = setTimeout(() => void load(0), 0); return () => { clearTimeout(timer); run.current?.abort(); }; }, [load]);
  return { items, total, state, more: cursor !== null, loadMore: () => load(cursor || 0), refresh: () => load(0) };
}
