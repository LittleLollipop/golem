# 性格漂移维度重构：三层人格坐标系 设计文档 v0.2

> 状态：**已拍板，实现中**（方案 A；Q3/Q5/Q6 已于 2026-09-01 由用户裁定）
> 日期：2026-09-01
> 触发：用户提问「性格的漂移量为什么是这五个维度」→「是不是应该找比较权威的心理学上的维度来用，不要自己造」。
> 前置文档：`docs/persona-drift.md`（机制）、`docs/persona-layering.md`（人设分层，已实现）
>
> 本文档所有"现状"结论均标注代码行号或真实数据文件行；所有心理学引用均标注可检索来源。

## 已裁定的开放问题（2026-09-01）

| # | 裁定 | 落地方式 |
|---|---|---|
| **Q3** | **露** | UI「人格坐标」面板露出 HEXACO 全部六维，其中 **H / C 两维灰显并注明"仅作人格坐标，不参与每日漂移"**（§9.2） |
| **Q5** | **修** | evidence 悬空边与本次重构**同批修**，见 §6.4 |
| **Q6** | **HEXACO** | Trait 层用 HEXACO 六维（不是大五） |
| Q7（迁移） | 用户未另行指定 → **按 §7 默认方案：归档 v1，不逐维映射** | 仅 `schemaVersion` 过滤，不写迁移代码 |

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 现有五维是拍脑袋造的吗？ | 是拼盘：3 个借自大五（openness/warmth/assertiveness）+ 2 个自造（verbosity/playfulness）。文档自己标了"初始 5 个，可扩展"（`persona-drift.md:167`） |
| 能不能直接换成大五/HEXACO？ | **不能直接替换**，范畴错配。大五/HEXACO 测的是 **trait**（跨情境、长期稳定），drift 测的是 **daily delta**（日内波动）。拿尺子量温度（§2） |
| 那权威理论怎么用？ | Whole Trait Theory 给了正解：**states 与 traits 用同一套内容轴测量**，只是把题干从 "in general" 换成 "right now"。于是 trait 层与 state 层可以共用轴名，语义却分层（§3） |
| 方案 A 具体是什么？ | Trait 层（静态坐标/重力中心，用 HEXACO 六维）+ State 层（每日漂移轴，大五状态轴，剔除不可观测维度）+ 表现层（verbosity/playfulness，聊天机器人专用操作参数），且 **trait 决定回弹中心与幅度**（§5） |
| 最紧急的事是什么？ | **不是换维度，是先救火**。实测数据显示现有链 7 天后就会撞满边界，且模型在输出恒定 delta（§1）。换维度不解决这个；重力回弹才解决 |

---

## 1. 实测：现有五维已经在失效（这是本次重构的第一推动力）

数据源：`~/.fakeren/drift-reports/ysj.drift-records.jsonl`（`ysj` 实例，24 条执行记录中 3 条真实写入）。

### 1.1 delta 三天几乎恒定

| 日期 | openness | warmth | verbosity | playfulness | assertiveness |
|---|---|---|---|---|---|
| 2026-08-30 | +0.05 | +0.10 | +0.05 | +0.10 | +0.05 |
| 2026-08-31 | +0.05 | 0 | +0.05 | +0.10 | 0 |
| 2026-09-01 | +0.05 | 0 | +0.05 | +0.10 | 0 |

**08-31 与 09-01 的 dims 向量逐字节相同。** 这不是"性格在漂移"，是一个常数在累加。

### 1.2 累积值单调不回头 → 边界撞击可预期

实测累积：`playfulness 0.1 → 0.2 → 0.3`，`openness 0.05 → 0.10 → 0.15`，`verbosity 同 openness`。

按当前速率外推（无回弹机制）：

| 维度 | 每日增量 | 撞满 ±1.0 所需天数 |
|---|---|---|
| playfulness | 0.10 | **7 天** |
| openness / verbosity | 0.05 | 20 天 |
| warmth / assertiveness | 0.10 / 0.05（首日） | 10 / 20 天 |

`persona-drift.md:279` 把"长期漂移可能收敛到边界值"列为风险 R2 并说"缓解：软上限"。**这不是远期风险，是 7 天后就要发生的事实**，且当前代码只有硬 clamp（`persona-drift.ts:377`），没有回弹。

### 1.3 为什么恒定：输入重复 + 提示词无回归指令

- **输入重复**：08-31 与 09-01 的 evidence 里出现**完全相同的用户原话**（`U: 你知道写故事的节拍吗?...`、`U: 我们上次聊到哪里了`）。`recentDays=7` 的窗口在两天内喂的是同一批对话，输出自然不变。
- **提示词缺回归指令**：`persona-drift.ts:122-129` 的 `INTROSPECT_SYSTEM` 只说"单日幅度必须克制（通常不超过 ±0.15）"，**从未告知模型当前累积已偏离基线多少、也没有要求它在缺乏新证据时回归**。LLM 的默认倾向是"每天都能找到一点正向变化"，于是产生系统性正向偏置。

