import type { CatalogGame } from "./catalog.ts";
import type { NewsFeed } from "./news.ts";
import { articleCategories, articleFranchises, articlePlatforms, franchises, gameFranchises, ipTimeline, matchesNewsQuery, type NewsCategory } from "./franchises.ts";

export function ipSummaries(games: CatalogGame[], feed: NewsFeed) {
  return franchises.map((ip) => ({ ...ip, gameCount: games.filter((game) => gameFranchises(game).some((match) => match.id === ip.id)).length, newsCount: feed.items.filter((item) => articleFranchises(item).some((match) => match.id === ip.id)).length }));
}
export function buildIPHub(id: string, games: CatalogGame[], feed: NewsFeed, filters: { category?: NewsCategory; platform?: string; q?: string; page?: number } = {}) {
  const ip = franchises.find((item) => item.id === id); if (!ip) return null;
  const allGames = games.filter((game) => gameFranchises(game).some((match) => match.id === id));
  const allNews = feed.items.filter((item) => articleFranchises(item).some((match) => match.id === id));
  const relatedGames = allGames.filter((game) => !filters.platform || filters.platform === "all" || game.platforms.includes(filters.platform));
  const news = allNews.filter((item) => (!filters.platform || filters.platform === "all" || articlePlatforms(item).includes(filters.platform)) && (!filters.category || articleCategories(item).includes(filters.category)) && matchesNewsQuery(item, filters.q || "", games));
  const pages = Math.max(1, Math.ceil(news.length / 12)); const page = Math.min(pages, Math.max(1, filters.page || 1));
  return { ip, counts: { games: allGames.length, news: allNews.length }, games: relatedGames, timeline: ipTimeline(relatedGames), news: { items: news.slice((page - 1) * 12, page * 12), total: news.length, page, pages, pageSize: 12 }, fetchedAt: feed.fetchedAt, sources: feed.sources, stale: !!feed.stale };
}
