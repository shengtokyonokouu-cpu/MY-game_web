export const gameLanguages = ["zh", "ja", "en"] as const;
export type GameLanguage = typeof gameLanguages[number];
export type LocalizedName = { text: string; sourceUrl: string; kind: "official" | "store" | "index" };
export type GameNames = Partial<Record<GameLanguage, LocalizedName>>;
type NamedGame = { title: string; originalTitle: string; articleTitle: string; names?: GameNames; searchTerms?: string[]; source: { url: string } };

export function detectLanguage(text: string): GameLanguage {
  // Kana must be checked before kanji: Japanese titles often contain both.
  return /[\u3040-\u30ff\uff66-\uff9f]/.test(text) ? "ja" : /[\u3400-\u9fff]/.test(text) ? "zh" : "en";
}
export function namesFor(game: NamedGame): GameNames {
  const names: GameNames = { ...game.names };
  for (const text of [game.title, game.originalTitle]) {
    if (!text) continue;
    if (Object.values(names).some((name) => name.text === text)) continue;
    const language = detectLanguage(text);
    names[language] ??= { text, sourceUrl: game.source.url, kind: "index" };
  }
  return names;
}
export function identityNames(game: NamedGame) {
  return [...new Set([game.title, game.originalTitle, game.articleTitle, ...Object.values(game.names || {}).map((name) => name.text)].filter(Boolean))];
}
export function foldSearch(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60)).replace(/[™®]/g, "");
}
export function searchTokensMatch(text: string, query: string) {
  const haystack = foldSearch(text).replace(/[^\p{L}\p{N}]/gu, "");
  return foldSearch(query).split(/\s+/).filter(Boolean).every((term) => haystack.includes(term.replace(/[^\p{L}\p{N}]/gu, "")));
}
export function mergeNames(primary?: GameNames, extra?: GameNames): GameNames {
  const result = { ...extra };
  const rank = { index: 0, store: 1, official: 2 };
  for (const language of gameLanguages) {
    const a = primary?.[language], b = extra?.[language];
    const hasLocalScript = (text: string) => language === "ja" ? /[\u3040-\u30ff\u3400-\u9fff]/.test(text) : language === "zh" ? /[\u3400-\u9fff]/.test(text) : /[a-z]/i.test(text);
    // A shop may return its English fallback for every language. Do not erase
    // an existing sourced Chinese/Japanese name with that fallback.
    if (a && (!b || (hasLocalScript(a.text) && !hasLocalScript(b.text)) || rank[a.kind] >= rank[b.kind])) result[language] = a;
  }
  return result;
}
