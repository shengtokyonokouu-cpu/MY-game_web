import { findStoreNames } from "./store-names.ts";
import { mergeNames, type GameNames } from "./game-names.ts";

export async function enrichStoreNames(games: { title: string; originalTitle?: string; image?: string; names?: GameNames }[], limit = 120) {
  const queue = games.filter((game) => !(game.names?.zh && game.names?.ja && game.names?.en)).slice(0, limit);
  let updated = 0, checked = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const game = queue.shift()!;
      try {
        const result = await findStoreNames(game.names?.en?.text || game.originalTitle || game.title);
        if (result) { game.names = mergeNames(game.names, result.names); game.image ||= result.image; game.title = game.names.zh?.text || game.title; if (game.originalTitle !== undefined) game.originalTitle = game.names.en?.text || game.originalTitle; updated++; }
      } catch { queue.length = 0; /* Back off on upstream failures/rate limits, retaining existing names. */ }
      if (++checked % 20 === 0) console.log(`Regional store names: ${checked} checked, ${updated} matched.`);
    }
  }));
  return updated;
}
