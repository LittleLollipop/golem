# ADD-l05-model-driven-learning

> 把 L0.5「每天学 1 条」升级为 **双轨**：**1 条随机（保留现有机制，与模型解耦）+ 1 条目的性（模型读图库后规划）**。
> 状态：**已实现**（测试 145 全绿 / typecheck / build / verify-prestep 通过；待图库回流 + 提交）。本档已与代码对齐。

---

## 1. 背景 / 动机

### 1.1 现有机械盲选的问题
当前 `DailyKnowledgeTracker.learnOne` 只是 `source.rankedCandidates()[0]` 挑第一个没学过的，完全不读图库、不调模型。学到什么与她的世界（图库）无关，渗漏进 drift 也只是随机噪声。

### 1.2 纯目的性选学会极化（本次修正的核心）
若改成「完全由模型按图库选学」，**会把学习锁死在「用户近期聊过的」话题里**——等价于建了一座回音壁：
- **高耦合**：学的内容永远围绕既有对话，与用户兴趣强绑定；
- **极化**：长期只强化已有兴趣，失去广度与偶然发现的惊喜，人格底色越走越窄。

### 1.3 双轨制：保留随机作「抗极化保险」
用户决策（原话）：**「随机的学习也需要保留……完全有目的选择可能会导致高耦合度或者极化的发展方向，所以每天学习的内容变成两条，一条是现有这个随机的，一条是有目的性的」**。

- **随机轨（random）**：保留现有机制（wiki random），**完全不调模型、不读图库**——保证广度、偶然性、抗回音壁。这是 serendipity 引擎，与目的轨解耦。
- **目的轨（purposeful）**：模型读该实例图库（近期实体/话题 + 已学清单）→ 规划「今天学什么 / 怎么学」。提供相关性、人格连贯。

两轨互补：随机防极化，目的给方向。

---

## 2. 目标 / 非目标

**目标**
- 每日每实例学习 **2 条**：`random` 1 条（机械，保留）+ `purposeful` 1 条（模型驱动）。
- 目的轨：模型读图 → 规划 → 指令驱动源（支持聚焦检索 / 主题过滤）。
- 两条均进**同一去重账本**与 drift 种子池；`LearnedFact` 标记 `kind` 区分来源，便于观察/审计。
- **优雅降级**：无 LLM / 图空 / 模型非法 → 目的轨退回机械默认，随机轨不受影响。

**非目标**
- 不改随机轨的机制（仍是 wiki random，纯机械）；
- 不改 `KnowledgeCandidate` 形状与下游 drift/recall；
- 不引入第二个模型（复用宿主 `LlmClient`）；
- 不改「每实例」「每日配额」的硬约束（只是从 1 条/日 → 2 条/日，分两槽）。

---

## 3. 架构变更

### 3.1 新增类型（`src/knowledge/types.ts`）

```ts
export type LearnKind = "random" | "purposeful";
export type LearnStatus = "learned" | "empty" | "junk" | "error";

/** 模型产出的选学指令（仅作用于目的轨） */
export interface LearningDirective {
  source: KnowledgeBackend;  // 类型含 wiki/news/social/web/static；planner 实际只放行前四（全开放），static 仅作注册表兜底
  mode?: "top" | "random";
  query?: string;           // web/wiki-search 的检索词；新闻/社媒的关键词过滤
  rationale: string;        // 进 selectionPath，可审计
}

export interface LearningContext {
  instanceId: string;
  date: string;
  recentTopics: string[];   // 图库近期实体/话题
  learnedTitles: string[];  // 已学清单（去重 + 暴露缺口）
  graphNodeCount: number;
}
```

`LearnedFact` 增字段：把「学到的事实」升格为「学习记录」，**状态是一等公民**：
```ts
export interface LearnedFact {
  // ...既有候选字段（id/title/summary/sourceUrl/rank/selectionPath）不变...
  kind: LearnKind;                              // "random" | "purposeful"
  status: LearnStatus;                         // 关键：learned/empty/junk/error
  directive?: { source: string; query?: string; rationale: string }; // 仅 purposeful 有
  statusNote?: string;                         // 状态附注，如 "检索返回 0 条" / "结果疑似广告已丢弃" / "源超时"
}
```
- `status==="learned"`：内容字段有效，进 drift 种子池、可渗漏。
- `status==="empty"|"junk"|"error"`：内容字段为空占位，**仅作状态记录**，不进 drift、不产生渗漏；`statusNote` 记原因。目的轨当天记一条即结束，**不回退默认内容**（拉空/垃圾/异常本身就是合法结果）。

