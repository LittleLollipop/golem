# 假人 · 阶段三架构方案（评审稿 · 2026-08-23）

> 依据 /se-semantic-graph 阶段三。前置：`requirements.md`（A–I 共 46 条）、`base-analysis.md`（dsh GO + C1–C3 + H1–H4）、`persona.md`、`requirements-memory-substrate.md`。
> 本方案每一条设计都回指具体 req / 决策 / 底座证据。**本文档是评审稿，评审通过后才写码**；写码交「龙虾」按本方案落地。

---

## 0. 设计约束（来自已决决策，不可违反）

| 编号 | 约束 | 来源 |
|---|---|---|
| C1 | 生命周期跟**进程**：只在 `dsh web` 常驻期间有潜意识，人关程序即停（诚实降级 A） | `dec_c1_247` |
| C2 | 漂移通道**禁止借道 `sessionQuery`**；三通道物理分离 | `req_channel_separation` + base-analysis §4 |
| C3 | 对 dsh 做**薄适配层**，只挂文档化扩展点，锁 commit `b150a55` | `base-analysis §7` |
| D1 | 记忆存取 = **axolotl_rs 唯一**，否文件/文档式记忆与日志 | `dec_memory_axolotl_only` |
| D2 | valence = **AI 自身情绪**（非用户情绪），L0/L0.5 漂移被其加权 | `dec_valence_ai_self` + `req_l0_emotion_coupling` |
| D3 | 建记忆（写）与读漏出（读）**分属不同环节** | `br_extract_separate_phases` |
| D4 | 宿主对信号**模态不可知**，语义边界归扩展组件自管 | `decision_host_modality_agnostic` |
| D5 | **以「假人」为隔离单位**：记忆/学习/漂移/情绪一切"自我"状态按假人边界互不可见；跨会话漂移**全量**；会话开始选定、**中途不可切换** | `dec_isolation_per_instance` |

---

