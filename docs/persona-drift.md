# 假人性格漂移（Persona Drift）设计文档 v0.1

> 状态：已实现（v0.4.0，2026-08-30 落地；未发 release）
> 日期：2026-08-30
> 目标：让假人通过**每日一次的内省任务**，基于近期记忆与对话自动调整「性格方向」，日积月累形成性格缓慢漂移。

---

## 1. 目标与非目标

### 目标

性格漂移的设计有两条并列的根本目的：

1. **逼近真实人格的不恒定感**——以缓慢、可控的漂移取代"人设一旦设定永不改变"的塑料感；
2. **让假人在长期交互中自然涌现"最契合用户"的性格**——漂移并非随机游走，而是持续以用户的近期交互历史为信号微调；用户与之相处得越频繁、越真实，它越能收敛到一个最贴合该用户实际偏好的性格形态，而无需用户在初始化时一次性精确设定人设。

具体实现目标：

1. 每日（跨日后首次 idle）自动执行一次内省任务：读取近期记忆 + 对话 → LLM 分析 → 产出当日「性格方向」。
2. 性格方向以**结构化维度偏移**表示，可与 base persona 合成后注入模型。
3. 每日方向持久化成链，可回溯「这个假人是怎么变成今天这样的」，可回退到任意一天。
4. 长期累积形成自然漂移——不突变，但数周后与初始设定明显不同。

### 非目标
- **不做真定时**（wall-clock cron）。见 §4 触发机制的取舍。
- **不覆写 base persona**。base 永久不动，见 §3。
- **不做多假人间的性格传染**（跨实例影响）。每实例独立漂移。
- 不追求「性格立刻生效」——persona 每 session 只注入一次，新性格在下一次会话生效。

---

## 2. 现状核查（已实测，非推断）

结论基于直接读取 `~/.fakeren/instances/ysj.axeb` 真实图数据与源码核对。

| 项 | 实测结论 | 证据 |
|---|---|---|
| persona 存储 | 单一字符串，存 axolotl 图 `__meta__` 顶点 | `sidecar/server.py:125-143`（`set_meta` → `meta_json`） |
| persona 注入 | 压成 `channel="persona"` 块，**每 session 仅注入一次** | `golem-agent.ts:96-105` 生成；`dsh-seams.ts:198-210` 用 `personaSeen` Set 去重 |
| persona 演进 | **无任何动态机制**，仅 UI/CLI 可改 | 全库无程序化写 persona 的代码 |
| 调度器 | **不存在**，只有 idle 事件驱动 | `dsh-seams.ts:273-279` 监听 `agent/status==="idle"` |
| 日历日去重 | 已有现成范式 | `daily-tracker.ts:65-68`（`today()`）+ `:136/:155` 的 `randomDoneDate/purposefulDoneDate` |
| 非回合 LLM 调用 | 成熟，有可复制模板 | `knowledge/planner.ts:90-99` `callModel`；`llm/client.ts:15-18` 直连 OpenAI 兼容端点 |
| **对话数据完整性** | ✅ **已有全量多轮对话，无需补齐** | 图内 14 个 Event 节点完整覆盖 08-29 11:03→21:51 每一轮 |
| 时间范围查询 | **不存在**，需宽拉后 TS 侧过滤 | `QuerySpec`（`graph-store.ts:21-29`）无时间字段；`_match`（`server.py:158-175`）不比时间 |

### 2.1 关于「对话是否全量」的澄清

`syncLatestTurn`（`golem-agent.ts:176-193`）单次调用只取最后一条 user + 最后一条 assistant，曾被认为「只存每会话最后一轮」。**实际不是**——它在 `index.ts:231` 的 idle 回调中**每轮都被调用一次**，因此每轮的「最后一轮」累积成完整对话。

实测数据（`ysj` 实例，60 顶点 / 183 边，其中 Event 14 个）：