### 3.2 `KnowledgeSource` 契约扩展（向后兼容）

```ts
rankedCandidates(directive?: LearningDirective): Promise<KnowledgeCandidate[]>;
```
所有源加 `directive?` 形参；为空时行为完全等同现在。

### 3.3 新增 `KnowledgeSourceRegistry`（`src/knowledge/registry.ts`）
实例化全部源（wiki/news/social/web/static），按 backend 名索引；仅被选中时才发生 IO。

### 3.4 新增 `LearningPlanner`（`src/knowledge/planner.ts`，**仅服务目的轨**）

```ts
class LearningPlanner {
  constructor(llm: LlmClient, store: GraphStore, opts: {
    recentLearnedTitles: (instanceId: string) => string[]; // 由 tracker 注入，避免循环依赖
    pinSource?: string;                                    // FAKEREN_KNOWLEDGE_SOURCE（锁渠道不锁模型）
  });
  async plan(instanceId): Promise<LearningDirective | null>; // null→目的轨记 empty
}
```
- `buildContext()`：`store.query({instanceId,limit:30})` 抽 `recentTopics`（取 label，去空，截 20）；`opts.recentLearnedTitles(instanceId)` 取 `learnedTitles`（截 15）；`store.stats(instanceId)` 取 `graphNodeCount`（best-effort）。
- `recentTopics` 空 → 返 `null`（目的轨记 empty，不兜底）。
- 调 `llm.complete`（同宿主模型，无第二模型）要求输出 JSON（含 `source/mode?/query?/rationale`）；`stripFence`+`JSON.parse`+校验；`source` 不在放行清单 `wiki/news/social/web` → `null`；`mode` 非 random 归一为 `top`；`rationale` 空串也接受。模型异常 / 非法 JSON → `null`。
- `opts.pinSource`（env 直连）→ 覆盖 `directive.source`（经 `normalize`：`news-rss→news`、`social-hn→social`、未知→wiki），但 `query/mode` 仍由模型定。

### 3.5 `DailyKnowledgeTracker`：双槽（`ensureToday`）

```ts
constructor(
  private readonly randomSource: KnowledgeSource,   // 固定 wiki random（抗极化引擎）
  private readonly sources: KnowledgeSourceRegistry, // 目的轨候选源
  private readonly dir: string,
  private readonly planner?: LearningPlanner,
  private readonly now: NowFn = () => new Date(),
);

async ensureToday(instanceId): Promise<{ random?: LearnedFact; purposeful?: LearnedFact }> {
  const today = this.today();
  const st = this.load(instanceId);
  const out = {};
  // ── 槽 1：随机（机械，不读图/不调模型，且绝不传 directive）──
  if (st.randomDoneDate !== today) {
    const c = await this.randomSource.rankedCandidates(); // 无参 = 完全走现有 wiki random 路径
    const chosen = firstNotLearned(c, st.learnedIds);
    out.random = chosen
      ? this.persist(st, chosen, "random", "learned", today)
      : this.persistStatus(st, "random", "empty", today, null, "无新随机内容");
    st.randomDoneDate = today; // 当日一闸，无论学到与否都记一条
  }
  // ── 槽 2：目的（模型驱动；无 planner/空图→记 empty 状态，不兜底默认）──
  if (st.purposefulDoneDate !== today) {
    const directive = this.planner ? await this.planner.plan(instanceId) : null;
    let rec!: LearnedFact;
    if (!directive) {
      // 无模型规划 / 空图 / 模型非法 → 记 empty，不调源、不兜底默认内容
      rec = this.persistStatus(st, "purposeful", "empty", today, null,
        this.planner ? "规划未产出指令（图库为空 / 模型无法判断）" : "无模型规划，目的轨跳过");
    } else {
      const backend = directive.source; // planner 已归一为 wiki/news/social/web
      try {
        const c = await this.sources.get(backend).rankedCandidates(directive);
        const good = this.qualityGate(c);          // 过滤广告/垃圾
        const chosen = firstNotLearned(good, st.learnedIds);
        if (chosen) rec = this.persist(st, chosen, "purposeful", "learned", today, directive);
        else if (c.length === 0) rec = this.persistStatus(st, "purposeful", "empty", today, directive, "检索返回 0 条");
        else rec = this.persistStatus(st, "purposeful", "junk", today, directive, "结果均疑似广告/垃圾，已丢弃");
      } catch (e) {
        rec = this.persistStatus(st, "purposeful", "error", today, directive, `源异常: ${(e as Error).message}`);
      }
    }
    out.purposeful = rec;
    st.purposefulDoneDate = today; // 当日一闸：学到/拉空/垃圾/异常 都只记一条状态
  }
  this.save(st);
  return out;
}
```
- `qualityGate(candidates)`：轻量质量闸（可配置），过滤广告/垃圾域名、过短占位摘要、标题-正文明显不匹配等；**仅用于决定 `junk` vs `learned`，不篡改内容**。
- `TrackerState` 增 `randomDoneDate` / `purposefulDoneDate`（各自每日一闸）；`learnedIds` 跨槽共享去重（仅 `status==="learned"` 时累加，用于避免重复渗漏）。
- 随机槽固定 `WikipediaKnowledgeSource({ mode:"random", lang })`——**与 env 直连 / 模型选择解耦**，保证每日必有 serendipity（机械源极少 `empty`/`error`）。
- 目的槽：无论 `learned/empty/junk/error` 都**只记一条状态**、当日结束；**绝不回退到 top/random 默认内容**——目的轨的「空」是合法结果，稀释它反而破坏目的性。
- 仅 `status==="learned"` 的记录进 `seedCandidates` 的 drift 种子池。

