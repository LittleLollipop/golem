# 设计增补：L0.5 新增 News(RSS) 与 Social(HN 热榜) 知识源，默认 top

## 背景
`dec_knowledge_mode_policy` 已定跨源模式策略：**wiki → random，新闻/社交媒体 → top**。
上次只把 wiki 实现为 random。本次补齐 news / social 两个 `KnowledgeSource` 实现，二者
`defaultMode = "top"`，沿 `KnowledgeSource` 契约接入，下游 `DailyKnowledgeTracker` / `L05Trajectory`
**一行未改**。

## 实现
### `src/knowledge/news-rss-source.ts` — NewsRssKnowledgeSource
- 真实拉取 RSS/Atom feed（`fetchText` + `fast-xml-parser` 解析 `<item>`/`<entry>`），按发布时间
  **recency 降序**排名（= "top"）。
- 默认 feed 用 BBC（zh→`zhongwen/simp`、en→`news`），公开、免 key、免 CORS；经
  `feeds` / `FAKEREN_NEWS_FEEDS` 可覆盖。
- 文本清洗：`stripHtml` 去标签 + `decodeEntities` 解 `&amp;`/`&#x..;`；摘要截断 280 字；
  标题/链接/描述按 RSS、Atom（`<link href>`/数组 rel=pick）分别归一；URL 做去重。
- 稳定 id：`news-<djb2(url)>` 保证跨天去重。
- 韧性：单 feed 失败跳过；全失败返回 `[]`（当日不学，无伪造文本）；`fetchImpl` 可注入（测试不触网）。

### `src/knowledge/social-trending-source.ts` — SocialTrendingKnowledgeSource
- 拉取 Hacker News 热榜（Algolia keyless JSON：`tags=front_page`），作为"社媒热榜"骨架；
  `endpoint` / `FAKEREN_SOCIAL_ENDPOINT` 可换子版块或别的 keyless 热榜 API。
- 每条：id=`social-hn-<objectID>`、标题、摘要含 `分数 · 评论数 · @作者`、引用 URL（无 url 则回退
  HN item 页）。默认 `top`（API 顺序/热度），`random` 则 shuffle。

### 共享 `src/knowledge/http.ts`
- `fetchJson` / `fetchText`（AbortController 8s 超时、非 200/异常 → `null`，软失败）+ `shuffle`。
- 与 wiki 源一致的软失败语义。

### 接入 `src/index.ts`
- `FAKEREN_KNOWLEDGE_SOURCE` 扩展：`static | wikipedia(默认) | news | news-rss | social | social-hn`。
- `FAKEREN_KNOWLEDGE_MODE`（top/random）作为全局覆盖，不设时各源用自己的 `defaultMode`。
- 启动日志：`[golem] L0.5 knowledge source = <backend>/<effectiveMode>`。

## 验证（真数据 + 测试）
- 真实联网冒烟：新闻取到 BBC 中文 10 条实时头条 + 真 URL；社媒取到 HN 30 条热榜（含分数/评论/作者）。
- 测试：`tests/news-rss-source.test.ts`（7）、`tests/social-trending-source.test.ts`（4），mock fetch 不触网，
  覆盖 RSS/Atom 解析、去 HTML/实体、recency 排序、单 feed 失败跳过、全失败 `[]`、去重、random、defaultMode。
- 全量 **133 passed**；typecheck / build / verify-prestep 全绿。
- 依赖：`fast-xml-parser@5` 加入 `package.json`（RSS 解析）。

## 影响面 / 注意
- 仅新增 3 文件（http/news/social 源）+ 改 `index.ts` 接入；`KnowledgeSource` 契约未变。
- 新闻默认 BBC；生产可换成本地/中文新闻源（覆盖 `feeds`）。
- 社媒当前用 HN 作热榜骨架；Reddit/Mastodon 等可按同契约后续接入（默认均 `top`）。
- 环境提示：`@deepseek-ai/dsh-llm` 为 dsh 运行时 SDK，不在本项目 package.json 中，由部署环境提供；
  本沙箱曾因 `npm install` 被剪枝，已 `--no-save` 恢复。CI 若 pristine `npm ci` 需确保该 SDK 在场。
