"use client";
/* OAuth must use a full document navigation, never framework prefetch. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Account } from "../lib/auth";
import type { IPAccountState } from "../lib/ip-account-api";
import { useNewsFeed } from "../lib/use-news-feed";
import { Dialog } from "./ui";
import { useIPRegistry } from "../lib/use-ip-registry";

type Session = { user: Account | null; csrf: string | null };
const empty: IPAccountState = { following: [], notifications: [], unread: 0 };
function useIPStore(session: Session) {
  const [data, setData] = useState<IPAccountState>(empty); const [loading, setLoading] = useState(!!session.user);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [loginPrompt, setLoginPrompt] = useState(false);
  const active = useRef(true); const pending = useRef(false); const epoch = useRef(0); const checkedAt = useRef(0);
  const request = useCallback(async (path: string, method = "GET", body?: unknown) => {
    if (!session.user || pending.current) return;
    pending.current = true; const run = ++epoch.current; setBusy(true);
    try {
      const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf || "" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(22000) });
      const next = await response.json(); if (!response.ok) throw new Error(next.error || "IP 云同步暂时不可用。");
      if (!Array.isArray(next.following) || !Array.isArray(next.notifications) || typeof next.unread !== "number") throw new Error("云端返回的数据不完整。");
      if (active.current && run === epoch.current) { setData(next); setError(next.partial ? "部分新闻源暂不可用，本次提醒可能不完整。" : ""); }
    } catch (error) { if (active.current && run === epoch.current) setError(error instanceof Error ? error.message : "无法连接云端，关注状态未更改，请重试。"); }
    finally { pending.current = false; if (active.current && run === epoch.current) { setBusy(false); setLoading(false); } }
  }, [session.user, session.csrf]);
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(async () => { if (!session.user) return; await request("/api/subscriptions"); if (active.current) { checkedAt.current = Date.now(); await request("/api/notifications", "POST"); } }, 0);
    const check = () => { if (document.visibilityState === "visible" && Date.now() - checkedAt.current >= 60000) { checkedAt.current = Date.now(); void request("/api/notifications", "POST"); } };
    const interval = setInterval(check, 300000); window.addEventListener("focus", check); window.addEventListener("online", check);
    // This ref is a request epoch, not a DOM node. Invalidate all pending replies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { active.current = false; epoch.current++; clearTimeout(timer); clearInterval(interval); window.removeEventListener("focus", check); window.removeEventListener("online", check); };
  }, [request, session.user]);
  const follow = (ipId: string) => { if (!session.user) { setLoginPrompt(true); return; } void request("/api/subscriptions", "PUT", { ipId, following: !data.following.includes(ipId) }); };
  return { ...data, loading, busy, error, user: session.user, follow, retry: () => request("/api/subscriptions"), refreshNotifications: () => request("/api/notifications", "POST"), markRead: (ids?: string[]) => request("/api/notifications", "PATCH", ids ? { ids } : { all: true }), loginPrompt, setLoginPrompt };
}
type IPContextValue = ReturnType<typeof useIPStore> & ReturnType<typeof useIPRegistry> & { news: ReturnType<typeof useNewsFeed> };
const IPContext = createContext<IPContextValue | null>(null);
export function useIP() { const value = useContext(IPContext); if (!value) throw new Error("IP provider missing"); return value; }
// Mounted with the account ID as key: old requests/state cannot leak between accounts.
export function IPProvider({ session, children }: { session: Session; children: ReactNode }) {
  const store = useIPStore(session); const news = useNewsFeed(); const registry = useIPRegistry();
  return <IPContext.Provider value={{ ...store, ...registry, news }}>{children}{store.loginPrompt && <Dialog title="登录后关注系列" onClose={() => store.setLoginPrompt(false)}><div className="ip-login"><p className="eyebrow">YOUR PERSONAL FEED</p><h1>让喜欢的系列来找你</h1><p>使用 GitHub 登录，即可跨设备同步关注，并在站内接收重大动态提醒。不会申请仓库权限。</p><a className="button primary" href="/api/auth/login">使用 GitHub 登录</a><button className="button" onClick={() => store.setLoginPrompt(false)}>继续浏览</button></div></Dialog>}</IPContext.Provider>;
}