> 诊断链：**输入重复 → 输出恒定 → 累积单调 → 必然撞边界**。换一套维度名字不影响这条链的任何一环。**重力回弹（§5）与提示词改造（§6.3）才是治本**，维度正名是同一批次里的另一件事。

### 1.4 顺带发现的缺陷（✅ Q5 裁定：与本次同批修，见 §6.4）

`persona-drift.ts:311-315` 为每条 evidence 建 `relates` 边。设计意图是连到**记忆节点 id**（`persona-drift.md:164`），但模型实际返回的是**自然语言文本**：

- 08-30：`['节拍讨论中的坚持与让步', '钟无艳大纲的回应', ...]`
- 09-01：`['U: 你知道写故事的节拍吗? 你觉得这几卷分别应该用什么节拍模式写呀', ...]`

→ **evidence 边全部指向不存在的节点**，UI 上 `evidence 边 4` 的计数在涨，追溯能力实际为 0。这是 evidence 机制的**静默失效**——计数在涨、能力为零，比直接报错更危险。

根因是**提示词要求的东西模型给不出来**：提示词写"evidence 最多 5 个节点 id"，但喂给模型的上下文里根本没有 id，只有对话文本。模型只能编一个看起来像 id 的字符串。

修复：**把候选 id 喂进去 + 建边前校验存在**（§6.4）。

---

## 2. 为什么不直接照搬大五 / HEXACO（范畴错配论证）

### 2.1 三层不同的测量对象

| 层 | 测什么 | 时间尺度 | 权威工具 |
|---|---|---|---|
| **Trait 特质** | 跨情境、跨时间的**稳定**个体差异 | 年 | 大五（Costa & McCrae）、HEXACO-PI-R（Ashton & Lee） |
| **State 状态** | 某一时刻/某一天的人格**表现** | 小时~天 | FFM-PSI（Gander 等，2025）、Big Five 状态量表（Ringwald 等，2021） |
| **Drift 漂移（本项目）** | 状态分布**中心**的缓慢移动 | 天~月 | 无现成工具 |

drift 既不是 trait（它是会变的）也不是 state（它是 state 的中心，不是某一次的 state）。**它是 state 分布一阶矩的移动。**

### 2.2 Whole Trait Theory 给了合法 bridging

WTT（Fleeson 2001；Fleeson & Jayawickreme 2015）把 trait 定义为**状态的密度分布**（density distribution of states）。关键论断（来源：ScienceDirect 对 WTT 的综述转述）：

> "states are essentially one-to-one reflections of traits. Thus, whole trait theorists… assume that state personality can be characterized with **the same content and scales** that have been used to assess traits for decades after **making minor edits to survey questions** (e.g., modifying item stems to ask respondents about their thoughts, feelings, and behavior **'right now'** as opposed to **'in general'**)."

这句话是整个方案 A 的理论许可证：**同一套轴（大五/HEXACO 的内容轴），两套时间语义。**

- 用大五/HEXACO 的轴名 = 有权威出处，不是自造。
- 但测量的是 daily delta 而非绝对水平 = 不犯"用 trait 量表测 daily 波动"的错。

### 2.3 支持"每日"这个粒度的证据

- WTT 综述转述：Fleeson 的经验取样数据显示，个体**状态分布参数的跨时间稳定性**为：均值 .91 / .97，标准差 .59 / .79，偏度 ≈ .45，峰度 ≈ .24（两项研究）。
  → **"波动幅度"本身是稳定的个体差异**。这直接支持 §5 里"每个假人有自己的波动系数"的设计。
- FFM-PSI（Gander, Traut, Uhlich, Horstmann, Steppan, Ziegler & Grob, 2025, *European Journal of Psychological Assessment*, online first 2025-07-02, DOI `10.1027/1015-5759/a000906`）：专门为密集纵向研究开发的五因素**状态**量表，在 Study 1（N=170 / 1,549 次评估）与 Study 2（N=1,725 / 18,905 次评估）中验证了结构效度、内部一致性与对特质测量的收敛效度，并"有效捕捉了个体内变异"。
  → 说明**大五轴在状态层面是可测的**，日频采样是学界认可的做法。
- Ringwald, Manuck, Marsland & Wright (2021, *Assessment*, PMID 33949209, DOI `10.1177/10731911211008254`)：20 项与 10 项每日大五状态量表，三独立样本 N=1,041，多层模型验证五因素结构在**个体间与个体内两个层面**均拟合良好。
  → 直接证明"同一组轴可以同时承载 trait 与 state 两层语义"，正是本设计要的。