## 1. 分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│ L5  表达层 (Expression)                                            │
│     golem-precompose · persona profile · 后筛(userQuestions)      │
├──────────────────────────────────────────────────────────────────┤
│ L4  感知总线 (Signal Bus) — 模态不可知                              │
│     golem-signal-bus · 信号源插件(Definition/Provider/Consumer)   │
├──────────────────────────────────────────────────────────────────┤
│ L3  认知层 (Cognition) — 三通道 + 记忆读写 + 分级器                  │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐ ┌────────┐ ┌──────────┐  │
│  │drift    │ │ recall   │ │situational │ │grader  │ │eval(评测)│  │
│  └─────────┘ └──────────┘ └────────────┘ └────────┘ └──────────┘  │
├──────────────────────────────────────────────────────────────────┤
│ L2  记忆基座 (Memory Substrate) — 维度 H，axolotl_rs 唯一           │
│     golem-memory: Writer / Reader / Consolidator / GraphSchema   │
├──────────────────────────────────────────────────────────────────┤
│ L1.5 实例管理层 (Instance Plane) — 假人隔离边界(D5)                 │
│     golem-registry: 配置页(新建/列出) · 会话开始选定 · 中途不可切换 │
├──────────────────────────────────────────────────────────────────┤
│ L1  薄适配层 (Adapter, C3) — 只包 dsh 文档化 seam                   │
│     golem-adapter: preStep / idle / invariant / askUser / persist│
├──────────────────────────────────────────────────────────────────┤
│ L0  上游基座 — dsh @ b150a55（锁 commit，不 fork/不 patch 核心）    │
└──────────────────────────────────────────────────────────────────┘
```

**关键分层纪律**
- L2 记忆基座是**横向贯穿**的：L3 三通道都读它、写它；但它不依赖 L4/L5。
- L1 适配层是**唯一**直接 import dsh 的地方；其余层只依赖 L1 暴露的域 API（C3：rc 变更只改 L1）。
- L4 感知总线对上层**只暴露"信息能否进来 + 存哪"**，绝不暴露"进来的是什么感官"（D4）。
- **L1.5 实例管理层是横向边界**：进入 L2–L5 的每一条状态（记忆图 / 学习进度 / 种子池 / valence）都按 `instanceId` 命名空间隔离，假人之间互不可见（D5）。

---

## 2. 模块划分与需求映射

所有认知/表达/感知模块以 **dsh peer 插件**（Cordis Seam）形态接入（`req_dsh_peer_plugin`），非编码 profile 复用 runtime 骨架、弃 terminal/editor 工具（`req_noncoding_profile`）。

### L1 · `golem-adapter`（薄适配层，C3）
唯一 import dsh 的模块。暴露：
- `onPreStep(handler)` → 包 `agent/pre-step` waterfall（base-analysis §2.1）
- `runIdle(task)` → 包 `agent.runMaintenance`（`req_async_precompute`，不进主回合关键路径）
- `registerInvariant(name, fn)` → 包 `ctx.invariants`（`req_degrade_no_fabricate` 机器校验）
- `askUser(q)` → 包 `ctx.userQuestions.ask()`（`req_leak_postfilter_dynamic` 后筛）
- `persist(domain,key,val)` / `load(domain,key)` → 包 `ctx.storageDomain`（H2：学习进度持久化，跨重启重算 due）

### L1.5 · `golem-registry`（实例管理层，D5）
- 假人注册表：每个假人 = 独立 axolotl_rs 命名空间 + 独立学习进度 / 种子池（`req_iso_namespace` `req_iso_learning_scoped`）。
- 配置 / 管理面：新建假人、列出现有假人（`req_iso_config_page`，C3 下为独立轻量 UI，不 patch dsh 核心）。
- 会话绑定：会话开始时选定 `instanceId`（默认上次使用，或首轮 `askUser` 选择）；绑定后由不变量拒绝变更（`req_iso_session_select` `req_iso_no_mid_switch`）。

### L2 · `golem-memory`（记忆基座，维度 H，D1）
包 axolotl_rs。子组件见 §6。对 L3 暴露：`MemoryWriter`（写）、`MemoryReader`（读/recall）、`Consolidator`（巩固）。**这是 D1 的唯一记忆落地**。

### L3 · 三通道
| 模块 | 职责 | 主满足 req | 源标签 |
|---|---|---|---|
| `golem-drift` | L0/L0.5 漂移：从真实史游标 + 记忆图采样种子，AI 自身情绪加权（D2），注入 ambient | `req_l0_real_history_drift` `req_l05_knowledge_trajectory` `req_l0_emotion_coupling` | `golem-drift` |
| `golem-recall` | 目标导向图检索（自己的记忆图），**独立路径** | `req_channel_separation`（图检索通道） | `golem-recall` |
| `golem-situational` | L1 处境：拉取/理解用户当下状况，目标导向 | `req_l1_situational_awareness` | `golem-situational` |

### L3 · `golem-grader`（任务分级器）
- 分类：`{leakStrength: strong|weak|zero, confidence}`
- fail-safe：**置信度低 → 按 zero**（强漏误判比弱漏漏判危险，见需求张力 #2）
- 映射 `req_leak_by_task_class`（创作·构思=strong / 事实查询=weak / 执行命令=zero）
- 与后筛协作：`req_leak_postfilter_dynamic`（执行命令/改代码歧义 → `askUser` 交选项）

### L3 · `golem-eval`（评测，非日常）
- 反事实重跑：同 seed 同参数，带种子 / 不带种子各跑一遍，diff 输出（`req_output_attribution`）
- 挂 dsh `llm-replay` + fork/resume + `tokenMeter`（base-analysis §5 已确认基础设施齐）
- **评测模式常开、日常只留 C1（记注入了什么）**（需求张力 #1 的降级路径）

### L4 · `golem-signal-bus`（感知总线，D4）
- 信号源插件契约（§5）：Definition / Provider / Consumer 三角
- 宿主只管：采集开关（`req_capture_whitelist`）+ 本地留存（`req_local_only`）+ 不可达即 no-op（`req_degrade_no_fabricate`）
- **模态/语义边界归 Provider 自管**（D4）；消费方把信号写入 L2 记忆图 + 真实史游标

### L5 · `golem-precompose`（表达层）
- `agent/pre-step` 内：grader 定级 → 向三通道取贡献 → 按 persona 组装注入消息（带 source 标签）
- 衰减：`req_ambient_decay_stream` 用 **Plan B 停复注 + 留痕**（不遮蔽、不碰 dsh 窗口）：低于权重阈值的种子不再被选中注入，永久记忆原封不动。详见 §7 与 `dec_decay_planb`

---

## 3. 三通道状态机与分离保障（C2）

### 3.1 各通道独立状态机

**漂移通道 `golem-drift`**（非目标导向，漏而非查）
```
gathering ──(runIdle 周期扫描真实史游标+记忆图)──> staged
staged   ──(pre-step 读取)──> injecting
injecting──(停复注, 旧种子不再被选中)──> cooling ──> staged(下一轮刷新)
```
- 种子池存 `storageDomain`（H2 持久），不靠 `ctx.jobs`（H2 jobs 进程本地会死）。
- **gathering 只骑 `ctx.sessionPersistence.list()/load()`（跨会话扫原始事件，非 `sessionQuery` 的模型可见投影）+ `MemoryReader.queryCrossDomain()`；代码层禁止出现 `ctx.sessionQuery`**。`sessionPersistence` 是 dsh 文档化插件面 API（实测存在：`list()` 枚举持久会话、`load(id)` 读原始事件），故 RealHistoryCursor 不 fork 任何核心。枚举 / 读取时按 `instanceId` 过滤，只取**该假人**的会话（D5，全量跨会话但假人边界）。

**图检索通道 `golem-recall`**（目标导向）
```
idle ──(agent 显式需要事实)──> querying ──> injecting ──> idle
```

**处境通道 `golem-situational`**（目标导向，理解用户）
```
idle ──(感知总线/对话拉取用户处境)──> sensing ──> injecting ──> idle
```

### 3.2 分离保障（三层强制，C2）

1. **类型隔离**：每条贡献 `AmbientContribution { channel: 'drift'|'recall'|'situational', sourceTag, payload }`；`drift` 分支的编译器类型**只暴露 `RealHistoryCursor` 与 `MemoryReader`，不含 `ctx.sessionQuery`**——从 API 层就堵死借道。
2. **源标签审计**：所有注入消息带 `source:{kind:'plugin',plugin:'golem-*'}`；`req_seed_provenance` 由「model-visible 必 logged」不变量（base-analysis §3.1）免费强制。
3. **不变量校验**：注册 `ctx.invariants` 检查「`golem-drift` 来源的事件必须有真实史游标 id 或记忆图节点 id 作证，否则 `fail()`」——把 C2 从约定升级成运行时会抛错的机器校验。

---

## 4. 数据流（turn 周期 + idle 维护）

```
[用户消息] → dsh turn
   │
   ▼
