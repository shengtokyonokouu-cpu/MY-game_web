import { readPublicData } from "./public-data-server.ts";
import { nameRank, canRecordGame } from "./game-identity.ts";
import type { CatalogGame } from "./catalog.ts";
import type { SeriesChannel } from "./series-types.ts";
export type SearchWork = { id: string; names: string[]; ipIds: string[] };
export async function indexedGames(query: string, id?: string): Promise<CatalogGame[]> {
  const index = await readPublicData<SearchWork[]>("search.json");
  const hits = index.filter(g => id ? g.id === id : nameRank(g.names, query) > 0).sort((a,b) => nameRank(b.names, query) - nameRank(a.names, query)).slice(0, 40);
  const channels = [...new Set(hits.map(g => g.ipIds[0]).filter(Boolean))].slice(0, 4);
  const responses = await Promise.all(channels.map(ip => readPublicData<SeriesChannel>(`series/${ip}.json`)));
  const wanted = new Set(hits.map(g => g.id));
  return [...new Map(responses.flatMap(c => c.games).filter(g => wanted.has(g.id) && canRecordGame(g)).map(g => [g.id, g])).values()];
}
