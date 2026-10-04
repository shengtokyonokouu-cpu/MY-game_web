// Shared by the snapshot builder and runtime lookup. Redirects to a parent game
// or a franchise must not supply a sequel's name, synopsis or artwork.
export function gameArticle(title: string) {
  return !!title && !/^(List of |Category:|Template:)|\(.*series\)|列表|一覧|系列$|シリーズ$/i.test(title) && !title.includes("#");
}
function articleKey(title: string) {
  return title.normalize("NFKC").toLowerCase().replaceAll("_", " ").replace(/\([^)]*video game[^)]*\)/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
export function sameGameArticle(requested: string, resolved: string) {
  if (!gameArticle(requested) || !gameArticle(resolved) || articleKey(requested) !== articleKey(resolved)) return false;
  const year = (value: string) => value.match(/\((\d{4}) video game\)/i)?.[1];
  return !year(requested) || !year(resolved) || year(requested) === year(resolved);
}
export type WikiArtworkData = { query?: {
  normalized?: { from: string; to: string }[];
  redirects?: { from: string; to: string; tofragment?: string }[];
  pages?: { title: string; missing?: boolean; thumbnail?: { source: string }; langlinks?: { lang: string; title: string }[] }[];
} };
export function trustedGamePage(requested: string, data: WikiArtworkData) {
  const links = new Map([...(data.query?.normalized || []), ...(data.query?.redirects || [])].map((item) => [item.from, item]));
  let title = requested;
  for (let step = 0; step < 8 && links.has(title); step++) {
    const redirect = links.get(title)!;
    if ("tofragment" in redirect && redirect.tofragment) return null;
    title = redirect.to;
  }
  if (!sameGameArticle(requested, title)) return null;
  return data.query?.pages?.find((page) => page.title === title && !page.missing) || null;
}