agent/pre-step (golem-precompose)
   ├─ grader 分类(strong/weak/zero, 置信低→zero)
   ├─ 取贡献：drift(staged 种子) / situational(如需) / recall(如需)
   ├─ 组装带 source 标签的注入 UserMessage
   ▼
[模型响应]
   │
   ▼
turn 结束 → MemoryWriter.extract(输入, 输出)  ──写──▶ L2 记忆图   (D3 写环节)
   │
   ▼
idle (runIdle / whenIdle):
   ├─ Consolidator 评分→留/剪/合并 (产出巩固报告)
   ├─ L0.5 每日学习 tick (到期则取排名 top1, 已学则 top2, 带引证落库)
   ├─ drift engine 刷新 staged 种子 (读真实史游标+记忆图, 情绪加权, 写 storageDomain)
   └─ situational 重新感知用户处境
```

- **建/读分环节**（D3）：`MemoryWriter.extract` 是写，只在 turn 结束跑；drift 读是读，只在 idle/gathering 跑；两者不抢同一时机。
- **假人隔离贯穿**：上述每条写 / 读操作都携带 `instanceId`，状态按假人命名空间隔离（D5）。
- **异步预算**（H2/E）：gathering、consolidation、L0.5 全在 `runIdle`，不进主回合关键路径（`req_async_precompute`）。

---

## 5. 信号源插件契约（L4，D4）

宿主**模态不可知**，只定义「信息输入」通用接口：

```ts
// Definition：声明能产出什么（宿主不解释 modality 语义）
interface SignalSourceDefinition {
  id: string
  modality: string          // 自由串，如 "camera"/"mic"/"taste"，宿主不解读
  schema: JSONSchema        // 所产 SignalBatch 的结构
}

