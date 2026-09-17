// Rule-based multilingual NER proposes spans; Wikidata verifies identities and
// P179 parentage. Frequency alone NEVER proves that a phrase is a franchise.
export const normalizeEntity = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[é]/g, "e").replace(/[’']/g, "").replace(/\s+/g, " ").trim();
export type EntityEvidence = { entityId: string; matchedId: string; sourceUrl: string; matchedUrl: string; names: { zh: string; ja: string; en: string }; aliases: string[]; matchedAliases: string[]; relation: "series" | "P179" | "P527" | "P8345"; path?: string[]; checkedAt: number };
const ignored = /^(Nintendo|Nintendo Switch(?: 2)?|PlayStation(?: 5)?|Xbox|Steam|PC|Switch|Direct|Nintendo Direct|Game Pass|Xbox Game Pass|Update|New|Release Date|Read More|Official Trailer|Gamescom|Tokyo Game Show|TGS|ゲーム|ゲームタイトル|新作|シリーズ|プレイステーション|ニンテンドー|任天堂|游戏|遊戲|预告|預告|最新消息|发售日|発売日)$/i;
export function extractEntities(title: string, body = "") {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    const value = raw.replace(/<[^>]*>/g, "").replace(/^[\s"'“”『「《【]+|[\s"'”』」》】]+$/g, "").trim();
    if (value.length < 3 || value.length > 100 || !/\p{L}/u.test(value) || ignored.test(value) || /https?:|www\.|[@<>{}]/i.test(value)) return;
    found.set(normalizeEntity(value), value);
  };
  // Quoted titles in CJK text and explicit code names, including in the body.
  const text = (title + "\n" + body).slice(0, 35000);
  for (const match of text.matchAll(/[《『「“]([^》』」”\n]{3,100})[》』」”]/g)) add(match[1]);
  for (const match of text.matchAll(/\b(?:Project|Codename|Code Name)\s+[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?/g)) add(match[0]);
  // Headline subjects and capitalized multiword names, not arbitrary n-grams.
  add(title.split(/\s+(?:launches?|announced|revealed|gets|coming|release[sd]?|new trailer|review|hands-on)\b|[：—–|]|(?:が|を|は).*(?:発売|公開|発表)/i)[0]);
  for (const match of text.matchAll(/\b[A-Z][\p{L}\d'’-]+(?:\s+(?:(?:of|the|and|in|no|of the)\s+)?[A-Z][\p{L}\d'’:-]+){1,6}/gu)) add(match[0]);
  return [...found.values()].slice(0, 16);
}
type Entity = { id: string; labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Record<string, { rank?: string; mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> };
const languages = ["zh-cn", "zh-hans", "zh", "zh-tw", "zh-hant", "ja", "en", "en-gb", "en-us", "mul"];
function names(entity: Entity) { const shared = entity.labels?.mul?.value || ""; return { zh: languages.slice(0, 5).map((l) => entity.labels?.[l]?.value).find(Boolean) || "", ja: entity.labels?.ja?.value || "", en: entity.labels?.en?.value || entity.labels?.["en-gb"]?.value || entity.labels?.["en-us"]?.value || (/^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(shared) ? shared : "") }; }
function aliases(entity: Entity) { return [...new Set(languages.flatMap((l) => [entity.labels?.[l]?.value || "", ...(entity.aliases?.[l] || []).map((a) => a.value)]).filter((a) => a.length >= 3 && a.length <= 100 && !ignored.test(a)))].slice(0, 80); }
function claims(entity: Entity, property: string) { return (entity.claims?.[property] || []).filter((v) => v.rank !== "deprecated").map((v) => v.mainsnak?.datavalue?.value?.id).filter((v): v is string => !!v && /^Q\d+$/.test(v)); }
export type EntityClient = (params: Record<string, string>) => Promise<unknown>;
export class EntityBackoff extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter = 300000) { super(message); this.name = "EntityBackoff"; this.retryAfter = retryAfter; }
}
export const wikidataClient: EntityClient = async (params) => {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ ...params, format: "json", maxlag: "5" }).toString();
  const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "ReleaseSignal/3.0 (https://release-signal.pages.dev; read-only IP classification)", Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  const retryAfter = Math.min(3600000, Math.max(60000, (Number(response.headers.get("Retry-After")) || 300) * 1000));
  if ([429, 502, 503, 504].includes(response.status)) throw new EntityBackoff("Wikidata HTTP " + response.status, retryAfter);
  if (!response.ok) throw new Error("Wikidata HTTP " + response.status);
  const text = await boundedText(response, 1_500_000);
  const data = JSON.parse(text);
  if (data.error?.code === "maxlag" || data.error?.code === "ratelimited") throw new EntityBackoff("Wikidata " + String(data.error.code), retryAfter);
  if (data.error) throw new Error("Wikidata " + String(data.error.code));
  return data;
};
export async function boundedText(response: Response, max: number) {
  if (Number(response.headers.get("Content-Length")) > max) { await response.body?.cancel(); throw new Error("Response too large"); }
  const reader = response.body?.getReader(); if (!reader) return "";
  const decoder = new TextDecoder(); let result = ""; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > max) throw new Error("Response too large"); result += decoder.decode(next.value, { stream: true }); } return result + decoder.decode(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function resolveEntity(term: string, language: string, api: EntityClient = wikidataClient, now = Date.now()): Promise<EntityEvidence | null> {
  const search = await api({ action: "wbsearchentities", search: term, language, uselang: language, type: "item", limit: "15" }) as { search?: { id: string }[] };
  const ids = (search.search || []).map((e) => e.id).filter((id) => /^Q\d+$/.test(id));
  if (!ids.length) return null;
  const get = async (ids: string[]) => (await api({ action: "wbgetentities", ids: [...new Set(ids)].join("|"), props: "labels|aliases|claims", languages: languages.join("|") }) as { entities?: Record<string, Entity> }).entities || {};
  const entities = await get(ids);
  // Reject fuzzy matches and disambiguation: never select the first search hit blindly.
  const exact = Object.values(entities).filter((e) => aliases(e).some((a) => normalizeEntity(a) === normalizeEntity(term)));
  const isSeries = (entity: Entity) => claims(entity, "P31").includes("Q7058673");
  const isGame = (entity: Entity) => claims(entity, "P31").includes("Q7889");
  const isMedia = (entity: Entity) => claims(entity, "P31").includes("Q196600");
  const parents = [...new Set(exact.flatMap((e) => isGame(e) ? claims(e, "P179") : isMedia(e) ? claims(e, "P527") : []))].slice(0, 15);
  const parentEntities = parents.length ? await get(parents) : {};
  const seriesEntities = [...Object.values(parentEntities), ...exact].filter(isSeries);
  const rootIds = [...new Set(seriesEntities.flatMap((s) => claims(s, "P8345")))].slice(0, 10);
  const rootEntities = rootIds.length ? await get(rootIds) : {};
  const canonical = (series: Entity) => {
    const roots = claims(series, "P8345").map((id) => rootEntities[id]).filter((e) => e && isMedia(e));
    return roots.length === 1 ? roots[0] : series;
  };
  const matches: EntityEvidence[] = [];
  for (const entity of exact) {
    const associated = isSeries(entity) ? [entity] : isGame(entity) ? claims(entity, "P179").map((id) => parentEntities[id]).filter(Boolean) : isMedia(entity) ? claims(entity, "P527").map((id) => parentEntities[id]).filter(Boolean) : [];
    for (const series of associated.filter(isSeries)) {
      // A media franchise is accepted only through a verified VIDEO GAME
      // series; a film, person, fictional universe or fuzzy name is insufficient.
      const root = isMedia(entity) ? entity : canonical(series);
      matches.push({ entityId: root.id, matchedId: entity.id, names: names(root), aliases: aliases(root), matchedAliases: aliases(entity), sourceUrl: "https://www.wikidata.org/wiki/" + root.id, matchedUrl: "https://www.wikidata.org/wiki/" + entity.id, relation: isMedia(entity) ? "P527" : isGame(entity) ? "P179" : root.id !== series.id ? "P8345" : "series", path: [...new Set([entity.id, series.id, root.id])], checkedAt: now });
    }
  }
  // Several works may have identical labels, but only an unambiguous parent is accepted.
  return new Set(matches.map((m) => m.entityId)).size === 1 ? matches[0] : null;
}
