# IP 分类、订阅与频道实施说明

本次是在现有 React / Vinext + Cloudflare Pages / D1 + GitHub OAuth 项目上追加实现，不替换游戏架、评分、账号或抓取渠道。

## 页面与交互

| 入口 | 实现 |
| --- | --- |
| `/?view=ips` | 系列目录；中日英名称、简介、已索引游戏数、当前资讯数、关注按钮 |
| `/?view=ip&ip=zelda` | 可分享的 IP 频道；概况、关联游戏分页、未来版本时间轴、4 类动态、平台与语言筛选 |
| 首页 `/?tab=following` | 我的关注；仅匹配云端关注 IP 的新闻，可再按系列、平台、搜索词过滤 |
| `/?view=news` | 多 IP 标签、一键关注、横向精选 IP 快捷筛选；与平台、语言、来源及新闻类型做 AND 交集 |
| 全局搜索 | 中日英名称、作品别名推荐主 IP；方向键选择，Enter 打开，Esc 收起；保留输入法输入行为 |
| 搜索结果侧栏 | 基于本次结果生成 IP 数量；移动端折叠为顶部横排筛选按钮 |
| `/?view=notifications` | 未读徽标、单条/全部已读、手动检查；云端已读状态跨设备一致 |

游戏卡片和新闻卡片的标签可打开 IP 频道。快捷筛选不刷新页面。导航采用现有 query 路由，增加浏览器前进/后退处理；不引入第二套路由框架。沿用全局浅色默认、深色切换、缩放和原生居中弹窗。

## 代码结构

- `app/lib/franchises.ts`：前后端共用的分类表、边界匹配、联想、动态分类、显式平台匹配、重大新闻识别与时间轴。
- `app/lib/ip-hub.ts`：频道数据投影、交叉筛选和服务端分页；不修改原始游戏身份或发售状态。
- `app/components/ip-components.tsx`：频道目录、频道看板、标签、联想、关注 Feed、通知中心。
- `app/components/ip-provider.tsx`：账号隔离的 React Context；订阅/通知云端状态、串行请求、失败重试、登录引导。
- `app/lib/use-news-feed.ts` / `news-service.ts`：新闻共享读取；多个视图不分别发起相同的客户端抓取；服务端缓存 5 分钟。
- `app/lib/ip-account-api.ts`：鉴权、CSRF、请求大小检查、关注幂等写入、通知去重与已读操作。
- `app/ip.css`：复用现有主题变量的自适应样式；不修改旧弹窗定位规则。
- `db/schema.ts` / `drizzle/0002_calm_katie_power.sql`：只追加两个表，不重写既有迁移。
- `tests/ip-features.test.ts`：分类、多语言、分页、时间精度、鉴权、隔离、通知去重与已读回归。

## API 契约

公共接口无需登录；私人接口始终返回 `Cache-Control: private, no-store`，用户身份只取服务器 session，忽略调用方自报的 userId。

| 方法 / 路径 | 参数或 JSON | 响应 |
| --- | --- | --- |
| `GET /api/ips?q=TotK` | q 可选，最多 120 字 | `items` 系列及游戏/新闻计数、`suggestions` 优先 IP、抓取时间与降级状态 |
| `GET /api/ips/zelda` | `category=latest\|video\|review\|release`、`platform`、`q`、`page` | `ip`、总数、关联游戏、时间轴、12 条/页新闻、来源健康度 |
| `GET /api/subscriptions` | 无 | 账号 IP 状态：`following`、`notifications`、`unread` |
| `PUT /api/subscriptions` | `{ "ipId": "zelda", "following": true }` | 更新后的账号 IP 状态；false 取消关注 |
| `GET /api/notifications` | 无 | 同上；只读，不隐式生成提醒 |
| `POST /api/notifications` | 无请求体 | 读取服务端新闻缓存、生成符合关注时间的提醒，返回状态与 `checkedAt` / `partial` |
| `PATCH /api/notifications` | `{ "ids": ["通知ID"] }` 或 `{ "all": true }` | 账号范围内标记已读，返回更新状态 |

所有私人写操作要求同源 `Origin`、有效 `X-CSRF-Token`（来自已有 `/api/auth/me`），拒绝跨站请求。PUT/PATCH 仅接受 JSON，流式限制 8 KB，单次已读最多 200 个 ID。通知生成每账号每分钟最多 6 次，超限 429；客户端焦点补查至少间隔 1 分钟。未知系列 400，未登录 401，CSRF 失败 403，未知频道 404，服务故障 503。页码必须为正整数，超过末页钳制到末页。

## D1 数据设计