```
[08-29 11:03] 你是谁
[08-29 11:03] 能帮我看看今天有什么值得关注的新闻吗
[08-29 11:39] 有什么好玩的事情可以分享吗
[08-29 12:08] 你是不是很擅长写作啊? 能跟我讲一些写作技巧吗?
[08-29 18:38] 我想用钟无艳写一本女频 重生 复仇 的 大女主小说, 你觉得应该怎么写
[08-29 20:21] 还记得你给我的小说梗概吗, 我感觉很不错
[08-29 20:23] 不, 不是这个, 我说的是钟无艳的故事梗概
[08-29 20:26] 你知道写故事的节拍吗? ...
[08-29 20:30] 节拍不是还有 救猫咪 故事圈 七点 弗莱塔格 之类的吗? ...
[08-29 21:51] 你可以帮我给 卷一·不嫁  写个大纲吗
```

每个 Event 节点均含 `props.userText` / `props.assistantText` / `props.assistantSummary`。

### 2.2 已发现的数据质量问题（设计必须处理）

1. **`assistantText` 被 thinking 污染**：实测存储的是模型思考链而非实际回复，例如
   `"The user is roleplaying/asking me to be a character named 遗思静 (Yi Sijing), a 25-year-old n..."`
   → 直接喂给 LLM 会严重污染性格判断。**内省任务应优先取 `assistantSummary`**。
2. **`system-reminder` 混入对话**：12:17 与 18:28 两个节点的 `userText` 是 `<system-reminder>` 工作区指令，非真实用户对话 → 需过滤。
3. **存在手工种植的测试节点**：21:46 的「卷一·不嫁」节点 props 仅含 `kind` + `userText`，无 `assistantText`，属调试残留 → 需按字段完整性过滤。

---

## 3. 架构：分层 persona

**核心判断：绝不直接覆写 persona 全文。** 若每日让 LLM 重写整段 persona，模型倾向于每次「优化」，累积数日后人设崩坏且不可回滚。改为三层：

```
base persona（锚 · 用户设定 · 永久不变）
        │
        ├──────────────┐
        ▼              ▼
   drift 累积层      （合成）
   每日叠加          │
   clamp ±1          │
        └────────────┤
                     ▼
            effective persona  →  注入模型
```

| 层 | 内容 | 可变性 |
|---|---|---|
| **base persona** | 用户设定的原始人格全文 | 永久不变（唯一真相锚） |
| **drift 累积层** | 每日产出的结构化偏移，带 clamp | 每日可调，受护栏约束 |
| **effective persona** | base + drift 合成后的实际注入文本 | 每次 assemble 时实时合成 |

### 3.1 为什么用「维度偏移」而非自由文本

「性格方向」必须是**结构化维度偏移**，不能是自由文本段落。理由：
- 自由文本**不可累积**（无法把两段文字相加）、**不可 clamp**、**不可比**（画不出漂移曲线）、且**易被一次改写冲掉**。
- 维度偏移可数值累积、可设上下限、可画出时间序列、可回退。

---

## 4. 触发机制：跨日后首次 idle

### 4.1 取舍

| 方案 | 评价 |
|---|---|
| **跨日后首次 idle（选定）** | 复用 `daily-tracker` 日历日闸门范式，挂在现有 `runIdle`。零新基础设施 |
| sidecar 侧常驻时钟 | 真定时，但需跨进程编排，sidecar 目前只管存储 |
| 外部 launchd/cron | 最可靠，但需用户额外配置，非开箱即用 |

### 4.2 为什么够用

真正的需求是「**下次和假人说话时，她的性格已是更新过的**」，而非「必须在凌晨 3 点整执行」。
跨日后首次 idle 触发在语义上完全满足——只要当晚/次日有人和假人对话，就会在对话前完成内省与更新。

### 4.3 已知代价（接受）

连续多日无人对话 → 那些天不产生 drift，演进链出现断档。
此断档**本身携带信息**（"那几天没人理她"），且不影响正确性——恢复对话后从最新状态继续漂移。

### 4.4 实现要点

- 挂在 `index.ts:215-240` 的 `runIdle` 内，与 `syncLatestTurn` / `consolidator` 并列。
- 复用 `daily-tracker.ts` 的 `today()` 做日历日去重，新增一个 `personaDriftDoneDate` 状态位。
- 状态存储位置待定（见 §12 开放问题 Q1）。

---

## 5. drift 数据结构

每日产出一条 drift 记录（JSON）：

