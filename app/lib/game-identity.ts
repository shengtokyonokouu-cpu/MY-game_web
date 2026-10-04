import type { CatalogGame } from "./catalog.ts";
import { identityNames, searchTokensMatch } from "./game-names.ts";

export type EntityKind = "game" | "character" | "series" | "unknown";
export type EntityClaim = { rank?: string; mainsnak?: { datavalue?: { value?: { id?: string } } } };
export type WikiEntity = { claims?: Record<string, EntityClaim[]> };
export function claimIds(entity: WikiEntity | undefined, property: string) {
  return (entity?.claims?.[property] || []).filter(c => c.rank !== "deprecated").map(c => c.mainsnak?.datavalue?.value?.id).filter((id): id is string => !!id);
}
// Classification follows instance-of, then subclass-of. A character appearing
// in a game (P1441) is NOT an instance of that game; categories are not proof.
export function entityKind(entity: WikiEntity, classes: Record<string, WikiEntity> = {}): EntityKind {
  const types = new Set(claimIds(entity, "P31")); const queue = [...types];
  for (let i = 0; i < queue.length && i < 150; i++) for (const parent of claimIds(classes[queue[i]], "P279")) if (!types.has(parent)) { types.add(parent); queue.push(parent); }
  if (["Q95074", "Q15632617", "Q15773347"].some(id => types.has(id))) return "character";
  if (["Q7058673", "Q196600"].some(id => types.has(id))) return "series";
  return types.has("Q7889") ? "game" : "unknown";
}
export function canRecordGame(game: CatalogGame) {
  if (game.entityKind && game.entityKind !== "game") return false;
  // Preserve old records, but quarantine untyped on-demand encyclopedia hits.
  // Annual release tables and entity-backed historical catalogs are separate
  // audited ingestors. Never silently delete a player's legacy notes.
  if (/^Wikipedia · (ZH|JA|EN)$/.test(game.source.label)) return game.entityKind === "game";
  return true;
}
export function nameKey(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[™®]|\([^)]*(?:video game|电子游戏|電子遊戲)[^)]*\)/gi, "").replace(/[^\p{L}\p{N}]/gu, "");
}
export function nameRank(names: string[], query: string) {
  const key = nameKey(query); if (!key) return 0;
  if (names.some(name => nameKey(name) === key)) return 4;
  if (names.some(name => nameKey(name).endsWith(key))) return 3;
  return names.some(name => searchTokensMatch(name, query)) ? 2 : 0;
}
export function searchRank(game: CatalogGame, query: string) {
  return nameRank(identityNames(game), query) * 10 || nameRank(game.searchTerms || [], query) || (searchTokensMatch([game.developer, game.publisher, ...game.genres, ...game.platforms].join(" "), query) ? 1 : 0);
}
