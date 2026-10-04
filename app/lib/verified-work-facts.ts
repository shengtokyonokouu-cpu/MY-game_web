import type { CatalogGame } from "./catalog.ts";
// Small, sourced corrections take precedence over lower-quality imports. They
// do not invent translated names or silently rewrite any personal records.
export function verifiedWorkFacts(game: CatalogGame): CatalogGame {
  if(game.entityId!=="Q64577191"&&game.id!=="wd-q64577191")return game;
  const url="https://www.nintendo.com/us/store/products/the-legend-of-zelda-tears-of-the-kingdom-switch/";
  return {...game,entityKind:"game",releaseDate:"2023-05-12",dateLabel:"2023.05.12",year:2023,declaredStatus:"released",genres:["动作","冒险","开放世界","解谜"],modes:["单人"],chineseSupport:{text:"支持简体 / 繁体中文（Switch 版）",sourceUrl:url},summary:"在海拉鲁大地与天空岛屿自由探索，使用究极手与余料建造组合制作工具、载具和武器，寻找解谜与战斗的方法。",source:{type:"official",label:"Nintendo 官方商店 · Switch 版",url,checkedAt:"2026-10-04",evidence:"已核验 Switch 版于 2023-05-12 发售、单人游玩，并支持简体及繁体中文。此前知识库的 2022 计划年份不作为实际发售时间；其他平台版本时间另行核验，名称与开发商仍保留原索引来源。"},releases:[{date:"2023-05-12",label:"2023.05.12",platforms:["Switch"],kind:"Switch 版",sourceUrl:url},...(game.releases||[]).filter(r=>!r.platforms.includes("Switch"))]};
}