### 3.6 `L05Trajectory` 注入

```ts
new L05Trajectory(knowledgeTracker, 7, schedulerLog, llm, reader);
//                                          ↑ 可选 llm+reader，用于构造 planner
```
`tick(instanceId)` 改调 `ensureToday`，把 `random`/`purposeful` 两条都 `log.learn`，并都进 `seedCandidates` 的 drift 种子（建议把 `seedCandidates` 默认 `limit` 从 2 提到 3~4，给 drift 更近的素材）。

---

## 4. 源侧扩展（支撑 `directive.query`，目的轨用）

| 源 | 现有 | 新增（按 `directive.query`） |
|---|---|---|
| Wikipedia | topics / random | `search(query)`：Wikipedia `query` API 取匹配条目 → `summary` 正文；无 query 则退回默认 |
| NewsRss | feeds → recency | `query` 非空：标题/摘要关键词过滤后再排序 |
| SocialTrending | HN 热榜 | `query` 非空：标题/正文过滤后再排序 |
| **WebSearch（新增）** | — | 模型给 `query`，经可插拔搜索引擎后端取 top 结果 → `title`+`snippet`+`url` 作为候选；后端默认 keyless（DuckDuckGo HTML/lite），`FAKEREN_SEARCH_PROVIDER`/`FAKEREN_SEARCH_ENDPOINT` 可换 |
| Static | 6 条写死 | 忽略 `directive`（保底机械源） |

随机槽只用 wikipedia random，**不传 directive** → 完全走现有路径。目的轨四源全开放，`web` 即「模型自己用搜索引擎搜」——满足「有目的的学习时用搜索引擎自己搜都可接受」。

> 所有目的轨候选经 `qualityGate` 过滤（广告/垃圾域名、过短占位、标题-正文不匹配 → 判 `junk`），**只决定状态、不篡改内容**。

---

## 5. 状态矩阵（不兜底，只记录）

目的轨**不回退默认内容**；任何结果都落为一条带 `status` 的记录。下表是各情形对应的 `status`：

