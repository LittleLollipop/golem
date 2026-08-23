# 假人 · 底座剖析（dsh）

> 阶段三架构评审的**前置文档**。在此之前的所有 dsh 描述均来自搜索摘要，未经源码验证；本文档以真实源码为唯一依据重做一遍。
>
> **证据锚点**：`deepseek-ai/deepseek-harness` @ commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（2026-08-21）
> 版本 `0.1.1-rc.2` · MIT · TypeScript · Node `^22.19.0 || >=24` · pnpm 11.7.0 · 2472 个 TS 源文件
> 本文档每条结论都标注了源码/文档出处；标注「**未验证**」的一律不得进入架构设计。

---

## 0. 为什么必须先有这份文档

阶段三要输出"三通道如何互不借道""感官源如何异步降级""任务分级器落在哪一层"。这些答案**完全取决于底座真实提供什么**：

- 如果 dsh 没有"喂模型前改写消息"的钩子 → 注入通道无处安放，整个漏出机制作废。
- 如果 dsh 没有"无用户触发的后台计算" → 潜意识层不能"活着漂"，L0.5 每日学习无从执行。
- 如果 dsh 的记忆读写全是相关性检索 → 我们就是在 L2 地基上盖 L0 的楼（会话早前已认定的自相矛盾）。

基于搜索摘要画架构 = 编造，直接违反 `rule_mechanism_first`。故先做此剖析。

---

## 1. 核实：dsh 真实形态

| 项 | 实测值 | 出处 |
|---|---|---|
| 仓库 | `deepseek-ai/deepseek-harness`，⭐185k | GitHub API |
| 协议 | MIT | `LICENSE`、`package.json` |
| 语言/栈 | TypeScript + pnpm workspace，含 `native/`、`python/` 子目录 | 仓库树 |
| 版本 | **0.1.1-rc.2** | `package.json` |
| 稳定性 | **developer preview，README 全大写警告"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"** | `README.md` |
| 底层框架 | **Cordis**（`cordiverse/cordis`），论文《A Programming Paradigm for Spatiotemporal Composability》 | `README.md` |
| 核心主张 | Everything is a plugin；**"There is no privileged core to patch"** | `docs/architecture.md` |
| 运行形态 | `dsh web` 起常驻服务（默认 `127.0.0.1:3080`）；`--profile headless` 为一次性 runner，不开监听端口 | `README.md`、`packages/bundle/headless/README.md` |
| 扩展方式 | profile（命名组合）+ bundle（分发格式）+ `cordis.patch.yml` 分层覆盖；外部插件可挂在 profile 里 | `docs/architecture.md#profiles-and-bundles` |
| 官方插件开发文档 | 有：`docs/user/develop/{basic,framework,practice}/` | 仓库树 |

**结论**：dsh 真实存在、真是第一方 harness、真是插件化架构、真 MIT。上一轮的定性判断成立，但**版本比我以为的早得多**（rc 阶段，非稳定版）。

---

## 2. 三个关键 hook 点：代码级证据

### 2.1 注入点 —— `agent/pre-step` ✅ 完全可用

`docs/architecture.md` 的 turn flow 写明：

```text
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
```

> "`agent/pre-step` **decides what the model sees**. Listeners may **rewrite the claimed messages** or reject them outright."

事件签名（`packages/core/agent/src/runtime-types.ts:231`）：

```ts
'agent/pre-step'(
  this: Scoped<Agent>,
  payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<PreStepDecision>
): Promise<PreStepDecision>
```

它是 **waterfall** 事件（监听者须调 `next()` 委托）。注入写法（实测自 `packages/core/agent-loop/tests/contract-regressions.spec.ts:291`）：

```ts
ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
  const decision = await next()
  if (decision.kind === 'enter') {
    return { kind: 'enter', messages: [...decision.messages, createUserMessage({
      content: [{ type: 'text', text: '<seed>' }],
      source: { kind: 'plugin', plugin: 'fakeren-ambient' },   // ← 来源标签
    })] }
  }
  return decision
})
```

**而且有现成的一比一模板**：`packages/context/tmux-context/`。它做的事和我们几乎同构——周期性采集环境信息、在 `agent/pre-step` 前置注入一条带 source 标签的 `UserMessage`、带 `refreshIntervalMs` 节流配置、失败一律 no-op 而非报错。

