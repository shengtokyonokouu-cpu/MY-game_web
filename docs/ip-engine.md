# 动态 IP 发现与反向扫描引擎

## 实现边界与真实性

这是规则型多语言 NER + Wikidata 实体关系核验，不是大模型，也不需要模型 API Key。命中只是文章关联；不会修改游戏的已核实发售状态、官方名称或评价。

旧系统没有历史正文数据库。首次启动会归档现有 RSS 窗口，此后持续保存。反向扫描覆盖本系统已归档的全部文章，不声称覆盖源站从未抓取的历史网页。

中文、日文、英文及 Wikidata 的 mul 多语言标签均参与匹配。缺失名称不机器猜译，频道显示缺失提示。Wikidata 是可修订的公共知识库，不是厂商官方公告；频道保留实体页、原始命中、父子路径和核验时间，可追溯但不保证零误识别。

## 流程

1. 独立 Cloudflare Worker 每分钟调度，8 个中/日/英来源每 15 分钟进入一次抓取队列。
2. RSS 文章以规范 URL 唯一归档；标题与摘要变化进入增量分析任务。正文使用独立任务抓取，仅访问固定来源域名、不跟随重定向、遵守 robots、超时和体积限制。
3. 从标题和正文抽取书名号/日文引号作品名、标题主体、英文专名及 Project/Codename 代号，每篇最多 16 个候选。平台泛词被排除；重复候选与重复文章去重。
4. Wikidata 搜索只接受精确标签/别名匹配。类型必须是游戏系列，或有明确游戏系列组成关系的跨媒体 IP。单款游戏通过 P179 关联系列；系列通过 P8345 关联主 IP，跨媒体 IP 通过 P527 的游戏系列证明归属。电影、人物、同名词、模糊匹配与多个不一致父级不自动通过。
5. 候选跨别名归并至同一实体 ID。按文章来源发布时间计算滚动 24 小时窗口，至少 **6 篇不同 URL / 2 个来源 ID** 才自动建立新频道。重复抓取、同篇多次提及、多个别名均不叠加文章数。来源 ID 不等于独立报道；转载仍可能存在，此阈值不是新闻真实性认证。
6. 已有频道的核验别名可直接扩充。新频道 ID 为 wd-q…；原来的 8 个种子频道只是启动资料，旧订阅 ID 保留，无频道数量上限。
7. 字典内容变化增加版本并原子入队反向扫描。每批最多 20 篇，以文章自增序号推进，不用 OFFSET；只更新对应 IP，校验文章内容哈希和字典版本，标签写入与游标在同一事务提交。新文章/正文走增量分析。
8. 未解决候选每周重新核验；已知实体定期刷新。词典语义未改变时，核验时间变化不会触发全库重扫。

## 数据模型（迁移 0003）

| 表 | 用途 |
| --- | --- |
| ip_registry | 动态频道、三语名、别名、来源证据、版本、升格时间；实体 ID 唯一 |
| ip_candidates | 原始候选、语言、实体归并、核验状态和证据 |
| ip_candidate_mentions | 候选×文章唯一出现记录，保留发布时间与来源 |
| ip_articles | URL 唯一文章、摘要、正文、内容哈希、正文状态 |
| ip_article_tags | 文章×IP 唯一关联、字典版本、命中证据 |
| ip_jobs | 持久化任务、租约、重试、游标和错误 |
| ip_engine_state | 心跳、来源健康、robots 缓存、刷新进度 |

索引覆盖文章发布时间、实体聚类、候选时间窗口、反向标签、订阅计数及任务就绪/租约查找。没有每篇一个大模型调用，也没有把 CPU 重任务放进网页请求。

## 队列与失败处理

队列在现有 D1 内实现，无需开通付费 Queues。任务领取使用单条 UPDATE … RETURNING 原子抢占，租约 120 秒；过期任务可接管。任务操作幂等，重试指数退避，单轮最多 6 次，耗尽后展示失败状态并在 24 小时后重试。网络失败不会被当成无实体而直接丢弃。