### 2.4 所以方案不是"替换"，是"分层"

```
错误做法：把 5 个自定义维度 → 换成 5 个大五维度        （仍在用 trait 量表测 daily delta）
正确做法：Trait 层用权威轴（标一次） + State 层用同名的状态轴（每日 delta）
```

---

## 3. 三层坐标系

```
┌─ Layer 1 · Trait 基线层 ────────────────────────────── 静态，每个假人标一次
│   HEXACO 六维  H / E / X / A / C / O      ∈ [-1, 1]
│   作用：① 人格坐标（可对比、可可视化）
│        ② State 层的重力中心（回弹目标）
│   可观测性要求：低（一次性标注，不需要每日从对话中推断）
├───────────────────────────────────────────────────────
├─ Layer 2 · State 漂移层 ────────────────── 每日 delta，可累积、可回退
│   extraversion / agreeableness / openness / emotionality
│   作用：每日内省产出的增量，串成因果演进链
│   可观测性要求：高（必须能从当日对话文本中找证据）
├───────────────────────────────────────────────────────
└─ Layer 3 · 表现层（聊天机器人专用） ────── 每日 delta，同 Layer 2
    verbosity / playfulness
    作用：直接决定观感的操作参数，不在人格特质体系内
    可观测性要求：极高（字面可数）
```

**关键分层洞察：Trait 层与 State 层受不同的约束。**
Trait 层可以宽（6 维），因为它只标一次、是描述性的、不需要每日可观测——宽一点信息量更大，且 H 维（诚实-谦逊）对"这个人是谁"很有表达力。
State 层必须窄，因为每日要靠对话证据打分——**不可观测的维度只会退化成噪声**（见 §4 的审计表）。

---

## 4. 维度清单：可观测性审计与去共线定义

### 4.1 State 层逐维审计（判据：能否从当日对话文本中稳定找到证据）

| HEXACO 轴 | 闲聊文本中的可观测信号 | 判定 |
|---|---|---|
| **X 外向性** | 发言长度、是否主动开启话题、感叹号/emoji 密度、是否主动追问 | ✅ 保留 `extraversion` |
| **A 宜人性** | 是否反驳用户、语气的柔软度、是否顺着用户说、是否挑刺 | ✅ 保留 `agreeableness` |
| **O 经验开放性** | 是否主动联想/类比/展开新话题、是否对新提法感兴趣 | ✅ 保留 `openness` |
| **E 情绪性** | 担忧/抱怨/敏感/自我怀疑的表达密度 | ⚠️ 保留 `emotionality`，**但降权**（见下） |
| **C 尽责性** | 闲聊里几乎不出现"按时完成任务/有条理"的行为 | ❌ **剔除** |
| **H 诚实-谦逊** | 承认错误、不占便宜——闲聊里近乎不出现 | ❌ **剔除** |

> C 与 H 被剔除不是因为它们不重要，而是因为**在"每日从对话打分"这个任务上不可观测**。它们仍然保留在 Layer 1 的 Trait 坐标里（标一次，用于人格画像与回弹参考）。这正是 §3 分层洞察的兑现。

### 4.2 表现层两个维度的存废与去共线

`verbosity`（话多话少）与 X 的 Sociability/Liveliness facet 高度重叠，`playfulness`（玩梗/反讽）与 Liveliness 也近。**直接并列会共线**，导致同一信号被计两遍。

处理方式：**保留，但给出互斥的操作性定义边界**，并用数据验证是否需要合并（§11）。

| 维度 | 操作定义（写进提示词，用于锚定模型） | 排除在外的语义 |
|---|---|---|
| `extraversion` | **社交能量与主动性**：是否主动开启话题、主动追问、情绪外放 | 不含"说了多少字" |
| `verbosity` | **表达量**：单轮回复的长度、是否展开细节 | 不含"主不主动" |
| `playfulness` | **语言游戏密度**：玩笑、反讽、玩梗、自嘲的使用频率 | 不含"情绪高不高" |
| `agreeableness` | **对抗性**：是否反驳、坚持己见、挑刺（低分 = 更有主张） | 不含"热不热情" |
| `openness` | **联想与好奇**：是否主动类比、展开、对新想法有兴趣 | 不含"话多" |
| `emotionality` | **情绪底色**：担忧、敏感、易受影响的表达密度 | ⚠️ 与当日 `mood` 易混（见下） |

### 4.3 emotionality 的两个特殊处理

1. **降权**：`mood` 是当日快变量，emotionality 是慢变量。若两者共用同一个 cap，模型会把"今天心情不好"当成"性格变敏感了"。
   → emotionality 的 `dailyDeltaCap` 单独设为 **0.08**（其他维 0.15）。