它还给了三条我们直接能抄的工程纪律（`packages/context/tmux-context/README.md`）：

1. **注入只在每个 turn 的第一个 step 生效**（不是每 step 都灌）。
2. **节流状态从"原始持久会话事件"里扫**，不用进程内缓存 —— 所以"上次注入了什么/什么时候"在压缩和重启后仍然可查。
3. **失败 = no-op，不是 error**：`ctx.shell` 缺失、读数畸形、下游拒绝 → 什么都不注入，不打断 turn。

这三条正是 `req_leak_rate_tunable`、`req_seed_provenance`、`req_degrade_no_fabricate` 想要的行为，dsh 里已有可运行先例。

### 2.2 后台计算 —— 三套机制，各有边界 ⚠️ 部分可用

| 机制 | 能力 | 实测边界 | 出处 |
|---|---|---|---|
| **`agent.runMaintenance(task)`** | **从真正的 idle 相位跑一个非 turn 任务**；任务执行期间**对外状态仍是 `idle`**，唤醒输入留在 inbox 等任务结束 | 需要一个活着的 agent；turn 或另一个维护任务占用时**同步抛错** | `packages/core/agent/src/runtime-types.ts:96-104` |
| **`agent.whenIdle()`** | 等到没有 driver 和维护任务在跑 | 同上 | 同文件 `:93` |
| **`ctx.jobs`** | 后台长任务注册表，**支持 owner 为 undefined 的"无主任务"** | **"Jobs are process-local — records die with the harness process"**；且 agent 组合里没加载 `tool-jobs` 的话根本起不了后台任务 | `packages/jobs/jobs-local/README.md`、`src/index.ts:312` |
| **`dsh-schedule`** | 持久定时提醒，状态存在**会话事件日志**里，支持 `every_seconds` 固定周期 | **最小间隔 5 分钟**；**"只在该 Session 有活着的 root Agent 时才等待"**，冷会话要等重新变活才补跑；到点是**开一个新 turn**（follow-up），不是静默计算 | `packages/schedule/schedule/README.md` |

**`runMaintenance` 是本次最重要的发现**：它就是"idle 潜意识线程"的原生机制 —— 从真正空闲相位跑计算、**不开 turn、不改状态、不打断对话**。L0 漂移种子的挑选与巩固应该跑在这里。

**但必须直说的缺口**：dsh **没有**"进程不在也能跑"的 OS 级 24/7 daemon。三套机制全部依赖"有一个活着的 harness 进程 + 活着的 agent"。所以：

- ✅ 可做："`dsh` 常驻进程在跑期间，后台持续学习/轮询/漂移"（`dsh web` 本身就是常驻服务进程）。
- ❌ 不可做（靠 dsh 自身）："人不开电脑时它也在过自己的生活"。
- 若要后者，必须**外部调度器**（launchd）+ 我们自己的持久 ambient 存储，dsh 启动时读账补进度。**这是架构层要拍的一个决策，不是实现细节。**

### 2.3 L0 真实史基质 —— 会话事件日志 ✅ 可用且远超预期

`docs/architecture.md`：

> The session log is the **source of the context the model sees**. `deriveMessages()` projects model history from it, and raw `assistant/chunk` events preserve replay and UI fidelity. Fork, resume, transcripts, telemetry, and persistence all derive from this stream.

`ctx.sessions` = append-only `SessionEvent` 日志（`packages/core/session`）；持久化后端可选 jsonl / sqlite（`session-persistence-{jsonl,sqlite}`）；另有 `ctx.sessionQuery`（reads/traces/filters/search，sqlite 实现）。

**这正是我们要的"真实发生史"**：真实对话、真实决策、真实工具调用与后果，append-only、可回放、可 fork。它满足会话早前逼出的铁律 —— **L0 种子必须来自真实发生的事，禁 fabricated**。

⚠️ 但注意一个范式陷阱：`ctx.sessionQuery` 是**检索式**接口（filters/search）。用它做"相关性查询"就退回 L2 了。我们要的是**非目标导向的周边采样**，必须自己写读取器，直接扫原始事件序列做漂移采样 —— 不能借 `sessionQuery` 的道。这与 `req_channel_separation` 一致。

---

## 3. 四个意外之喜（dsh 白送的能力）

