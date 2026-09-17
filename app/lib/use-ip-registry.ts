"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { franchises as bootstrap, franchiseIndex, type Franchise } from "./franchises";
import type { NewsArticle } from "./news";
export type EngineStatus = { channels: number; articles: number; bodies: number; candidates: number; verified: number; pendingJobs: number; failedJobs: number; healthy: boolean; heartbeat: number | null };
export function useIPRegistry() {
  const [items, setItems] = useState<Franchise[]>(bootstrap); const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort(); const run = new AbortController(); controller.current = run;
    try {
      const next: Franchise[] = []; let cursor: number | null = 0; let health: EngineStatus | null = null;
      while (cursor !== null) {
        const response = await fetch("/api/ips?cursor=" + cursor, { signal: AbortSignal.any([run.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error("Registry unavailable");
        const page = await response.json() as { items: Franchise[]; nextCursor: number | null; engine?: EngineStatus };
        if (!Array.isArray(page.items) || page.items.some((ip) => !ip.id || !Array.isArray(ip.aliases))) throw new Error("Registry invalid");
        if (page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= cursor)) throw new Error("Invalid cursor");
        next.push(...page.items); health = health || page.engine || null; cursor = page.nextCursor;
      }
      if (!run.signal.aborted) { setItems([...new Map(next.map((ip) => [ip.id, ip])).values()]); setEngine(health); setState("ready"); }
    } catch { if (!run.signal.aborted) setState("error"); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300000);
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
      const response = await fetch("/api/ip-news?ip=" + encodeURIComponent(id) + "&cursor=" + offset, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error("Archive unavailable");
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Archive invalid");
      if (!controller.signal.aborted) { setItems((previous) => [...new Map([...(offset ? previous : []), ...data.items].map((item: NewsArticle) => [item.id, item])).values()]); setCursor(data.nextCursor); setTotal(data.total); setState("ready"); }
    } catch { if (!controller.signal.aborted) setState("error"); }
  }, [id]);
  useEffect(() => { const timer = setTimeout(() => void load(0), 0); return () => { clearTimeout(timer); run.current?.abort(); }; }, [load]);
  return { items, total, state, more: cursor !== null, loadMore: () => load(cursor || 0), refresh: () => load(0) };
}