2. **提示词显式切割**：在 `INTROSPECT_SYSTEM` 中声明"`mood` 是今日心境（可每日大幅波动，不用在 dims 里重复）；`emotionality` 是情绪底色，只有当**连续多日**出现同类情绪表达时才微调"。

### 4.4 旧维度 → 新维度 的语义归属

| 旧维度 | 去向 | 说明 |
|---|---|---|
| `openness` | → `openness` | 同名同义，直接继承 |
| `warmth` | → `agreeableness` | 大五 warmth 本就是 agreeableness 的一个 facet |
| `assertiveness` | → `agreeableness` 的**负向** + `extraversion` 的 Social Boldness | HEXACO 无独立 assertiveness 轴；在维度描述中明确"agreeableness 下降 = 更愿意坚持己见、反驳用户"，语义不丢 |
| `verbosity` | → `verbosity` | 保留（表现层） |
| `playfulness` | → `playfulness` | 保留（表现层） |
| — | 新增 `emotionality` | 旧集合完全缺失"情绪底色"这一维，补齐 |

---

## 5. 重力回弹：Trait 如何决定波动中心与幅度

这是方案 A 相对现状**机制上**的增量，也是解决 §1.2 边界撞击的唯一手段。

### 5.1 现状的问题

`persona-drift.ts:373-378`：

```ts
cumulative[k] = clamp(before + dims[k], -cumulativeClamp, cumulativeClamp);
```

只有硬 clamp，没有向中心的回复力。只要 delta 存在系统性偏置（实测已证实存在），累积必然走向边界。

### 5.2 新机制：软带 + 超出加速的均值回复

```ts
const SOFT_BAND = 0.4;    // 自由漂移带：|cum - target| ≤ 0.4 时只有弱回弹
const REVERT_K = 0.2;     // 基准回弹系数

function revertPull(cum: number, target: number, k = REVERT_K): number {
  const d = cum - target;
  const over = Math.max(0, Math.abs(d) - SOFT_BAND);
  const coeff = k * (1 + over / 0.2);       // 超出软带后，每再偏离 0.2，系数翻倍
  return -coeff * d;
}

// 累积更新
cumulative[k] = clamp(prev[k] + delta[k] + revertPull(prev[k], targetOf(k)), -1, 1);
```

**行为特征**（target = 0，delta 恒为 +0.15 的最坏情况下）：

| 偏离 \|d\| | 回弹系数 | 单日回弹量 | 净增量 |
|---|---|---|---|
| 0.2 | 0.20 | −0.04 | +0.11 |
| 0.4 | 0.20 | −0.08 | +0.07 |
| 0.5 | 0.30 | −0.15 | **0（稳态）** |
| 0.7 | 0.50 | −0.35 | 强制回落 |

→ **稳态偏移 ≈ target ± 0.5**。即使模型天天给满 +0.15，累积也稳定在基线附近 0.5 以内，永不长期贴边；同时软带内保留足够的真实漂移空间。

### 5.3 State 维度 → Trait 基线的映射（回弹目标从哪来）

```ts
function targetOf(stateDim: string, trait: TraitBaseline): number {
  switch (stateDim) {
    case "extraversion":  return trait.X;
    case "agreeableness": return trait.A;
    case "openness":      return trait.O;
    case "emotionality":  return trait.E;
    case "verbosity":     return trait.X;              // 代理：表达量随外向性
    case "playfulness":   return (trait.X + trait.O) / 2; // 代理：玩心随外向与开放
  }
}
```

表现层两个维度在 HEXACO 里没有对应轴，用**代理映射**而非硬编码 0。

### 5.4 关于"波动幅度由 trait 决定"——必须说清的边界

- ✅ **文献支持的**：trait 是状态分布的**中心**（WTT），因此 trait 决定**回弹目标**（§5.3）。这是硬支撑。
- ✅ **文献支持的**：个体在"状态分布的**标准差**"上存在稳定的个体差异（Fleeson 2001：SD 稳定性 .59/.79）。因此**每个假人可以有自己的波动系数** `vol[k]`。
- ❌ **文献不支持的**：不存在"trait 水平 X 高 → 波动幅度就大"这样的简单线性映射。我没有找到支持该映射的证据。

因此设计上：
- `vol[k]` 是**每个维度 × 每个假人的独立参数**，初始取 1.0。
- 提供一个**工程启发式默认**（可覆盖）：`emotionality` 的 vol 随 `trait.E` 升高而升高。⚠️ **明确标注这是直觉启发式，不是文献结论**，默认关闭（`FAKEREN_DRIFT_HEURISTIC_VOL=0`）。

> 宁可留一个可调参数并承认它是拍的，也不要把猜测包装成"心理学表明"。

---

## 6. 数据结构与提示词变更

### 6.1 Trait 基线：`InstanceMeta.traitBaseline`