遇到 Wikidata 的 maxlag、限流或临时 5xx，按照 Retry-After 进入跨任务共享冷却期，暂停实体请求但继续新闻归档和补标；状态由健康接口和目录页显示。不会通过移除 maxlag 或绕开限流来强行请求。

每轮最多两个后台任务并发，各类别有固定处理额度，避免正文/实体工作挤占新闻抓取；同名高频候选优先核验。Service Binding 的命名入口仅供账户内调用，没有公开触发写入的 URL。扫描版本过时自动结束，防止覆盖新词典。

正文只用于内部分析，不经公开接口全文分发；当前保留最多 32,000 字符，HTML 下载最多 1 MB。来源拒绝访问/robots 禁止/页面不可读时保留标题与摘要，并记录未完成或 blocked 状态。这里的“全文检索”是对已成功保存的正文扫描，不会绕过登录、付费墙或 robots。

归档没有自动删除策略；D1 的容量与读写配额仍受当前账户套餐限制。当前有单任务、单次下载、并发和重试上限，但不是无限容量服务。部署不会购买套餐或自动升级；数据增长后应查看 Cloudflare 配额并决定归档策略。

## 前端与 API

- GET /api/ips?sort=news|followers|updated&q=…&cursor=0&limit=100：数据库动态频道、统计、搜索建议、分页及引擎状态。
- GET /api/ips/:id：动态频道、目录作品、发售时间轴、当前最多 300 篇归档的筛选与分页，同时返回 archiveTotal。
- GET /api/ip-news?ip=…&cursor=0：每页 100 篇历史归档；nextCursor 可继续遍历，不受 300 条首页窗口限制。
- GET /api/ip-engine：只读健康、归档/候选/任务计数与补扫进度，不暴露用户订阅、正文、密钥或完整内部错误。
- GET /api/news：最近 300 篇归档与权威入库标签。首次归档前可回退实时 RSS。
- 既有 /api/subscriptions、/api/notifications 保留 GitHub 会话、CSRF、账号隔离；接受动态频道 ID。

所有前端分类、搜索建议、游戏标签、新闻标签、关注与通知名称共享 useIPRegistry 数据快照。字典刷新会失效旧匹配缓存；失败时保留上一份词库并显示提示。目录每页 24 个频道，可搜索中日英名称/别名；快捷条显示排序后的前 16 个，完整目录不限制 8 个。

“新识别”是最近 7 天升格；“飙升”需最近 24 小时至少 6 篇，且不少于前一 24 小时的 2 倍。统计是站内已归档/补标数据，不是全网热度。关注度为站内真实关注数，最新更新时间优先使用已关联资讯发布时间。

## 发布与维护

1. 运行类型检查及测试。生成/核对增量迁移；已经应用的 0000–0003 不可重写。
2. npm run db:migrate 应用到现有游戏数据库。
3. npm run engine:deploy 发布 wrangler.engine.jsonc 中的独立定时 Worker；首次 Cron 在 Cloudflare 传播后自行初始化种子和任务。
4. npm run pages:build，沿用现有 Pages 项目发布。域名仍为 release-signal.pages.dev。
5. 核查 /api/ip-engine 心跳、归档数、待处理数；用 wrangler tail --config wrangler.engine.jsonc 看失败原因。不要开放匿名“运行引擎”接口。

手动维护已核验词典时调用服务端 saveFranchise，它把版本更新与扫描入队放在同一事务；不要只直接改 JSON 而绕过版本/扫描。当前没有公开管理员写入入口。

开发可用 npm run engine:dev 和 Wrangler 的 /__scheduled 本地测试入口；默认使用本地 D1，不将本地测试当作线上运行证据。

## 上游技术依据

- [Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API)
- [游戏系列类型 Q7058673](https://www.wikidata.org/wiki/Q7058673)
- [游戏实体属性与 P179](https://www.wikidata.org/wiki/Wikidata:WikiProject_Video_games/Properties)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [服务绑定与 RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Workers 运行与免费套餐限制](https://developers.cloudflare.com/workers/platform/limits/)