```json
{
  "date": "2026-08-30",
  "dims": {
    "openness":     0.05,
    "warmth":       0.02,
    "verbosity":   -0.08,
    "playfulness":  0.03,
    "assertiveness": 0.01
  },
  "mood": "沉静",
  "leaning": "更愿意追问而非直接给答案",
  "preoccupation": "反复出现：小说节拍与结构设计",
  "rationale": "近期对话围绕创作方法论，用户多次追问细节，倾向少给结论多给问题",
  "evidence": ["node-id-1", "node-id-2"],
  "cumulative": { "openness": 0.31, "warmth": 0.12 }
}
```

字段说明：
- `dims`：**当日增量**偏移，各维度范围 `[-1, 1]`，单日受 §7 护栏 clamp。
- `cumulative`：**累积值**（含当日），用于快速读取当前状态，避免每次重放整条链。
- `evidence`：支撑该判断的记忆节点 id 列表，保证可追溯、可审计。
- `rationale`：LLM 给出的人类可读理由，用于 UI 展示与调试。

维度集合（初始 5 个，可扩展）：`openness` / `warmth` / `verbosity` / `playfulness` / `assertiveness`。

---

## 6. 输入：近期记忆与对话

内省任务的输入组装规则：

1. **近期对话**：取最近 N 天（默认 7）的 `Event` 节点，按 `timestamp` 升序。
   - 文本取 `props.assistantSummary`，**不取 `props.assistantText`**（thinking 污染，见 §2.2）。
   - 用户侧取 `props.userText`。
2. **近期记忆**：`Entity` 节点，`store.query({ instanceId, limit: 50 })` 后按 `timestamp` 在 TS 侧过滤。
3. **历史 drift 链**：最近 M 天（默认 14）的 drift 记录，供 LLM 判断「已在往哪个方向走」，避免重复同向叠加。
4. **base persona**：作为不可变锚一同输入，明确告知模型「这是不能改的底线」。

### 6.1 清洗规则（必须）

| 过滤项 | 规则 |
|---|---|
| `system-reminder` 节点 | `userText` 以 `<system-reminder` 开头 → 丢弃 |
| injected 消息 | `injected: true` 的消息不入图（已有机制，保持） |
| 字段残缺节点 | 缺 `userText` 或 `assistantSummary` → 丢弃（如 21:46 手工测试节点） |
| 时间范围 | 只取 `now - 7d` 内 |

> 注：无时间范围查询能力（§2），采用「宽拉 + TS 侧按 timestamp 过滤」的既有模式，与 `planner.ts:65` 的做法一致。

---

## 7. 护栏（防性格跑飞）

| 护栏 | 约束 |
|---|---|
| 单日增量上限 | 每个维度单日 `|Δ| <= 0.15` |
| 累积上限 | 每个维度累积值 clamp 到 `[-1, 1]` |
| base 不可变 | LLM 输出中任何改写 base 的字段一律丢弃 |
| 输出校验 | 结构不符 / 维度越界 → 拒绝本次 drift，保留昨日状态，记录错误日志 |
| 回退能力 | 演进链完整保留，可回退到任意历史日期的累积状态 |

---

## 8. 持久化：演进链

每日 drift 写入记忆图，串成链：

- **节点**：`type: "Event"`，`props.kind = "persona_drift"`，`label = "性格漂移 2026-08-30"`，完整 drift JSON 存 props。
- **边**：与前一条 drift 节点建立 `kind: "causal"` 边（表示"由此演变而来"），形成时间序链。
- **evidence 边**：drift 节点与支撑它的记忆节点建立 `kind: "relates"` 边，实现可追溯。

写入走现有接口：
- `POST /{instanceId}/node`（`axolotl-client.ts:60-62` → `server.py` `add_node`，已含 `save()` 持久化修复）
- `POST /{instanceId}/edge`（`axolotl-client.ts:64-66`）

> **注意**：`server.py` 的 `set_meta` 是整块 JSON 覆盖写（last-write-wins），
> 若 UI 同时改 name/persona，追加的历史数组会被冲掉。
> 因此**演进链必须写进图节点，不能塞进 meta**——这正是选择图存储的原因。

---

