"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CatalogGame } from "../lib/catalog";
import { gameArticle } from "../lib/game-artwork";
const paths: Record<string, ReactNode> = {
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  tag: <><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  discover: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></>,
  library: <><path d="M4 5h5v16H4zM9 5h5v16H9zM15 6l4-1 3 15-4 1zM5 9h3M10 9h3"/></>,
  news: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M7 16h10M15 12h2"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16"/></>,
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>, sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>, upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>,
  game: <><path d="M7 7h10c3 0 5 12 2 13-2 1-4-3-5-3h-4c-1 0-3 4-5 3-3-1-1-13 2-13Z"/><path d="M7 10v5m-2-2h4M16 11h.1M18 14h.1"/></>,
};
export function Icon({ name, className = "" }: { name: string; className?: string }) { return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.game}</svg>; }
export function GameCover({ game, eager = false }: { game: CatalogGame; eager?: boolean }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const lookup = new URLSearchParams({ name: game.originalTitle }); if (gameArticle(game.articleTitle) && !game.id.startsWith("steam-")) lookup.set("title", game.articleTitle);
  const candidates = [game.image && /^(https:\/\/|\/covers\/)/.test(game.image) ? game.image : "", !game.entityId && game.originalTitle ? `/api/cover?${lookup}` : ""].filter(Boolean);
  const image = candidates.find((url) => !failedUrls.includes(url)); const failed = !image;
  return <div className={`game-cover ${failed ? "cover-missing" : ""}`}>
    {/* Public-source images load directly; a history grid never starts a crawl. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {image && <img key={image} src={image} alt={`${game.title}封面`} loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrls((urls) => [...urls, image])}/>}
    {failed && <div><Icon name="game"/><span>{game.title}</span><small>暂无可用封面</small></div>}
  </div>;
}
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); const original = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { dialog?.close(); document.body.style.overflow = original; }; }, []);
  // Native showModal supplies focus containment and Escape via the cancel event; click handles only the backdrop.
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
  return <dialog ref={ref} className="detail-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}><div className="dialog-inner"><button className="icon-button dialog-close" onClick={onClose} aria-label="关闭详情"><Icon name="close"/></button>{children}</div></dialog>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><Icon name="game"/><h2>{title}</h2><p>{description}</p>{action}</div>; }
