import { authenticate, hash, json, safeMutation, type AppEnv, type Database } from "./auth.ts";
import { articleFranchises, franchiseById, majorNewsReason } from "./franchises.ts";
import { registeredIP } from "./ip-repository.ts";
import type { NewsArticle, NewsFeed } from "./news.ts";

export type IPNotification = { id: string; article: NewsArticle; ipIds: string[]; reason: string; createdAt: number; readAt: number | null };
export type IPAccountState = { following: string[]; notifications: IPNotification[]; unread: number; checkedAt?: string; partial?: boolean };
type Subscription = { ipId: string; createdAt: number };
async function subscriptions(db: Database, owner: string): Promise<Subscription[]> {
  const row = await db.prepare("SELECT json_group_array(json_object('ipId', ip_id, 'createdAt', created_at)) AS data FROM ip_subscriptions WHERE user_id = ?").bind(owner).first<{ data: string }>();
  return JSON.parse(row?.data || "[]");
}
export async function accountIPState(db: Database, owner: string): Promise<IPAccountState> {
  const [follows, row, count] = await Promise.all([
    subscriptions(db, owner),
    db.prepare("SELECT json_group_array(json_object('id', article_id, 'article', json(article), 'ipIds', json(ip_ids), 'reason', reason, 'createdAt', created_at, 'readAt', read_at)) AS data FROM (SELECT * FROM ip_notifications WHERE user_id = ? ORDER BY created_at DESC, article_id LIMIT 200)").bind(owner).first<{ data: string }>(),
    db.prepare("SELECT count(*) AS count FROM ip_notifications WHERE user_id = ? AND read_at IS NULL").bind(owner).first<{ count: number }>(),
  ]);
  return { following: follows.map((item) => item.ipId), notifications: JSON.parse(row?.data || "[]"), unread: count?.count || 0 };
}
async function smallJSON(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("仅接受 JSON 数据");
  const reader = request.body?.getReader(); if (!reader) throw new Error("缺少数据");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new Error("请求过大"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function collectIPNotifications(db: Database, owner: string, feed: NewsFeed, now = Date.now()) {
  const follows = await subscriptions(db, owner); const cutoff = now - 30 * 86400000;
  const candidates = feed.items.filter((article) => {
    const published = Date.parse(article.publishedAt);
    return published >= cutoff && published <= now && majorNewsReason(article) && (article.ipIds || articleFranchises(article).map((ip) => ip.id)).some((id) => follows.some((follow) => follow.ipId === id && published >= follow.createdAt));
  });
  // A statement per candidate rechecks active subscriptions to close unsubscribe
  // races. Article IDs deduplicate cross-IP mentions and repeated polling.
  const statements = await Promise.all(candidates.slice(0, 240).map(async (article) => {
    const ids = article.ipIds || articleFranchises(article).map((ip) => ip.id);
    return db.prepare("INSERT INTO ip_notifications (user_id, article_id, article, ip_ids, reason, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ip_subscriptions WHERE user_id = ? AND ip_id IN (SELECT value FROM json_each(?)) AND created_at <= ?) ON CONFLICT(user_id, article_id) DO NOTHING")
      .bind(owner, await hash(article.id), JSON.stringify(article), JSON.stringify(ids), majorNewsReason(article), Date.parse(article.publishedAt), owner, JSON.stringify(ids), Date.parse(article.publishedAt));
  }));
  // D1 batch size is bounded; pruning and reads remain account-scoped.
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
  await db.prepare("DELETE FROM ip_notifications WHERE user_id = ? AND created_at < ?").bind(owner, cutoff).run();
}
export async function handleIPAccount(request: Request, env: AppEnv, news: () => Promise<NewsFeed>, publicIP?: (id:string)=>Promise<boolean>): Promise<Response> {
  const session = await authenticate(request, env); if (!session) return json({ error: "请先使用 GitHub 登录，再关注系列或查看通知。" }, 401);
  const db = env.DB!; const owner = session.user.id; const notifications = new URL(request.url).pathname.endsWith("notifications");
  if (request.method === "GET") return json(await accountIPState(db, owner));
  if (!safeMutation(request, session.csrf)) return json({ error: "请求校验失败，请刷新页面后重试。" }, 403);
  if (notifications && request.method === "POST") {
    const now = Date.now(); const prefix = `ip-notify:${await hash(owner)}:`;
    const rate = await db.prepare("INSERT INTO auth_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 RETURNING hits").bind(`${prefix}${Math.floor(now / 60000)}`, now + 300000).first<{ hits: number }>();
    if (rate && rate.hits > 6) return json({ error: "检查过于频繁，请一分钟后重试。" }, 429);
    await db.prepare("DELETE FROM auth_limits WHERE key LIKE ? AND expires_at < ?").bind(`${prefix}%`, now).run();
    const feed = await news(); if (feed.stale) return json({ error: "新闻源暂不可用，未生成新提醒。" }, 503);
    await collectIPNotifications(db, owner, feed);
    return json({ ...await accountIPState(db, owner), checkedAt: feed.fetchedAt, partial: feed.sources.some((source) => !source.ok) });
  }
  if ((!notifications && request.method !== "PUT") || (notifications && request.method !== "PATCH")) return json({ error: "请求方式不支持" }, 405);
  let body; try { body = await smallJSON(request); } catch { return json({ error: "请求格式不正确或超过 8 KB。" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "请求格式不正确。" }, 400);
  if (!notifications) {
    if (typeof body.ipId !== "string" || !/^[a-z0-9-]{1,100}$/.test(body.ipId) || typeof body.following !== "boolean" || (!franchiseById(body.ipId) && !(publicIP ? await publicIP(body.ipId) : await registeredIP(db,body.ipId)))) return json({ error: "未知 IP 或订阅状态。" }, 400);
    if (body.following) await db.prepare("INSERT INTO ip_subscriptions (user_id, ip_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, ip_id) DO NOTHING").bind(owner, body.ipId, Date.now()).run();
    else await db.prepare("DELETE FROM ip_subscriptions WHERE user_id = ? AND ip_id = ?").bind(owner, body.ipId).run();
  } else {
    if (body.all === true) await db.prepare("UPDATE ip_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(Date.now(), owner).run();
    else {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200 || body.ids.some((id: unknown) => typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id))) return json({ error: "通知 ID 不正确。" }, 400);
      await db.prepare("UPDATE ip_notifications SET read_at = ? WHERE user_id = ? AND article_id IN (SELECT value FROM json_each(?)) AND read_at IS NULL").bind(Date.now(), owner, JSON.stringify(body.ids)).run();
    }
  }
  return json(await accountIPState(db, owner));
}
