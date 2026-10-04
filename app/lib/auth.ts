export type Prepared = { bind(...values: unknown[]): Prepared; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> };
export type Database = { prepare(sql: string): Prepared; batch(statements: Prepared[]): Promise<unknown[]> };
export type AppEnv = { DB?: Database; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; PUBLIC_ORIGIN?: string };
export type Account = { id: string; login: string; name: string };
const sessionCookie = "__Host-release-session";
const stateCookie = "__Host-release-oauth";
const SESSION_AGE = 7 * 24 * 60 * 60;
export const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: privateHeaders }); }
export function token() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
export async function hash(value: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function cookie(name: string, value: string, age: number) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
export function readCookie(request: Request, name: string) { return request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
export function origin(env: AppEnv) { return env.PUBLIC_ORIGIN || "https://release-signal.pages.dev"; }
function allowedHost(request: Request, env: AppEnv) { const current = new URL(request.url); return current.origin === origin(env) || ["localhost", "127.0.0.1"].includes(current.hostname); }
export function configured(env: AppEnv) { return !!(env.DB && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET); }
export async function authenticate(request: Request, env: AppEnv): Promise<{ user: Account; csrf: string; tokenHash: string } | null> {
  const raw = readCookie(request, sessionCookie); if (!env.DB || !/^[A-Za-z0-9_-]{43}$/.test(raw) || !allowedHost(request, env)) return null;
  const tokenHash = await hash(raw);
  const user = await env.DB.prepare("SELECT u.id, u.login, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(tokenHash, Date.now()).first<Account>();
  return user ? { user, csrf: await hash(`csrf:${raw}`), tokenHash } : null;
}
export function safeMutation(request: Request, csrf: string) {
  const requestOrigin = new URL(request.url).origin;
  return request.headers.get("Origin") === requestOrigin && request.headers.get("X-CSRF-Token") === csrf && request.headers.get("Sec-Fetch-Site") !== "cross-site";
}
function redirect(path: string, env: AppEnv, cookies: string[] = []) { const headers = new Headers(privateHeaders); headers.set("Location", new URL(path, origin(env)).href); cookies.forEach((value) => headers.append("Set-Cookie", value)); return new Response(null, { status: 303, headers }); }
export async function handleAuth(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url); const action = url.pathname.split("/").at(-1);
  if (!allowedHost(request, env)) return json({ error: "登录只在正式站点开放。" }, 403);
  if (action === "me" && request.method === "GET") {
    const session = await authenticate(request, env); return json({ available: configured(env), user: session?.user || null, csrf: session?.csrf || null });
  }
  if (action === "logout" && request.method === "POST") {
    const session = await authenticate(request, env); if (!session) return json({ error: "请先登录" }, 401);
    if (!safeMutation(request, session.csrf)) return json({ error: "请求校验失败" }, 403);
    await env.DB!.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...privateHeaders, "Content-Type": "application/json", "Set-Cookie": cookie(sessionCookie, "", 0) } });
  }
  if (!configured(env)) return json({ error: "GitHub 登录配置尚未完成。" }, 503);
  if (action === "login" && request.method === "GET") {
    if (url.origin !== origin(env)) return redirect("/api/auth/login", env);
    const state = token(); const verifier = token(); const now = Date.now();
    const limitKey = await hash(`${request.headers.get("CF-Connecting-IP") || "local"}:${Math.floor(now / 60000)}`);
    const rate = await env.DB!.prepare("INSERT INTO auth_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 RETURNING hits").bind(limitKey, now + 300000).first<{ hits: number }>();
    if (rate && rate.hits > 15) return json({ error: "登录尝试过于频繁，请一分钟后重试。" }, 429);
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM auth_limits WHERE expires_at < ?").bind(now),
      env.DB!.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
      env.DB!.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
      env.DB!.prepare("INSERT INTO oauth_states (state_hash, verifier, expires_at) VALUES (?, ?, ?)").bind(await hash(state), verifier, now + 600000),
    ]);
    const target = new URL("https://github.com/login/oauth/authorize");
    target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID!, redirect_uri: `${origin(env)}/api/auth/callback`, state, code_challenge: await hash(verifier), code_challenge_method: "S256", scope: "" }).toString();
    return new Response(null, { status: 302, headers: { ...privateHeaders, Location: target.href, "Set-Cookie": cookie(stateCookie, state, 600) } });
  }
  if (action === "callback" && request.method === "GET") {
    const state = url.searchParams.get("state") || ""; const code = url.searchParams.get("code") || "";
    const fail = () => redirect("/?view=settings&auth_error=1", env, [cookie(stateCookie, "", 0)]);
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || state !== readCookie(request, stateCookie) || !code || code.length > 256) return fail();
    const pending = await env.DB!.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING verifier").bind(await hash(state), Date.now()).first<{ verifier: string }>();
    if (!pending) return fail();
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${origin(env)}/api/auth/callback`, code_verifier: pending.verifier }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) return fail(); const grant = await response.json() as { access_token?: string }; if (!grant.access_token) return fail();
      const identity = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${grant.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Release-Signal", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10000) });
      if (!identity.ok) return fail(); const profile = await identity.json() as { id?: number; login?: string; name?: string };
      if (!Number.isSafeInteger(profile.id) || !profile.login) return fail();
      const id = `github:${profile.id}`; const now = Date.now(); const session = token();
      // OAuth access tokens are used only to identify the user, then discarded. No repository scope is requested.
      await env.DB!.batch([
        env.DB!.prepare("INSERT INTO users (id, login, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, updated_at = excluded.updated_at").bind(id, profile.login, profile.name || profile.login, now, now),
        env.DB!.prepare("INSERT INTO libraries (user_id, document, version, updated_at) VALUES (?, '{}', 0, ?) ON CONFLICT(user_id) DO NOTHING").bind(id, now),
        env.DB!.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await hash(session), id, now + SESSION_AGE * 1000),
      ]);
      return redirect("/?view=settings&signed_in=1", env, [cookie(stateCookie, "", 0), cookie(sessionCookie, session, SESSION_AGE)]);
    } catch { return fail(); }
  }
  return json({ error: "接口不存在" }, 404);
}