`ip_subscriptions(user_id, ip_id, created_at)`：复合主键 `(user_id, ip_id)`，外键关联 users。重复关注不重置关注时间。各 IP 单独幂等写入，不会以整份旧列表覆盖另一台设备新增的关注。

`ip_notifications(user_id, article_id, article, ip_ids, reason, created_at, read_at)`：复合主键 `(user_id, article_id)`；文章 URL 的 SHA-256 是稳定通知 ID。多 IP 同文与重复抓取不重复通知。已读记录保留；按用户和发布时间建索引。用户删除时外键级联清理。

写入通知时再次检查当前订阅与关注时间，避免取完订阅后用户取消关注造成的竞争。通知只针对关注后发布、非未来、最近 30 天的文章；列表最多返回 200 条，全部已读作用于整个账号。浏览器不缓存私有 IP 状态；按账号 ID 重新挂载，丢弃旧账号异步响应。

## 分类与真实性边界

首批 8 个频道：塞尔达、宝可梦、轨迹、火焰纹章、异度之刃、女神异闻录、最终幻想、药屋少女。入口“热门”是编辑精选，不伪装成用户热度排名。可以直接在 `franchises.ts` 追加稳定 ID、三语名称、明确别名、官方资料链接；新增后前后端与关注校验自动使用同一表。

官方分类资料：

- [塞尔达官方专题](https://www.nintendo.com/jp/character/zelda/index.html)
- [宝可梦游戏列表](https://www.pokemon.co.jp/game/)
- [Falcom 轨迹门户](https://www.falcom.co.jp/kiseki)
- [Fire Emblem World](https://www.nintendo.com/jp/fe/index.html)
- [异度之刃 3 官方网站](https://www.nintendo.com/jp/switch/az3ha/index.html)
- [Persona Channel](https://p-ch.jp/)
- [Final Fantasy Portal](https://jp.finalfantasy.com/)
- [药屋少女游戏官方网站](https://www.gamecity.ne.jp/kusuriyanohitorigoto/jp/)

归类是站内可解释规则，不是发布方提供的结构化 IP 证明：

- 游戏只匹配身份名称，不匹配“像塞尔达”等推荐语和查询扩展词；同 IP 不合并成同一款游戏。
- 新闻按标题/摘要关联，可有多个 IP；卡片注明规则识别。可能漏报或误判，不能保证覆盖全网。
- 英文短词有边界保护；不把单独的 FE、Link、普通英文 trails 或中文“运行轨迹”当成 IP。
- 新闻平台只使用标题和摘要的明确字样，不由发布源或系列反推；因此未知平台不会命中平台筛选。
- 别名新闻检索可扩展至主 IP，界面说明此行为；游戏搜索仍保留现有的作品级检索。
- 视频、评测/攻略、发售变动按标题关键词切分，同文可属于多个分类；仍链接原文，不伪造内嵌视频。
- 重大提醒排除传闻、问句、推测、评测和明显周边；媒体提醒明确标注来源性质，不自动将其写成官方发售日。
- 时间轴沿用目录日期和版本来源；不把“2027 年”“年初”等窗口改造成具体日期。已经过去的计划不在未来时间轴展示。

## 更新机制与后续扩展

当前仍使用已有中日英 8 个新闻源，以及官方直面会/年度目录。网站打开期间每 5 分钟检查新闻和提醒，聚焦窗口/恢复网络时补查。不是 24 小时独立后台抓取，也不发送浏览器推送或邮件。关闭期间可在重开时从当前源窗口补查；源站已淘汰的旧条目可能遗漏。频道新闻计数是当前源窗口总数，不是历史总量。

下一阶段若需要完整历史档案和离线期间不漏提醒，新增受预算约束的 Cloudflare 定时 Worker：先存规范化文章与抓取游标，再以文章事件更新通知；保留当前 API 契约。不要把“刷新间隔”描述成已部署的定时采集系统。

## 验收与部署顺序

1. 运行类型、lint、分类/SQL/回归测试与完整构建；本地检查搜索键盘交互、IP+平台筛选、频道深链、返回、移动宽度和 150% 缩放。
2. 只对 `release-signal-accounts` 应用新增迁移；保持旧服务器兼容。不会更改其他项目数据库。
3. 推送现有 GitHub 项目，部署同一个 Cloudflare Pages 项目，保持公开 `.pages.dev` 地址。
4. 验证公开 API、匿名私人接口 401 与已有登录状态端点；真实账号订阅行为由用户在正式网站操作，不替用户选择关注。

本轮浏览器自动检查连接超时，未完成视觉与真实账号端到端复测，不将其记作通过。已通过类型检查、lint、构建、服务端渲染、分类/SQL 回归和本地 HTTP 接口检查。