### 3.1 「Model-visible means logged」是**运行时不变量** —— 可审计免费拿到

> **Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and **a runtime invariant asserts it**. This is why a new model-visible input requires a new session event.
> —— `docs/architecture.md#session-log`

含义：**我们不可能偷偷注入**。任何进到模型的 ambient 种子都必然落成一条带 `source: { kind:'plugin', plugin:'fakeren-...' }` 的持久事件。`req_seed_provenance`（每条种子记来源与选择路径）从"我们要努力实现的需求"降级成"底座强制执行的事实"。

### 3.2 `ctx.invariants` —— 可把"禁编造"做成会抛错的机器校验

`packages/session/invariants/README.md`：`ctx.invariants.register(packageName, installer)`，installer 收到 `fail(message)`，抛 `InvariantError`。

这意味着 `rule_mechanism_first`（机制正确优先、禁 fabricated）可以**不靠自觉、不靠 code review**，而是注册成运行时不变量：任何一条没有真实来源引证的 ambient 事件进日志 → 直接 `fail()`。这正是"用工具补模型能力缺口"的老路子，落到底座上了。

### 3.3 surface 的**遮蔽/替换**机制 —— 解决了"衰减 vs 永久留痕"的冲突

我原以为「model-visible 必 logged」会和 `req_ambient_decay_stream`（ambient 是流不是库、昨天的不该今天还压着）硬冲突：注入即永久，无法"取消注入"。

`packages/core/session/src/surface.ts` 给了出路：surface 层区分 `surfaceOp: 'append'` 与**替换**，且——

> The model-visible surface **deliberately shadows replaced ranges** … Append-origin events are that transcript's durable source material; **replacement copies stay model-only**.

即：**旧种子可以被"替换/遮蔽"出模型可见面，同时 append-origin 原始记录仍留在日志里供审计**。衰减与留痕两者可同时成立。`agent-instructions` 已用这套做"取代旧 baseline"（`one explicitly superseding complete baseline`），有先例可抄。

### 3.4 `ctx.userQuestions.ask()` —— 后筛交还用户，原生支持

`packages/interaction/user-questions`：`ask({ questions:[{ id, question, detail?, options?, multiSelect? }] }) → Promise<Answer>`。

`req_leak_postfilter_dynamic` 里"歧义时主动把选项交还用户"不需要自建 UI，直接用这个 seam。

---

## 4. 四条硬约束（必须写进架构，不得美化）

| # | 约束 | 后果 | 应对方向（阶段三决） |
|---|---|---|---|
| **H1** | **无 OS 级 24/7 daemon**：`runMaintenance`/`jobs`/`schedule` 全依赖活着的进程+agent | "人不在时 agent 也在过日子"做不到；`dsh web` 关掉即停 | 要么接受"只在 harness 常驻期间漂"，要么加 launchd 外部调度 + 自有持久 ambient 存储做补账 |
| **H2** | **`ctx.jobs` 进程本地，records die with the process** | 跨重启的"今天学到哪了"不能靠 jobs 记 | 学习进度存 `ctx.storageDomain`（持久）或会话日志；重启后重算 due，抄 `schedule` 的"从持久 fold 推导最早目标"套路 |
| **H3** | **`ctx.storageDomain` 的 `domain/changed` 是进程内事件**，"a second host process observes no changes" | 若采用 H1 的外部 daemon 方案，两个进程看不到彼此的写入 | 单进程内解决优先；跨进程需自建 revision 轮询（dsh 自己把这块列为 deferred work） |
| **H4** | **0.1.1-rc.2 + 明写会有破坏性变更** | 我们的插件会被上游改挂 | 只挂**文档化的**扩展点（`agent/pre-step`、`ctx.jobs`、`ctx.storageDomain`、`ctx.invariants`、`ctx.userQuestions`）；不 patch 核心、不 fork；锁 commit；给上游接口做一层薄适配壳 |

另有一条**范式风险**（非 dsh 缺陷，是我们容易犯的错）：`ctx.sessionQuery` 提供了好用的 search/filter，顺手拿来做漂移种子选择就等于把 L0 做成了目标导向检索。架构上必须明令漂移通道**不得依赖** `sessionQuery`。

---

## 5. 需求 × 底座 匹配矩阵