```ts
/** HEXACO 六维人格坐标，∈ [-1, 1]，0 = 常人均值。每个假人标一次。 */
export interface TraitBaseline {
  H: number;  // Honesty-Humility  诚实-谦逊
  E: number;  // Emotionality      情绪性
  X: number;  // Extraversion      外向性
  A: number;  // Agreeableness     宜人性
  C: number;  // Conscientiousness 尽责性
  O: number;  // Openness          经验开放性
}
```

**存哪**：`instance meta`（每假人不同，不能放 env）。
⚠️ 已知约束：`persona-drift.md:219` 已记录 sidecar `set_meta` 是**整块覆盖写**——UI 保存时必须带上原 meta 全文。traitBaseline 是**可重建的静态标注**（丢了可重新推断），因此塞 meta 可接受；演进链仍必须留在图里（该约束不变）。

**从哪来**（两条路，都支持）：
1. **自动推断（默认）**：实例创建 / 首次迁移时，用 LLM 读 `personaCore` 一次性打分，产出 `traitBaseline` 写入 meta，用户在 UI 上可改。
2. **手动标注**：设置面板六个滑块（0–100 → 映射 −1..1）。

### 6.2 drift 节点增加 `schemaVersion`

```ts
props: {
  kind: "persona_drift",
  schemaVersion: 2,        // ← 新增；v1 = 旧五维，v2 = 新六维
  dims: {...},
  cumulative: {...},
  traitTarget: {...},      // ← 新增：本次计算所用的回弹目标（可审计）
  revertPull: {...},       // ← 新增：本次实际施加的回弹量（可审计）
  ...
}
```

`loadDriftChain` 按 `schemaVersion` 过滤，避免 v1 节点被误读为当前状态（见 §7）。

### 6.3 提示词改造（治 §1.3 的正向偏置）

`INTROSPECT_SYSTEM` 需新增三条规定：

1. **给出当前偏离量**："当前各维度相对她的基线偏移为 `{cum - target}`，若今日对话**没有新证据**支持继续同向移动，请输出 0 或反向小增量。性格不会每天都变。"
2. **切割 mood 与 emotionality**（§4.3）。
3. **逐维操作定义**（§4.2 表格直接写进提示词），用于去共线。

### 6.4 evidence 引用修复（Q5）

**原则：no dangling edges。** 建不出真实边的引用就不建边，但要留下痕迹可审计——绝不能像现在这样"计数在涨、追溯为零"。

**① 上下文喂候选 id**（治根因）
`recentDialogue` / `recentMemoryTopics` 改为同时返回节点 id。提示词的对话段从

```
U: 你知道写故事的节拍吗?
A: 我建议先……
```

改为

```
[evt_7f3a] U: 你知道写故事的节拍吗?
           A: 我建议先……
```

并显式声明："evidence 必须从上述方括号 id 中选取，不要自己编造 id。"

**② 数据结构：引用与引文分离**

```ts
export interface DriftEvidenceRef {
  /** 图中真实存在的节点 id；缺失表示模型只给了引文、未对应到节点。 */
  nodeId?: string;
  /** 支撑判断的原文摘录（人读）。 */
  quote: string;
}
```

`DriftRecord` 新增 `evidenceRefs: DriftEvidenceRef[]`；旧字段 `evidence: string[]` 保留为兼容视图（= `evidenceRefs.map(r => r.quote)`），JSONL / UI 不破坏。

模型输出格式放宽为**两种都接受**：

```json
"evidence": ["evt_7f3a", {"nodeId":"evt_7f3a","quote":"她说……"}]
```

字符串元素 → `{ quote: <字符串>, nodeId: undefined }`（旧行为降级为纯引文）。

**③ 建边前校验 + 只计真实边**

```ts
const live = new Set((await this.store.query({ instanceId, limit: 1000 })).map(n => n.id));
for (const ref of refs) {
  if (!ref.nodeId || !live.has(ref.nodeId)) { evidenceSkipped++; continue; }
  await this.store.addEdge({ from: newId, to: ref.nodeId, kind: "relates", ... });
  evidenceEdges++;
}
```

`DriftExecutionResult.written` 增加 `evidenceSkipped: number`，UI 显示成 `evidence 边 2（悬空 3）`。
→ 追溯有效性从"黑盒"变成 §11 指标 5 可直接读数的东西。

**④ 不新增节点**：引文只作为 drift 节点 props 存，不为每条引文造节点（避免图被低价值碎片污染）。

---

## 7. 迁移：legacy 链怎么处理

现状：`ysj` 有 3 条 v1 真实记录，`wgg` 有 0 条（21 条全是 `no-dialogue` 跳过）。

**建议：归档 v1 链，v2 从零开始，不做逐维映射。**

