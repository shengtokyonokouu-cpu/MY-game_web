export type NewsSource = { id: string; name: string; url: string; site: string; kind: "official" | "media"; language: string };
// Shared by the server fetcher and the untrusted browser-cache validator.
export const newsSources: NewsSource[] = [
  { id: "playstation", name: "PlayStation Blog · EN", url: "https://blog.playstation.com/feed/", site: "https://blog.playstation.com", kind: "official", language: "英文" },
  { id: "xbox", name: "Xbox Wire · EN", url: "https://news.xbox.com/en-us/feed/", site: "https://news.xbox.com", kind: "official", language: "英文" },
  { id: "gematsu", name: "Gematsu", url: "https://www.gematsu.com/feed", site: "https://www.gematsu.com", kind: "media", language: "英文" },
  { id: "playstation-ja", name: "PlayStation Blog · 日本語", url: "https://blog.ja.playstation.com/feed/", site: "https://blog.ja.playstation.com", kind: "official", language: "日文" },
  { id: "playstation-zh", name: "PlayStation Blog · 繁體中文", url: "https://blog.zh-hant.playstation.com/feed/", site: "https://blog.zh-hant.playstation.com", kind: "official", language: "中文" },
  { id: "xbox-ja", name: "Xbox Wire Japan", url: "https://news.xbox.com/ja-jp/feed/", site: "https://news.xbox.com", kind: "official", language: "日文" },
  { id: "4gamer", name: "4Gamer.net", url: "https://www.4gamer.net/rss/index.xml", site: "https://www.4gamer.net", kind: "media", language: "日文" },
  { id: "gnn", name: "巴哈姆特 GNN", url: "https://gnn.gamer.com.tw/rss.xml", site: "https://gnn.gamer.com.tw", kind: "media", language: "中文" },
];