30 条需求逐条对照（`requirements.md`）。分三类：**dsh 直供**（挂上去即得）/ **需自建**（dsh 给地基我们盖）/ **有张力**（须在架构里专门解）。

### dsh 直供（11 条）

| 需求 | dsh 提供物 |
|---|---|
| `req_dsh_peer_plugin` | Cordis「无特权核心」+ profile/bundle/patch 分层，peer 插件是官方姿势 |
| `req_noncoding_profile` | 自建 profile，只 stack 需要的 bundle，不加载 `tool-terminal`/`tool-fs` 等编码工具 |
| `req_seed_provenance` | **运行时不变量强制**（§3.1）+ `source:{kind:'plugin'}` 标签 |
| `req_background_task_log` | 后台动作走会话事件/自有 domain，天然留痕 |
| `req_leak_rate_tunable` | 插件 config（`tmux-context` 的 `refreshIntervalMs` 即先例） |
| `req_degrade_no_fabricate` | `tmux-context` 的"失败即 no-op 非 error"已是官方模式 |
| `req_plugin_isolation` | Cordis fiber + 可逆 effect，插件卸载自动 unwind |
| `req_inspect_cli` | `ctx.commands`（人类命令，**不开模型 turn**） |
| `req_ambient_toggle` | patch 层开关插件行 / config 开关 |
| `req_local_only` | 全本地运行，`storage-json`/`storage-sqlite` 本地后端 |
| `req_async_precompute` | `runMaintenance` 从 idle 相位算，**不进主回合关键路径** |

### 需自建（14 条）

核心认知机制全部要自己写 —— 这本就是本项目的新意所在，不是底座缺陷：

- `req_l0_real_history_drift`：**非目标导向的周边采样器**（读原始事件序列，绕开 `sessionQuery`）
- `req_l05_knowledge_trajectory`：每日取排名 + skip-if-learned + 带引证落库
- `req_l1_situational_awareness`：处境通道（拉取 + 理解用户当下状况）
- `req_channel_separation`：三通道物理分离的强制机制
- `req_leak_by_task_class` / `req_leak_postfilter_dynamic`：任务分级器 + 双版本候选后筛（`userQuestions` 只给了问的能力，判什么、怎么判要我们写）
- `req_signal_source_extensible`：ambient 信号源插件接口（**我们自己的 seam**：Definition + Provider + Consumer 三角，按 dsh 的 seam 规矩设计）
- `req_sensor_camera_mic`：具体感官 Provider（按 `decision_host_modality_agnostic`，模态语义归各扩展自管）
- `req_ambient_decay_stream`：用 surface 替换/遮蔽实现衰减（有先例，但要我们实现）
- `req_output_attribution`：反事实重跑 diff（dsh 有 `llm-replay`、`ctx.tokenMeter`、fork/resume，**基础设施意外地齐**，但归因逻辑自建）
- `req_capture_whitelist`、`req_design_docs`、`req_install_doc_for_others`、`req_daemon_footprint`

### 有张力（3 条，阶段三必须专门解）

| 需求 | 张力 | 备选解 |
|---|---|---|
| `req_ambient_decay_stream` | 注入即永久（§3.1）vs 要衰减 | surface 替换遮蔽（§3.3）——需验证插件能否发起替换 |
| `req_l0_real_history_drift` | 真实史在**会话日志**里，但会话是**分裂的**（每个 session 一条日志）；"这个 agent 的一生"跨会话 | 需要跨会话的漂移基质视图：`ctx.sessionQuery` 能跨会话读但是检索式；可能要自建跨会话事件游标 |
| H1（无 24/7） | "有自己生活的 agent" vs 进程在才活 | 接受降级 / 外部调度器（受 H3 掣肘） |

---

## 6. 与备选底座 Codex Harness 的对照

上一轮我把 Codex 列为备选。就本项目需求重新对照（**说明：Codex 侧未做同等深度的源码剖析，以下为定位级判断，不作为决策依据的硬证据**）：

