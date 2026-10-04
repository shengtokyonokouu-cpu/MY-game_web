export type View = "discover" | "calendar" | "library" | "news" | "settings" | "ips" | "ip" | "notifications";
export type BrowseRoute = { view: View; query: string; status: string; platform: string; genre: string; region: string; sort: string; page: number; shelfFilter: string; ipFilter: string; hubId: string; homeTab: string; themeFilter: string; mode: string; window: string; game: string; title: string; lang: string };
export const defaultRoute: BrowseRoute = { view: "discover", query: "", status: "all", platform: "all", genre: "all", region: "all", sort: "recommended", page: 1, shelfFilter: "all", ipFilter: "all", hubId: "", homeTab: "discover", themeFilter: "all", mode: "all", window: "all", game: "", title: "", lang: "" };
const keys = { view:"view", query:"q", status:"status", platform:"platform", genre:"genre", region:"region", sort:"sort", page:"page", shelfFilter:"shelf", ipFilter:"series", hubId:"ip", homeTab:"tab", themeFilter:"topic", mode:"mode", window:"window", game:"game", title:"title", lang:"lang" } as const;
export function parseRoute(search: string): BrowseRoute {
  const p = new URLSearchParams(search), route = { ...defaultRoute };
  for (const [key,param] of Object.entries(keys)) if (key !== "page" && p.has(param)) (route as unknown as Record<string, string>)[key] = p.get(param)!.slice(0,200);
  if (!["discover","calendar","library","news","settings","ips","ip","notifications"].includes(route.view)) route.view="discover";
  if (!["all","released","upcoming","development","check"].includes(route.status)) route.status="all";
  if (!["all","wishlist","playing","finished","paused"].includes(route.shelfFilter)) route.shelfFilter="all";
  route.page = Math.max(1, Math.min(10000, Number(p.get("page")) || 1)); route.page = Math.floor(route.page);
  return route;
}
export function routeURL(route: BrowseRoute) {
  const p = new URLSearchParams();
  for (const [key,param] of Object.entries(keys)) { const field=key as keyof BrowseRoute; if(route[field]!==defaultRoute[field]) p.set(param,String(route[field])); }
  return "/"+(p.size ? "?"+p : "");
}