// Provider：具体感官实现（摄像头/麦克风/…），自管语义与隐私边界
interface SignalSourceProvider {
  definition: SignalSourceDefinition
  refreshIntervalMs: number
  poll(): Promise<SignalBatch | null>   // null = 不可达 → 宿主 no-op
}

// Consumer：把信号写入记忆图 + 真实史游标（L2 + 漂移基质）
interface SignalConsumer {
  ingest(batch: SignalBatch): void
}
```

**宿主（`golem-signal-bus`）职责**：注册 Provider、按 `refreshIntervalMs` 轮询、路由到 Consumer、强制 `req_capture_whitelist`（每源独立开关 + 最小采集 + 可随时停）、`req_local_only`（本地处理不留外发）、`req_plugin_isolation` + `req_degrade_no_fabricate`（不可达=无注入，绝不编造）。**「进来的是什么、用到什么程度（是否转录/识别）」是 Provider 自己的责任**（D4），宿主不规定。

---

## 6. 维度 H 在 axolotl_rs 的落地（L2）

### 6.1 图 schema
- **命名空间**：每个假人 = 独立 graph / namespace key（`req_iso_namespace`）；所有节点 / 边 / 巩固 / 学习都带 `instanceId`，假人之间互不可见（D5）。
- **节点**：`Entity`（人/物/概念）、`Event`（已发生事件，带 `timestamp` + `provenance_id`）、`MetaNode`（递归生长出的元节点）
- **节点属性**：`valence`（`{score:-1..1, dims?:{awe,aversion,fondness,fear}, self:true}`——**AI 自身情绪**，D2）、`created_at`、`last_accessed`、`access_count`、`decay_score`
- **边**：`relates`（typed 关系）、`causal`（因果，带方向+置信，**真实偶然性载体**）、`crossdomain_weak`（陈旧/周边弱关联，**L0 漂移种子物理基础**）、`cooccurrence`

### 6.2 读写 API
- **写** `MemoryWriter.extract(turnInput, turnOutput)`：LLM 复用自身抽取候选节点/边（无第二模型）→ 写图。事件记录时一并写 **AI 自身 valence**（writer 提示模型输出其对实体/事件的第一人称情绪反应，D2）。
- **读** `MemoryReader`：`recall(keywords)`、`recallFeedback(dim)`（按 valence 回忆，与图检索通道区分——这是*自己的记忆图*）、`queryCrossDomain(nodeId,maxHops)`（取跨域弱边邻居，漂移采样用）、`queryByValence(dim,threshold)`（情绪加权采样）。

### 6.3 巩固器 `Consolidator`（可观察遗忘/合并）
- 周期（`runIdle`）多信号评分：`|valence|+recency+access_freq+degree`
- → 留 / 剪（低分）/ 合并（相似簇）；产出**巩固报告**（剪了什么、合并了什么群落）——`req_memory_consolidation` 可观察。
- **递归生长**（`req_memory_recursive_growth`）：偶对图自身高中心性簇跑 extract，长出 `MetaNode`（元层，v1 可保守）。

### 6.4 漂移种子生成（D2 情绪耦合）
`drift engine`：从 `MemoryReader.queryCrossDomain` + `queryByValence` 取陈旧/周边节点，**AI 自身 valence 越高 → 入池概率与漏出权重越高**（`req_l0_emotion_coupling`），再经 `grader` 定级后由 `precompose` 注入。

---

## 7. 风险闭合（回指 base-analysis 张力 + 需求张力）

| 风险 | 闭合方案 |
|---|---|
| 输出级归因只能近似、天真做法违反禁编造（需求张力 #1） | 反事实重跑 `golem-eval`；评测模式常开、日常只留 C1（记注入） |
| 任务分级误判（需求张力 #2） | fail-safe：置信低→zero；强漏误判比弱漏漏判危险 |
| 信号边界下放（需求张力 #3 / D4） | 信号总线设计已落地：宿主只管进/存/停，语义归 Provider |
| H1 无 24/7 | C1=A 已决：只在进程常驻期漂，靠长开程序解决 |
| H2 jobs 进程本地 | 学习进度/种子池存 `storageDomain`，重启重算 due |
| H3 storageDomain 进程内 | C1=A 单进程内解决，不引入跨进程 |
| H4 rc.2 破坏变更 | L1 薄适配层 + 锁 commit `b150a55`，只挂文档化 seam |
| `sessionQuery` 陷阱（L0 退化为目标导向检索） | §3.2 三层强制：类型隔离 + 源标签 + 不变量校验 |
| 跨会话漂移基质（会话日志分裂） | 骑在 `ctx.sessionPersistence.list()/load()` 上扫**原始事件**（非 sessionQuery 的模型可见投影，源码已确认该 API 存在）；**全量跨会话 + 假人命名空间边界**（`req_iso_full_crosssession` `req_iso_namespace`）：按 `instanceId` 过滤只取该假人历史，假人之间不串；全量扫描的性能由 per-假人 持久化增量游标（存 `storageDomain`）摊平 |
| 衰减 vs 永久留痕 | **终态 = Plan B（停复注 + 留痕）**：drift 模块停止把低于权重阈值的种子重新注入上下文，永久记忆（axolotl 图 + dsh 会话日志）原封不动；surface 替换式衰减**彻底不做**（用户明确"没有必要做替换"），故不依赖 dsh 上游暴露 surface-append，C3 守得住 |

---

## 8. 待你拍板点（评审通过后才写码）

1. **跨会话范围**：**已决（维度 I）**——全量跨会话 + 假人命名空间边界：漂移扫该假人所有历史原始事件（非最近 N），性能由 per-假人 持久化增量游标摊平。详见 `req_iso_full_crosssession` / `req_iso_namespace`。
2. **递归生长 v1 强度**：**已决 = 保守偶发**——`MetaNode` 仅对图自身高中心性簇按低概率/长周期偶发抽取，不每轮跑、不强制。详见 `dec_recursive_growth_conservative`。
3. **衰减实现取舍**：**已决 = Plan B（停复注 + 留痕）为终态，surface 替换彻底不做**——drift 停止把低权重种子重新注入，永久记忆原封不动；用户明确"没有必要做替换"，故不引入任何 surface 依赖，C3 守得住。详见 `dec_decay_planb` / `rejected_surface_replacement`。
4. **写码分工**：**已决 = WorkBuddy 直接写码**（不交龙虾）。方案定稿，进入实现期。

> 第 4 点是流程确认；前 3 点是架构内的范围/强度拍板。你定了我就把本方案固化进 `requirements.md` 的「已采纳架构」段 + 入语义图，然后开写。