| 维度 | dsh | Codex harness |
|---|---|---|
| 扩展粒度 | Cordis 插件 + seam，**无特权核心**，官方插件开发文档齐 | Rust 核心 + TS SDK + app-server 三层；核心定制门槛高 |
| 注入点 | `agent/pre-step` waterfall，可改写模型所见，**有 `tmux-context` 同构先例** | 未验证有同等细粒度公开钩子 |
| 后台 idle 计算 | `runMaintenance` 真 idle 相位、不开 turn | 未验证 |
| 事件日志 | append-only + 「model-visible 必 logged」运行时不变量 | 有持久会话，是否有同等不变量未验证 |
| 稳定性 | **0.1.1-rc.2，明警破坏性变更** | 稳定版本线，production-grade |
| 语言 | TypeScript（改起来快） | Rust 核心（性能好、迭代慢） |

**判断**：dsh 在**扩展性与钩子精度**上明显更贴合本项目；Codex 在**稳定性**上更强。本项目是个人研究项目、一次性到位、不上线（`cost_scope_one_shot`），**扩展精度的价值远高于稳定性的价值**。

---

## 7. 结论：GO（继续用 dsh），但带三个附加条件

**GO 的理由（按重要性排序）**：

1. **注入点存在且有同构先例** —— `agent/pre-step` + `tmux-context` 模板，最核心的风险（无处注入）已排除。
2. **idle 潜意识线程原生存在** —— `runMaintenance` 从真 idle 相位跑非 turn 计算，不开 turn 不改状态，正是这套机制最需要的东西。
3. **真实史基质现成且 append-only** —— 会话事件日志天然满足"禁 fabricated、种子须来自真实发生史"。
4. **"禁编造"可机器强制** —— 「model-visible 必 logged」不变量 + `ctx.invariants`，把我们最硬的纪律从自觉变成运行时校验。
5. **无特权核心** —— 全程 peer 插件，不 fork、不 patch 核心。

**三个附加条件（写进阶段三架构）**：

- **C1｜24/7 问题必须显式拍板**，不许含糊过去。要么承认"只在 harness 常驻期间有潜意识"（诚实降级），要么上外部调度器（但受 H3 跨进程限制）。**这是产品语义问题，不是技术细节** —— 它决定"假人有没有自己的生活"。
- **C2｜漂移通道禁止借道 `sessionQuery`**。写成架构级禁令 + 最好由不变量守住，否则 L0 会不知不觉退化成目标导向检索。
- **C3｜对上游做薄适配层**。所有 dsh 接口调用集中在一个 adapter 模块，rc 版破坏性变更时只改一处；锁定 commit `b150a55` 作为开发基线。

---

## 8. 这份剖析给阶段三留下的待决问题

阶段三架构评审要回答的问题，因本剖析而具体化了：

1. **C1**：ambient 生命周期跟进程还是跟真实时间？（决定"假人有没有自己的生活"）
2. 跨会话漂移基质怎么建视图？会话日志是分裂的，"agent 的一生"需要跨会话游标 —— 自建还是限制在单会话内？
3. 三通道互不借道靠什么强制？（架构约定 / 类型隔离 / `ctx.invariants` 校验 / agent preset 的 `isolate` realm）
4. 任务分级器 + 双候选后筛落在哪一层？（`agent/pre-step` 内？独立 seam？）
5. ambient 信号源 seam 的三角怎么划？（Service Definition / Provider / Consumer —— 按 dsh 规矩，"加能力 = 设计三个角色"）
6. 衰减用 surface 替换实现是否可行？（需验证第三方插件能否发起 surface 替换，或只有 compaction 能）
7. 反事实重跑评测怎么挂？（`llm-replay` + fork/resume + `tokenMeter` 看起来够用，需验证）

---

## 附：本次剖析的方法与可复现性

```sh
gh repo clone deepseek-ai/deepseek-harness /tmp/dsh-src -- --depth=1
cd /tmp/dsh-src && git log -1   # 应为 b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
# 关键阅读路径
docs/architecture.md                      # turn flow / 事件域 / seam / 新行为该放哪
docs/capability-seams.md                  # 全部服务与实现方的图
packages/context/tmux-context/            # 我们插件的一比一模板
packages/core/agent/src/runtime-types.ts  # pre-step 签名、runMaintenance/whenIdle
packages/core/session/src/surface.ts      # 模型可见面的 append/替换语义
packages/schedule/schedule/README.md      # 持久定时的真实边界
packages/jobs/jobs-local/README.md        # 后台任务的真实边界
packages/session/invariants/README.md     # 可注册的运行时不变量
docs/user/develop/                        # 官方外部插件开发指引
```