| 情形 | 随机槽 `status` | 目的槽 `status` |
|---|---|---|
| 正常取到好内容 | `learned` | `learned`（内容进 drift 种子） |
| 无 `llm`（无 key）→ planner 不建 | `learned`（机械 wiki random） | `empty`（`statusNote: "无模型规划，目的轨跳过"`，不兜底） |
| 有 `llm` 但图空 / topics 空 | `learned` | `empty`（`statusNote: "图库无近期话题"`） |
| 模型返非法 JSON | `learned` | `empty`（`statusNote: "规划 JSON 非法"`） |
| 目的源返回 0 条 | `learned` | `empty`（`statusNote: "检索返回 0 条"`） |
| 目的源返回但全是广告/垃圾 | `learned` | `junk`（`statusNote: "结果均疑似广告/垃圾，已丢弃"`） |
| 目的源挂了 / 超时 | `learned` | `error`（`statusNote: "源异常: ..."`） |
| `FAKEREN_KNOWLEDGE_SOURCE=news` 硬约束 | **随机槽不受影响**（始终是 wiki random） | `directive.source` 被覆盖为 news；`query`/`mode` 仍由模型定；后续按上表出 `learned/empty/junk/error` |

> 关键不变量：
> 1. **随机槽永不依赖模型/图库**——每日必有 1 条 serendipity，从结构上抗极化。
> 2. **目的轨永不以默认内容稀释**——`empty`/`junk`/`error` 是合法状态记录，当天到此为止。
> 3. 仅 `status==="learned"` 的内容进 drift 渗漏；状态记录本身只进 `schedulerLog` 与落盘，供审计/观察。

---

## 6. 可观察性（状态一等公民）

- `LearnedFact` 记录 `kind` + `status` + `statusNote`；`selectionPath`：
  - random：`选随机 (rank ${rank}, 来源 ${source})` → 通常 `learned`
  - purposeful：`模型规划: ${directive.rationale} (source=${source}, query=${query??"-"})` → 据实 `learned/empty/junk/error`
- **状态即信息**：`empty`/`junk`/`error` 也落盘并写入 `schedulerLog.learn`（带 `status` + `statusNote`），便于审计「今天目的轨为什么没学到东西」——这是设计要捕捉的元数据，而非失败。
- 启动日志：`[fakeren] L0.5 = dual-track (random: wikipedia/random + purposeful: <有 LLM 时 model-planned[wiki/news/social/web] / 无 LLM 时 no-LLM → 记 empty 状态>)`。无 LLM 时目的轨每 idle 稳定记一条 `empty`（不兜底、不调源），随机轨照常 serendipity。

---

## 7. 测试（mock，不触网）

`tests/model-driven-learning.test.ts`：
- `ensureToday`：当日返回 `random` + `purposeful` 两条；`kind` 正确；
- 随机槽：mock wiki 源、`rankedCandidates` 被以 `{mode:"random"}` 调用、**未传 directive.query**；正常 → `status="learned"`；源抛错 → `status="error"` 仍记一条；
- 目的槽：mock `reader` 返近期实体 + mock `llm` 返合规 JSON → 断言 `directive.source/query/rationale` 透传到 `LearnedFact.directive` 且 `status="learned"`；
- `plan()` 图空 / 模型非法 JSON（均返 `null`）→ 目的槽 `status="empty"`（`statusNote` 含「图库」，如「规划未产出指令（图库为空 / 模型无法判断）」），**不兜底、不调源**；
- 无 LLM（planner 未建）→ 目的槽 `status="empty"`（`statusNote:"无模型规划，目的轨跳过"`）；
- 目的源返回 0 条 → `status="empty"`（`statusNote:"检索返回 0 条"`），**当天目的槽结束、不回退默认**；
- 目的源返回但 `qualityGate` 全判 `junk` → `status="junk"`（`statusNote:"结果均疑似广告/垃圾，已丢弃"`）；
- 目的源抛错 → `status="error"`（`statusNote` 含异常信息）；
- `FAKEREN_KNOWLEDGE_SOURCE=news` → 随机槽仍是 wiki random；目的槽 `directive.source` 被覆盖为 news，后续按状态矩阵出结果；
- 仅 `status="learned"` 的目的记录进 `seedCandidates`；`empty/junk/error` 不进；
- 去重：两天连续 idle，第二天两槽都不再触发（`randomDoneDate`/`purposefulDoneDate` 每日闸）；
- 既有 `daily-tracker.test.ts` 改测 `ensureToday` 双槽语义（原 `learnOne` 单槽用例相应调整）。

---

## 8. 风险 / 边界

