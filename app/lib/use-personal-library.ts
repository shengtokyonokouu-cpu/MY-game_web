"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { LIBRARY_KEY, migrateLibrary, validateLibrary, type Library } from "./catalog";
import { changedIds, mergeThreeWay, type Conflict } from "./sync";
import type { Account } from "./auth";

type CloudSnapshot = { entries: Library; version: number };
type Session = { available: boolean; user: Account | null; csrf: string | null };
export type SyncState = "loading" | "guest" | "syncing" | "synced" | "pending" | "error" | "conflict";
const cacheKey = (id: string) => `release-signal-account-cache:${id}`;
function guestLibrary() { return migrateLibrary(localStorage.getItem(LIBRARY_KEY), localStorage.getItem("release-signal-personal-v1")); }
async function snapshot(response: Response): Promise<CloudSnapshot> { const data = await response.json(); if (!response.ok) throw new Error(data.error || "云端暂时无法连接"); if (!Number.isSafeInteger(data.version) || data.version < 0) throw new Error("云端版本不正确"); return { version: data.version, entries: validateLibrary({ version: 2, entries: data.entries }) }; }

export function usePersonalLibrary() {
  const [library, setVisibleLibrary] = useState<Library>({}); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState("");
  const [session, setSession] = useState<Session>({ available: false, user: null, csrf: null }); const sessionRef = useRef(session);
  const [syncState, setSyncState] = useState<SyncState>("loading"); const [syncError, setSyncError] = useState(""); const [lastSynced, setLastSynced] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]); const conflictsRef = useRef<Conflict[]>([]);
  const dataRef = useRef<Library>({}); const baseRef = useRef<CloudSnapshot>({ entries: {}, version: 0 }); const busy = useRef(false); const generation = useRef(0); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const persist = useCallback(() => {
    try { const user = sessionRef.current.user; if (user) localStorage.setItem(cacheKey(user.id), JSON.stringify({ base: baseRef.current, entries: dataRef.current })); else localStorage.setItem(LIBRARY_KEY, JSON.stringify({ version: 2, entries: dataRef.current })); setStorageError(""); }
    catch { setStorageError("本机缓存保存失败，请导出当前备份。云端同步状态见账号面板。"); }
  }, []);
  const show = useCallback((entries: Library) => { dataRef.current = entries; setVisibleLibrary(entries); }, []);
  const sync = useCallback(async () => {
    const active = sessionRef.current; if (!active.user || !active.csrf || busy.current || conflictsRef.current.length) return;
    const run = generation.current; busy.current = true; setSyncState("syncing"); setSyncError("");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await snapshot(await fetch("/api/library", { cache: "no-store", signal: AbortSignal.timeout(15000) })); if (run !== generation.current) return;
        const merged = mergeThreeWay(baseRef.current.entries, dataRef.current, remote.entries);
        if (merged.conflicts.length) { baseRef.current = remote; show(merged.entries); conflictsRef.current = merged.conflicts; setConflicts(merged.conflicts); setSyncState("conflict"); persist(); return; }
        if (!changedIds(remote.entries, merged.entries).length) { baseRef.current = remote; show(remote.entries); persist(); setLastSynced(new Date().toISOString()); setSyncState("synced"); return; }
        const sent = merged.entries; const localAtSend = dataRef.current;
        const response = await fetch("/api/library", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": active.csrf }, body: JSON.stringify({ entries: sent, version: remote.version }), signal: AbortSignal.timeout(15000) });
        if (run !== generation.current) return;
        if (response.status === 409) { await response.body?.cancel(); continue; }
        const committed = await snapshot(response); if (run !== generation.current) return;
        // Preserve edits made while the network request was in flight.
        const remaining = mergeThreeWay(localAtSend, dataRef.current, committed.entries).entries;
        baseRef.current = committed; show(remaining); persist(); setLastSynced(new Date().toISOString());
        if (!changedIds(committed.entries, remaining).length) { setSyncState("synced"); return; }
      }
      setSyncState("pending");
    } catch (error) { if (run === generation.current) { setSyncState("error"); setSyncError(error instanceof Error ? error.message : "同步失败，修改仍保留在本机缓存中。"); } }
    finally { busy.current = false; }
  }, [persist, show]);
  const setLibrary = useCallback((action: SetStateAction<Library>) => {
    const next = typeof action === "function" ? action(dataRef.current) : action; show(next); persist();
    if (conflictsRef.current.length) { conflictsRef.current = conflictsRef.current.map((conflict) => ({ ...conflict, local: next[conflict.id] || null })); setConflicts(conflictsRef.current); }
    if (sessionRef.current.user) { setSyncState(conflictsRef.current.length ? "conflict" : "pending"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void sync(), 700); }
  }, [show, persist, sync]);
  useEffect(() => {
    let cancelled = false;
    const start = setTimeout(async () => {
      let current: Session;
      try { const response = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(); current = await response.json(); }
      catch { current = { user: null, csrf: null, available: false }; setSyncError("账号服务暂时不可用；本机模式仍可使用，刷新页面后重试登录。"); }
      if (cancelled) return; sessionRef.current = current; setSession(current);
      try {
        const guest = guestLibrary(); setGuestCount(Object.keys(guest).length);
        if (current.user) {
          const raw = localStorage.getItem(cacheKey(current.user.id));
          if (raw) { const cached = JSON.parse(raw); const entries = validateLibrary({ version: 2, entries: cached.entries }); const base = validateLibrary({ version: 2, entries: cached.base?.entries }); baseRef.current = { entries: base, version: cached.base.version }; show(entries); }
        } else { show(guest); persist(); }
      } catch { setStorageError("部分本机记录无法读取，原始数据已保留，可在设置中导出恢复。"); }
      setReady(true); if (current.user) void sync(); else setSyncState("guest");
    }, 0);
    const focus = () => { if (document.visibilityState === "visible") void sync(); }; const interval = setInterval(focus, 30000); window.addEventListener("focus", focus); window.addEventListener("online", focus);
    // This ref is a request epoch, not a DOM reference: invalidate asynchronous requests on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; generation.current++; clearTimeout(start); clearInterval(interval); if (timer.current) clearTimeout(timer.current); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); };
  }, [persist, show, sync]);
  function resolveConflict(id: string, choice: "local" | "remote") {
    const conflict = conflictsRef.current.find((item) => item.id === id); if (!conflict) return;
    const next = { ...dataRef.current }; const selected = choice === "local" ? dataRef.current[id] : conflict.remote; if (selected) next[id] = selected; else delete next[id];
    conflictsRef.current = conflictsRef.current.filter((item) => item.id !== id); setConflicts(conflictsRef.current); show(next); persist();
    if (!conflictsRef.current.length) void sync();
  }
  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": sessionRef.current.csrf || "" } }); if (!response.ok && response.status !== 401) throw new Error("退出失败，请稍后再试。");
      if (sessionRef.current.user && !changedIds(baseRef.current.entries, dataRef.current).length) { try { localStorage.removeItem(cacheKey(sessionRef.current.user.id)); } catch { /* The account cache is still isolated from guest/other accounts. */ } }
      generation.current++; if (timer.current) clearTimeout(timer.current); const guest = guestLibrary(); sessionRef.current = { ...sessionRef.current, user: null, csrf: null }; setSession(sessionRef.current); baseRef.current = { entries: {}, version: 0 }; conflictsRef.current = []; setConflicts([]); show(guest); setSyncState("guest"); setSyncError("");
    } catch (error) { setSyncError(error instanceof Error ? error.message : "退出失败"); }
  }
  function importGuest() { try { const guest = guestLibrary(); setLibrary((current) => ({ ...guest, ...current })); } catch { setSyncError("本机记录无法读取，请先导出原始备份。"); } }
  return { library, setLibrary, ready, storageError, clearError: () => setStorageError(""), session, syncState, syncError, lastSynced, conflicts, resolveConflict, sync, logout, importGuest, guestCount };
}