理由：
1. **语义映射损失 > 保留价值**。`assertiveness → agreeableness 负向 + X`，一个维度裂成两个方向，映射后数值没有可信度。
2. **样本量只有 3 条**，且实测为恒定值（§1.1），本身几乎不含信息。
3. **不做映射 = 不需要写任何数据迁移代码**，只需 `schemaVersion` 过滤。旧节点保留在图里供日后审计，只是不参与累积计算。

代价：已累积的"性格倾向"归零，UI 上 ysj 的当前偏移会重置。**影响极小**——最大累积才 0.3，且本就是恒定偏置的产物。

若你倾向保留连续性，替代方案是：把 v1 的 `cumulative` 按 §4.4 映射进 v2 起点并打 `migrated: true` 标记。我建议走默认方案（不迁移），但这是你的决定。

**执行记录（2026-09-01）**：已按默认方案落地——v1 节点保留在图里，`loadDriftChain` 默认只返回 v2。
同时为两个存量实例补标了 HEXACO 基线（一次性迁移，经与 UI 按钮相同的路径）：

| 实例 | H | E | X | A | C | O |
|---|---|---|---|---|---|---|
| `ysj` 遗思静 | +0.30 | +0.40 | **−0.20** | +0.10 | +0.50 | +0.60 |
| `wgg` 王梗梗 | +0.20 | +0.30 | **+0.80** | +0.40 | +0.50 | +0.70 |

两人只在 X（外向性）上明显分野（−0.20 vs +0.80），与各自人设一致（遗思静内向、王梗梗话密爱玩梗）；C/H 两维模型给的都是中等正值——**这正是 §12-Q2 的不确定性**：模型对"诚实-谦逊"这类人设里没写的维度倾向于给保守中值。这两维反正不参与漂移，影响有限；E/O 是否可信要靠 §11 指标观察 2 周。

---

## 8. 配置与接口变更清单

### 8.1 配置（`src/leak/config.ts`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `FAKEREN_DRIFT_DIMS` | `extraversion,agreeableness,openness,emotionality,verbosity,playfulness` | 维度集合（覆盖机制不变） |
| `FAKEREN_DRIFT_REVERT_K` | `0.2` | 基准回弹系数 |
| `FAKEREN_DRIFT_SOFT_BAND` | `0.4` | 自由漂移带半宽 |
| `FAKEREN_DRIFT_DIM_CAPS` | `{"emotionality":0.08}` | per-dim 单日上限（缺省用 `DAILY_CAP`） |
| `FAKEREN_DRIFT_HEURISTIC_VOL` | `0` | 启发式波动幅度（§5.4，默认关） |

⚠️ `FAKEREN_DRIFT_DIMS` 默认值变更 = **破坏性变更**，需在 CHANGELOG 标注，并在 v0.5.0 发版说明。

### 8.2 代码改动点

| 文件 | 改动 |
|---|---|
| `src/types.ts` | 新增 `TraitBaseline`；`InstanceMeta` 加 `traitBaseline?` |
| `src/leak/config.ts` | 新增 §8.1 配置项；`PersonaDriftConfig` 加 `dims` 默认值、per-dim caps、回弹参数 |
| `src/agent/persona-drift.ts` | ① `DIM_LABELS` 换轴 + 中文名；② 累积计算加 `revertPull`；③ `targetOf` 映射；④ 提示词改造；⑤ `schemaVersion` 读写与过滤；⑥ per-dim cap |
| `src/agent/persona-drift.ts` | 新导出 `inferTraitBaseline(corePersona, llm): Promise<TraitBaseline>`、`revertPull`、`targetOf`、`DIM_DEFS` |
| `src/registry/instance-registry.ts` | `create(..., opts)` 的 opts 加可选 `traitBaseline`（内部/API 用） |
| `src/golem-instance-api.ts` | 同上 |
| `src/golem-remote.ts` | 新增 `getDriftDims()`、`inferTraitBaseline(id)` 两个 `@Remote` |

> **对 §8.2 的一处主动偏离**：原计划「`createInstance` 支持 `traitBaseline`」在 **remote 层不做**。
> `@Remote` 方法的【编译后形参名】即 wire 键（`methodParameterNames`），加参数要同步改
> `golem-remote-contribution.ts` 的 descriptor 且一旦不同步就静默丢字段（上次分层踩过同类坑）。
> traitBaseline 是**创建后仍可改**的标注，走已有的 `setInstanceMeta` 通道即可，收益相同、风险为零。
> registry / api 层的 opts 仍然加（服务端内部调用与测试用）。
| `client/ui-golem-config/src/types.ts` | `InstanceMeta` 加 `traitBaseline`；新增 `TraitBaseline` |
| `client/ui-golem-remote/src/golem-remote-contribution.ts` | 两个 meta schema 同步加字段（**漏了会被 strip**——上次分层时踩过） |

