import type { CatalogGame } from "./catalog.ts";
// Source labels stay on the game; these controlled facets are only for browsing.
const gameplayRules: [string, RegExp][] = [
  ["角色扮演", /rpg|role.?playing|角色扮演|ロールプレイング/i], ["动作", /action|动作|動作|アクション/i],
  ["冒险", /adventure|冒险|冒險|アドベンチャー/i], ["策略", /strategy|tactical|策略|战略|戰略|战术|戰術|ストラテジー/i],
  ["解谜", /puzzle|解谜|解謎|益智|パズル/i], ["模拟经营", /simulation|management|模拟|模擬|经营|經營|シミュレーション/i],
  ["射击", /shooter|shooting|fps|tps|射击|射擊|シューティング/i], ["格斗", /fighting|格斗|格鬥|格闘/i],
  ["平台跳跃", /platformer|platform game|平台跳跃|平台跳躍|プラットフォーム/i], ["竞速", /racing|竞速|競速|レース/i],
  ["体育", /sports|体育|體育|スポーツ/i], ["音乐节奏", /rhythm|节奏|節奏|音楽|リズム/i],
  ["视觉小说", /visual novel|视觉小说|視覺小說|ビジュアルノベル/i],
];
const themeRules: [string, RegExp][] = [["科幻", /sci.?fi|science fiction|科幻|SF/], ["奇幻", /fantasy|奇幻|ファンタジー/i], ["恐怖", /horror|恐怖|ホラー/i], ["犯罪", /crime|犯罪/i], ["历史", /historical|历史|歷史|歴史/i], ["末日", /post.apocalyptic|末日/i]];
const featureRules: [string, RegExp][] = [["回合制", /turn.based|回合制|ターン制/i], ["开放世界", /open.world|开放世界|開放世界|オープンワールド/i], ["Roguelike", /rogue|肉鸽|肉鴿/i], ["JRPG", /jrpg|日式.*rpg/i], ["动作 RPG", /action.?rpg|动作.*rpg|動作.*rpg/i]];
export const gameplayOptions = gameplayRules.map(([label]) => label);
export const themeOptions = themeRules.map(([label]) => label);
export const modeOptions = ["单人", "多人", "合作"];
export function gameFacets(game: Pick<CatalogGame, "genres" | "modes">) {
  const raw = game.genres.join(" · ");
  const modeText = [...game.genres, ...game.modes || []].join(" · ");
  return { gameplay: gameplayRules.filter(([,rule]) => rule.test(raw)).map(([label]) => label), themes: themeRules.filter(([,rule]) => rule.test(raw)).map(([label]) => label), features: featureRules.filter(([,rule]) => rule.test(raw)).map(([label]) => label), modes: [ /single.player|单人|單人|1人|一人/i.test(modeText) && "单人", /multi.player|多人|[2-9]\s*人/i.test(modeText) && "多人", /co.op|合作|协作|協力/i.test(modeText) && "合作" ].filter((v): v is string => !!v) };
}
export function platformMatch(platforms: string[], selected: string) {
  const picks = selected.split(",").filter(p => p && p !== "all");
  return !picks.length || picks.some(p => platforms.some(actual => actual === p || (p === "Xbox" && /^Xbox/i.test(actual))));
}
export function releaseWindow(game: CatalogGame, window: string, now = new Date()) {
  if (window === "all") return true;
  if (!game.releaseDate) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  if (window === "month") return game.releaseDate.slice(0,7) === today.slice(0,7);
  const start = new Date(now); start.setDate(start.getDate()-30);
  const first = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
  return game.declaredStatus === "released" && game.releaseDate >= first && game.releaseDate <= today;
}
