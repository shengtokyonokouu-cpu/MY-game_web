"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsFeed } from "./news";
import { validateNewsFeed } from "./news-cache";
import { publicData } from "./public-data";

export function useNewsFeed() {
  const [feed, setFeed] = useState<NewsFeed | null>(null); const [state, setState] = useState("loading");
  const pending = useRef<AbortController | null>(null); const checkedAt = useRef(0);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setState("loading");
    try {
      const next = validateNewsFeed(await publicData("news.json",controller.signal)); if (controller.signal.aborted) return;
      next.stale = Date.now()-Date.parse(next.fetchedAt)>8*3600000;
      setFeed(next); setState("ready"); checkedAt.current = Date.now();
      try { localStorage.setItem("release-signal-news-cache", JSON.stringify(next)); } catch { /* Public reading cache only. */ }
    } catch { if (!controller.signal.aborted) setState("error"); }
    finally { if (pending.current === controller) pending.current = null; }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { try { const raw = localStorage.getItem("release-signal-news-cache"); if (raw && raw.length < 1_000_000) setFeed({ ...validateNewsFeed(JSON.parse(raw)), stale: true }); } catch { /* Ignore damaged public cache. */ } void refresh(); }, 0);
    const check = () => { if (document.visibilityState === "visible" && Date.now() - checkedAt.current >= 300000) void refresh(); };
    const interval = setInterval(check, 300000); window.addEventListener("focus", check); window.addEventListener("online", check);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener("focus", check); window.removeEventListener("online", check); pending.current?.abort(); pending.current = null; };
  }, [refresh]);
  return { feed, state, refresh };
}