## 9. 注入：effective persona 合成

`assemble` 时（`index.ts:197-202` 处）由 base + 当前累积 drift 合成 effective persona 文本，
替换现有 `meta?.persona ?? DEFAULT_PERSONA` 的取值逻辑。

合成方式（待评审，见 §12 Q2）：
- **方案 A（推荐）**：base 全文 + 一段由 drift 生成的「当前状态」描述追加在后。
- **方案 B**：把维度偏移翻译成自然语言修饰语，嵌入 base 模板的占位符。

保持 `channel = "persona"` 与 `personaSeen` 每 session 只注入一次的机制不变。

---

## 10. 接口清单（拟新增）

| 位置 | 新增内容 |
|---|---|
| `src/agent/persona-planner.ts` | 新增。`PersonaPlanner.plan(instanceId, ctx)` — 组装输入 → 调 LLM → 校验 → 返回 drift |
| `src/agent/persona-drift.ts` | 新增。累积计算、clamp、合成 effective persona |
| `src/knowledge/daily-tracker.ts` | 扩：增加 `personaDriftDoneDate` 日历日状态位 |
| `src/index.ts` | 改：`runIdle` 内挂入内省任务；`assemble` 取 effective persona |
| `src/memory/graph-store.ts` | 可能扩：按时间过滤的辅助方法 |
| `src/leak/config.ts` | 扩：内省任务的开关与参数（drift 上限、回顾天数等） |
| CLI / 设置面板 | 展示当前 drift、演进链、支持回退（后续迭代） |

---

## 11. 测试用例（业务层）

1. **日历日去重**：同一天内多次 idle，只执行一次内省。
2. **跨日触发**：跨天后首次 idle 执行内省，产出新 drift 节点。
3. **单日 clamp**：LLM 返回 `openness: 0.9` → 实际记录 `0.15`。
4. **累积 clamp**：连续多日同向偏移，累积值停在上界 `1.0` 不越界。
5. **base 不可变**：LLM 输出含改写 base 的字段 → 该字段被丢弃，base 字节不变。
6. **输出校验失败**：LLM 返回非法 JSON / 缺字段 → 拒绝本次 drift，昨日状态不变，有错误日志。
7. **数据清洗**：`system-reminder` 节点、缺 `assistantSummary` 的节点不进入输入。
8. **不取 assistantText**：确认输入中不含 thinking 文本。
9. **演进链完整**：连续 3 天产出 3 个 drift 节点，`causal` 边串成链，顺序正确。
10. **回退**：回退到 d-2 → effective persona 等于当时的合成结果。
11. **持久化**：写入 drift 后 kill sidecar 重启，drift 节点仍在。
12. **无对话时**：当日无任何 Event 节点 → 不产出 drift（或产出零偏移的空 drift，待定，见 §12 Q3）。

---

## 12. 风险与开放问题

| # | 问题 | 说明 |
|---|---|---|
| Q1 | 内省任务的状态位（`personaDriftDoneDate`）存哪？ | `daily-tracker` 现状存在 `./.fakeren-knowledge/<id>.json`（**不在 axolotl**），与 D1「记忆存取走 axolotl 唯一」的设计铁律有张力。建议迁进图或单独评估 |
| Q2 | effective persona 用哪种合成方式？ | 方案 A（追加描述）vs 方案 B（模板占位符）。影响注入文本的自然度 |
| Q3 | 当日无任何对话时怎么办？ | 产出零偏移 drift，还是跳过当天（演进链断档）？ |
| Q4 | 维度集合是否需要可配置？ | 不同假人可能需要不同维度（如"毒舌度"） |
| Q5 | persona 每 session 只注入一次 | 意味着新性格要下次会话才生效。是否需要支持会话内热更新？ |
| R1 | LLM 判断质量不稳定 | 缓解：evidence 强制引用、rationale 可审计、clamp 限制破坏半径 |
| R2 | 长期漂移可能收敛到边界值 | 缓解：累积 clamp 设置为软上限（接近上界时增量衰减） |

---

*本文档基于 2026-08-30 对 `golem` 仓库与 `ysj` 实例真实图数据的核查撰写。所有现状结论均有代码行号或实测数据支撑。*
