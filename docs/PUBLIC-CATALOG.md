# 公共目录与账号数据分离（2026-09）

Cloudflare 仅负责站点、GitHub 登录和账号私有记录。`release-signal-ip-engine` 的 Durable Object alarm 已暂停，部署配置 `IP_ENGINE_ENABLED=false`，Cron 为空。不要运行旧的 start/bootstrap 调度流程：它会消耗 D1 读写额度。旧数据库历史不删除、不改已应用迁移。

## 更新与发布

- GitHub Actions 标准 Linux runner：公开仓库的标准 runner 适用免费政策；不创建付费 runner。
- 每 3 小时聚合中日英 RSS；每天更新当年/次年的发行清单和部分图片；每周重建系列实体图。计划任务可能被 GitHub 延迟，不是秒级实时新闻。
- 每阶段请求预算、18–60 秒超时、有限并发；禁止无限重试。新闻最多保留 6,000 篇。整批通过校验才提交，失败继续使用上次成功数据。
- `codex/catalog-data` 分支保存 `v1/` 公共 JSON；浏览器直接读取该分支，不携带账号 Cookie。失败回退 `/data/` 的随站快照。公共刷新不触发 D1 全库扫描。
- `.github/workflows/public-catalog.yml` 必须存在于默认分支，schedule 才生效；工作代码从 `agent/light-dynamic-games` 检出。手动运行可选择全量重建。
- 首次执行 `npm run data:bootstrap`；日常 `npm run data:refresh`；仅平台与图片 `node scripts/refresh-public-data.mjs --platforms --assets`；验收 `npm run data:validate`。
- 每周重新读取系列关系后，对保留的历史新闻全量重新标注。图片缓存 `artwork.json` 跨全量重建保留，避免每周只补齐第一批作品。

## 身份、层级与覆盖边界

自动种子来自 Wikidata 游戏—系列关系，不是 8 项白名单，也不要求先有新闻热度。结合 P179、P361、P527、P8345 建立系列图、父子关系和主频道；至少两个已发行的非重制/合集记录作为候选依据。明确的 P144 + P2868 重制限定用于补录版本，不能用普通“改编自”推断系列归属。专题频道可保留，但不宣称满足双作品门槛。

名称按实体 ID 对齐中日英标签/别名，不生成不存在的官方译名。普通词（如 kingdom、mana、atelier）不能单独证明归属。官方子系列身份桥接位于 `app/data/official-subseries.json`；能够修复知识库中缺少 P179 的作品，保留官方证据链接。搜索专用作品别名与新闻归类词库分开。

本轮是**广覆盖的公开索引，不是全球所有 IP 的官方完整作品数据库**。知识库仍可能缺作品、误分类 DLC/移植、缺地区日期；页面标注未逐项核验，数量不能当成官方作品总数。日期保持源精度，“待复核”不展示为确定的未来发售。Nintendo Direct、PS Blog、Xbox Wire 补充官方新动态；历史目录跨旧主机，不能声称已抓完 NS/PS/Xbox 商店。

## 角色与图片

P674 仅证明作品记录了角色，不能推断主角。主要角色的官方介绍及图片在 `official-cast.json`，按具体作品完整名称 / 实体 ID 关联；不把重制版图片伪装为原作版本。角色小窗格按需载入，区分“主要角色 / 出场角色”，提供出处、介绍和图片失败状态。无可靠关联显示待补充，不生成或用演员照片代替。

现有数千条角色关联并不意味着所有作品都有主要角色图片。版权仍归原权利人，Wikidata 结构化元数据的 CC0 不覆盖游戏美术；官方图片使用外链并提供来源。

## 验证

`tests/public-series.test.ts` 覆盖七个代表系列的初代年份、亚兰德/不可思议归属、双作品检验、普通词误匹配、星之海洋2R的重制关系和网页样式污染。`validate-public-data.mjs` 校验全量频道、父子链接、新闻标签、角色来源、日期格式及目录骤减。

免费额度参考：[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)、[GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。账号请求、主动在线搜索与缺图解析仍使用 Cloudflare；新方案不是整个网站零额度消耗。