---

## 9. UI 变更

### 9.1 内省记录 tab：`DIM_ORDER` / `DIM_LABELS` 去硬编码

`DriftDashboard.tsx:14-21` 目前把维度名与中文标签写死在前端。维度一改，UI 立即对不上（新维度会渲染成裸 key，无中文名）。

→ 改为**从后端 `GET /<id>/drift-dims` 拉取** `{ key, label, pos, neg }[]`，前端只做渲染。

### 9.2 新增「人格坐标」面板

体现方案 A 的核心——**静态坐标 + 重力中心**：

```
诚实谦逊  ├─────●──────────┤   +0.1   （灰）仅作人格坐标，不参与每日漂移
情绪性    ├──────●─────────┤   +0.1   基线 +0.1 · 当前 +0.18
外向性    ├────●───────────┤   -0.2   基线 -0.2 · 当前 -0.05
宜人性    ├───────●────────┤   +0.3   基线 +0.3 · 当前 +0.42
尽责性    ├────────●───────┤   +0.5   （灰）仅作人格坐标，不参与每日漂移
开放性    ├───────●────────┤   +0.3   基线 +0.3 · 当前 +0.35
─────────────────────────────────────────────────────────
表达欲    ├───────●────────┤          基线 -0.2 · 当前 +0.10
俏皮度    ├────────●───────┤          基线 +0.4 · 当前 +0.60  ⚠ 接近软带边界
```

- **上六维 = HEXACO 人格坐标（Trait 层）**：灰点 = trait 基线（重力中心）。其中 **H / C 两维灰显**并标注"仅作人格坐标，不参与每日漂移"（Q3 裁定）——它们在闲聊文本中不可观测，强行打分只会变成噪声（§4.1）。
- **下两维 = 表现层**：在 HEXACO 中无对应轴，回弹目标用代理映射（§5.3）。
- 彩条 = 当前累积（从基线向两侧延伸）；超出软带（0.4）的维度高亮提示。
- 每维配一句白话注解（如"宜人性低 = 更爱抬杠"）。

### 9.3 实例配置：六个 trait 滑块

0–100 → 映射 −1..1，带"从人设自动推断"按钮（调 `inferTraitBaseline`）。

---

## 10. 测试用例（业务层）

沿用「做完再测」约定，整批实现完成后一次性跑。

**回弹机制（新增，核心）**
1. delta 恒为 +0.15、target=0 → 累积收敛在 ≈ +0.5，且 100 天后仍不越界。
2. `|cum - target| ≤ 0.4` 内 → 回弹系数 = `REVERT_K`（自由漂移带生效）。
3. `|cum - target| = 0.7` → 单日净增量为负（强制回落）。
4. target 偏移后（target=+0.6）→ 稳态中心随之平移到 ≈ +1.0 附近并稳定。
5. 回弹量写入节点 `props.revertPull`，可从图里读回审计。

**维度与配置**
6. `FAKEREN_DRIFT_DIMS` 覆盖生效；未列出的维度被丢弃。
7. per-dim cap：`emotionality` 返回 0.15 → 实际记 0.08；其他维仍 0.15。
8. `targetOf` 映射：`verbosity → trait.X`，`playfulness → (X+O)/2`。
9. `traitBaseline` 缺失 → 全部 target 退化为 0，功能不中断（降级不崩）。

**迁移**
10. v1 节点（`schemaVersion` 缺失）不进入 v2 累积计算。
11. v1 链仍在图中可读（未被删除）。

**trait 推断**
12. `inferTraitBaseline` 对同一段 core persona 连续调用两次 → 结果稳定（幂等，允许 ±0.1 抖动）。
13. LLM 返回非法 JSON → 回退全 0 基线，不抛异常。

**UI**（14/15 需浏览器点，已由契约测试把失效模式锁死，见下）
14. `GET /drift-dims` 返回六维定义；前端渲染无裸 key。
15. meta 保存后回读，`traitBaseline` 未被 schema strip（**上次分层踩过的坑，必须测**）。

> **⚠️ 14/15 的自动化替代**：这两个用例的失效点不在 UI 渲染，而在
> **strict zod codec 静默丢弃 schema 里没写的字段**——渲染逻辑再对，字段没了也是白搭。
> 该失效模式已由 `tests/remote-contract.test.ts`（28 例）在**协议层**锁死：
> `InstanceMeta` 全部字段必须出现在 4 条读取路径的 schema 与 setInstanceMeta 的 patch schema 里，
> `getDriftDims` 的载荷结构（`{drift, trait}`）与 HEXACO 键枚举（H/E/X/A/C/O）必须精确匹配。
> **已做变异验证**：从 `instanceMetaSchema` 删掉 `traitBaseline` → 4 条用例立刻红。
> 也就是说，UI 真正需要人工点的只剩「滑块拖得动、坐标条渲染好看」这类观感项，
> 字段丢失、wire 键漂移、方法缺失这三类**静默**故障不再依赖人眼。

