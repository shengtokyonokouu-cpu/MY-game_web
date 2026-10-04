import type { CatalogGame } from "../lib/catalog";
import { gameLanguages, namesFor } from "../lib/game-names";
const labels = { zh: "中文", ja: "日本語", en: "English" };
export function GameNameRows({ game, sources = false }: { game: CatalogGame; sources?: boolean }) {
  const names = namesFor(game);
  return <dl className={`game-names${sources ? " name-sources" : ""}`} aria-label="游戏中日英名称">{gameLanguages.map((language) => {
    const name = names[language];
    return <div key={language}><dt>{labels[language]}</dt><dd lang={language}>{name ? <>{sources ? <a href={name.sourceUrl} target="_blank" rel="noreferrer">{name.text}<small>{name.kind === "official" ? "官方" : name.kind === "store" ? "商店" : "索引"} ↗</small></a> : name.text}</> : <span className="name-missing">暂无可靠名称</span>}</dd></div>;
  })}</dl>;
}
