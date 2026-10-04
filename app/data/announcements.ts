import type { CatalogGame } from "../lib/catalog.ts";

// Human-checked publisher identities bridge announcements before encyclopedias
// create dedicated game articles. Never use the anime/franchise page as a game.
export const verifiedAnnouncements: CatalogGame[] = [{
  id: "apothecary-diaries-false-imperial-brother",
  title: "藥師少女的獨語 ～真假皇弟～",
  originalTitle: "The Apothecary Diaries: The False Imperial Brother",
  names: {
    zh: { text: "藥師少女的獨語 ～真假皇弟～", kind: "official", sourceUrl: "https://www.gamecity.com.tw/kusuriyanohitorigoto/tch/" },
    ja: { text: "薬屋のひとりごと ～偽りの皇弟～", kind: "official", sourceUrl: "https://www.gamecity.ne.jp/kusuriyanohitorigoto/jp/" },
    en: { text: "The Apothecary Diaries: The False Imperial Brother", kind: "official", sourceUrl: "https://www.koeitecmoamerica.com/theapothecarydiaries/us/" },
  },
  searchTerms: ["药师少女的独语", "药屋少女的呢喃", "薬屋のひとりごと", "真假皇弟", "偽りの皇弟", "Kusuriya no Hitorigoto"],
  developer: "Gust", publisher: "KOEI TECMO", country: "日本", region: "日本",
  platforms: ["Switch 2", "Switch", "PS5", "PC"], genres: ["推理冒险"],
  releaseDate: null, dateLabel: "2027 年初（具体日期未公布）", declaredStatus: "upcoming",
  summary: "以猫猫为主角的推理冒险游戏，故事原案由日向夏构思。通过调查、收集证据和调药推进案件。",
  image: "https://www.gamecity.com.tw/kusuriyanohitorigoto/assets/img/tch/og.jpg",
  articleTitle: "", featured: true,
  events: [{ title: "Nintendo Direct 2026.9.9", date: "2026-09-09", url: "https://www.nintendo.com/jp/nintendo-direct/20260909/index.html" }],
  source: { type: "official", label: "KOEI TECMO 官方公告", url: "https://www.koeitecmoamerica.com/news/investigate-palace-conspiracies-in-koei-tecmos-the-apothecary-diaries-the-false-imperial-brother/", checkedAt: "2026-09-10", evidence: "发行商确认 2027 年初推出 Switch 2、Switch、PS5 与 Steam 版；三语名称分别链接对应地区官网。尚未公布具体发售日，不补造日期。" },
}];