1. **极化（已根治）**：随机槽与模型/图库完全解耦，每日必有 serendipity，从结构上杜绝回音壁。这是本设计相对「纯目的性」的根本改进。
2. **隐私**：目的轨的图库话题 + 已学清单随 prompt 发往宿主 LLM（DeepSeek），与现有 extractor/valence/grader 口径一致（无第二模型）；`SYSTEM` 只放实体标签/标题，不放大段原文。
3. **成本**：每实例每 idle 至多 **1 次** LLM 调用（仅目的轨）+ 1 次图查询；随机槽零调用。开销可忽略。
4. **模型不编造知识**：`rationale` 仅作展示/审计，内容仍来自真实源真实拉取，模型只定「方向」。
5. **冷启动**：新实例图空 → 目的轨记 `empty` 状态（不兜底内容），随对话积累自然切模型驱动；随机轨始终有效。

---

## 9. 决策记录（评审点已闭合）

- **A. 目的轨可选源范围 —— 已定：全开放**。模型可在 `wiki` / `news` / `social` / `web` 四源间自由选；`web` = 模型自己用搜索引擎搜（满足「有目的的学习时用搜索引擎自己搜都可接受」）。随机轨固定 wiki random，不受影响。
- **B. 运维手动锁源语义 —— 已定：选项 1（锁渠道、不锁模型）**。设 `FAKEREN_KNOWLEDGE_SOURCE=news` 时，目的轨 `directive.source` 被覆盖为 news，但 `query`/`mode`/具体话题仍由模型看图库决定；随机轨恒定 wiki random 不受影响。不设该变量则全开放、模型自由选。
- **C. 检索拉空/垃圾/异常的处理 —— 已定：抽象状态模型，不兜底**。用户原话：「拉空了也是一种结果，拉回来各种广告和垃圾也是一种结果，我们需要记录的除了学到的内容之外还有相关的状态，如果没有信息那就是单纯的状态嘛」。故目的轨引入 `status: learned|empty|junk|error`：
  - `empty` = 检索返回 0 条 / 图空 / 模型规划失败；
  - `junk` = 返回结果经 `qualityGate` 全判广告垃圾；
  - `error` = 源异常/超时；
  - 三者均**只记一条状态、当天结束、绝不回退默认内容**；仅 `learned` 进 drift 渗漏。状态本身即审计信息。

---

## 10. 实现步骤（评审通过后）

1. `types.ts`：加 `LearnKind` / `LearningDirective`（含 `web`）/ `LearningContext`；`rankedCandidates(directive?)`；`LearnedFact.kind` + `directive?`。
2. 五源各加 `directive?` 形参：wiki `search(query)`、news/social 关键词过滤、web `WebSearchKnowledgeSource`（可插拔后端，默认 keyless DDG）、static 忽略（随机槽不传 directive）。
3. `registry.ts`：多源注册表（含 web）。
4. `planner.ts`：`LearningPlanner`（读图 + 调模型 + 校验），`source` 可选四源，仅服务目的轨。
5. `daily-tracker.ts`：`ensureToday` 双槽（见 §3.5）；`TrackerState` 增 `randomDoneDate`/`purposefulDoneDate`；随机源固定 wiki random；`LearnedFact` 写入 `kind`/`status`/`directive?`/`statusNote?`；新增 `qualityGate(candidates)` 轻量质量闸（广告/垃圾→`junk`）；仅 `status==="learned"` 进 `seedCandidates`。
6. `l05-trajectory.ts` / `index.ts`：注入 `llm`+`reader`；`tick` 调 `ensureToday`；`seedCandidates` limit 提到 3~4；启动日志。
7. 测试 + typecheck + build + verify-prestep；真实联网冒烟（目的轨是否真按图选相关主题含 web 搜索、随机轨是否仍 serendipity）。
8. 设计定稿 + 图库回流：新增节点 `dec_l05_dual_track`（随机抗极化 + 目的给方向）、`dec_l05_abstract_status`（空/垃圾/异常只记状态不兜底）、`fn_learning_planner`、`fn_knowledge_registry`、`fn_web_search_source`、`fn_quality_gate`；并连边到既有需求节点 `req_l05_knowledge_trajectory`（及 dual-track / abstract-status 两条子需求），形成「需求 → 决策 → 函数」追溯链。