**回归**
16. 现有 `tests/persona-drift*.test.ts` 全绿；`dsh-seams.test.ts` 上限仍为 6。
17. `tests/remote-contract.test.ts` 全绿（协议层契约，跨 remote 改动通用）。

---

## 11. 验证指标：怎么证明新维度比旧的强

不能"换了就完事"。实现后按下列指标观察 2 周（`ysj` 每日有对话的前提下）：

| 指标 | 计算方式 | 失败判据 | 判据含义 |
|---|---|---|---|
| **维度共线** | 逐对维度的 delta 皮尔逊相关 | 任意一对 r > 0.7 | 两维在测同一件事 → 合并候选 |
| **维度失效** | 某维度 delta 为 0 的比例 | > 80% | 该维度不可观测 → 剔除候选 |
| **贴边率** | `\|cum − target\| > 0.9` 的维度占比 | > 10% | 回弹参数不足 |
| **delta 方差** | 每个维度 delta 的标准差 | 接近 0（如 §1.1 的恒定值） | 提示词回归指令没生效 |
| **evidence 有效性** | evidence 能解析为真实节点 id 的比例 | < 50% | §1.4 缺陷未修，追溯仍失效 |

指标 1/2/4/5 已脚本化：**`scripts/drift-dim-audit.ts`**，直接从 JSONL 算，不依赖 LLM：

```
npx tsx scripts/drift-dim-audit.ts ysj      # 单实例
npx tsx scripts/drift-dim-audit.ts --all    # 全部
```

**它已能复现 §1.1 的人工排查结果**（对现有 3 天 v1 样本实测）：

```
[4] delta 方差    openness / playfulness / verbosity  stdDev = 0.0000  ✗ 近乎恒定
[1] 维度共线      openness×playfulness / openness×verbosity / playfulness×verbosity
                  assertiveness×warmth   r = 1.000  ✗
[5] evidence     不可审计 —— 3 条记录均为 v1（无悬空计数）
```

⚠️ **evience 指标只对 v2+ 记录生效**：v1 记录没有 `evidenceSkipped` 字段，而它记的 `evidenceEdges` 全是悬空边——若把 v1 算进来会得出"命中 100%"的虚假结论。这正是该缺陷之所以"静默"的原因，脚本里显式排除并给出"不可审计"提示。

样本 < 7 天时脚本会提醒"共线/失效/方差三项判据尚不可靠"（3 条样本下 r=1.000 极易是巧合），不假装统计显著。

---

## 12. 风险与开放问题

| # | 问题 | 状态 / 说明 |
|---|---|---|
| Q1 | `emotionality` 与 `mood` 的边界模型真能守住吗？ | **开放**。已降 cap + 提示词切割。**这是本次最大的不确定性**，需靠 §11 指标 4/5 与人工抽样审 rationale 验证 |
| Q2 | Trait 基线谁标？自动推断准不准？ | **开放**。默认 LLM 推断 + 人工可改。推断质量看 §10 用例 12 稳定性，不稳就改成"创建实例时强制标六滑块"。⚠️ **不做内省时静默写回 meta**——`set_meta` 是整块覆盖，与 UI 编辑并发会丢改，故只在用户点按钮时写 |
| Q3 | UI 要不要露出 H/C 两个不参与漂移的维度？ | ✅ **裁定：露**，灰显并注明"仅作人格坐标，不参与每日漂移"。六维每维配一句白话注解（如"宜人性低 = 更爱抬杠"） |
| Q4 | 回弹会不会压掉真实漂移？ | 软带 0.4 内自由漂移，超出才强回弹。参数（SOFT_BAND / REVERT_K）外置可调，按 §11 贴边率指标调 |
| Q5 | evidence 悬空边是否同批修？ | ✅ **裁定：修**，与本次同批，设计见 §6.4 |
| Q6 | HEXACO 还是大五做 Trait 层？ | ✅ **裁定：HEXACO** 六维（H 维对"这个人是谁"表达力强） |
| R1 | 换维度后旧 UI / 旧记录的兼容 | 已用 `schemaVersion` + 后端下发维度定义两处兜住 |
| R2 | `FAKEREN_DRIFT_DIMS` 默认值变更是破坏性变更 | 需在 v0.5.0 CHANGELOG 显著标注 |

---

*本文档基于 2026-09-01 对 `golem` 仓库代码与 `~/.fakeren/drift-reports/` 真实运行数据的核查撰写。§1 全部为该数据的直接读数，§2 全部为可检索文献。*
