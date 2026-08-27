# 设计增补：L0.5 知识源改为实时拉取 Wikipedia（让她真的去 wiki 学一条）

## 问题
之前 L0.5「每天学 1 条」的内容来自 `StaticKnowledgeSource`：6 条事实的中文摘要由我们**手写固定在代码里**（rank 1-6 硬编码），标着 Wikipedia 的引用 URL 但文本并非来自 wiki。用户指出这是"假的"——光合作用被选中只是因为 rank:1，正文是写死的，她并没有真去 wiki 学。

## 根因（已核对代码）
- `src/knowledge/static-source.ts` 的 docstring 原话即 "curated, citation-backed static source (no network / API key — honest & reproducible offline)"；`rankedCandidates()` 返回硬编码 `FACTS` 数组。
- `DailyKnowledgeTracker.learnOne` 只消费 `KnowledgeSource.rankedCandidates()` 的形状，不关心内容从哪来——所以换一个真实的源、接口一字不改就能让"学的内容"变真。

## 修复（新增真实 Wikipedia 源，接口 0 改动）
新增 `src/knowledge/wikipedia-source.ts: WikipediaKnowledgeSource implements KnowledgeSource`：
- **实时拉取**：调用时通过 zh.wikipedia REST `summary` API（`/api/rest_v1/page/summary/{title}`）取**真实当前 intro 正文** + 规范引用 URL（`content_urls.desktop.page`），不再写死文本。
- **两种模式**（词表已统一为 `"top"` / `"random"`，原 `topics` 重命名为 `top`）：
  - `top`：沿用原 6 个选题（光合作用/热力学第二定律/线粒体/古腾堡印刷术/板块构造/递归），但每条的**正文与 URL 都实时从 wiki 取**；保留 rank 升序与 "top1 学过则 top2" 叙事、按实例去重完全不变。
  - `random`：每轮经 `list=random` 随机取一篇百科，id = `wiki-<规范化标题>`，无限发现；去重仍生效（重复标题自然跳过）。
- **韧性**：单次请求 8s 超时（`AbortController`）；任何失败（网络/非 200/disambiguation/无 extract）跳过该条，tracker 顺延下一条；**全部不可达则当日本轮不学**（下个 idle/天重试），无硬编码兜底文本。
- **可测 / 省流**：`fetchImpl` 可注入（测试用 mock，不触网）；topics 模式带 6h 内存缓存，避免同一天多次 idle 反复刷 wiki。

## 接入点（index.ts 组合根）
- env 可切换：`FAKEREN_KNOWLEDGE_SOURCE=static|wikipedia`（默认 **wikipedia**）、`FAKEREN_KNOWLEDGE_LANG`（默认 zh）、`FAKEREN_KNOWLEDGE_MODE`（`top` | `random`，**不设则由源的 `defaultMode` 决定**）。
- **跨源模式策略（dec_knowledge_mode_policy）**：`KnowledgeSource` 契约新增每源自带的 `defaultMode`；`FAKEREN_KNOWLEDGE_MODE` 作为全局覆盖，不设时各源用自己的默认。
  - **wiki → `random`**（无尽发现，用户明确："wiki这块可以 random"）。
  - **news / social（未来） → `top`**（各源的精选/热门/头条，用户明确："新闻和社交媒体需要top"）。
- 启动打印当前后端：`[golem] L0.5 knowledge source = wikipedia(zh/random)`。
- `DailyKnowledgeTracker` / `L05Trajectory` / `seedCandidates` **一行未改**——印证 `KnowledgeSource` 契约稳定。

## 预期行为（已端到端验证）
- dsh idle 触发 `l05.tick` → 真实联网取「光合作用」等**当前正文** + **真实引用 URL**（实跑确认：取到 zh.wikipedia 实时 intro，非手写文本）。
- 学到的事实经既有 L0.5 drift 种子池渗漏，且 `schedulerLog.learn` 记录"学了什么"（可观察）。
- **默认 wiki=random**：不设 env 即无尽发现；若要精选 6 题请用 `FAKEREN_KNOWLEDGE_MODE=top`。

## 业务层测试
`tests/wikipedia-source.test.ts`（mock fetch，不触网）：
- top：实时取回 + 按 rank 升序 + 真实 URL；
- top 单条失败跳过、其余保留；全失败返回 `[]`；
- random：单条 rank1 + `wiki-<slug>` id；无法解析返回 `[]`；
- **默认模式 = random**（`new WikipediaKnowledgeSource()` 不传 mode 即走 random）；`StaticKnowledgeSource.defaultMode === "top"`。
全量测试 122 passed（含原本 static 用例保留）。

## 影响面
仅新增 `src/knowledge/wikipedia-source.ts` + 改 `src/index.ts` 接入（保留 static 作可切换回退）。可整体回滚到 `FAKEREN_KNOWLEDGE_SOURCE=static`。
