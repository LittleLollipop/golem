# 假人 · 需求补强：记忆基座（lobster-memory 等效）— PROPOSED

> **状态：提案，待用户确认后并入 `requirements.md` 并录入语义图。**
>
> 用户拍板：
> - **C1 = A 诚实降级**（已入图 `dec_c1_247`）：只在 `dsh web` 常驻期间有潜意识，人关程序即停；因可长期开着程序解决，非关键问题。选项 B（外部调度器+自有持久 ambient 存储）本轮不做。
> - **需求层不完整**：现有需求只描述了*漏出机制*（L0/L0.5/L1 三通道、衰减、分级、后筛），却没把*记忆基座本身*定义为需求。假人本质上 = lobster-memory 的记忆能力 + 在其上叠加的 ambient 漏出层。**至少要有 lobster-memory 的等效完整能力**，且要把以前的经验和已解决的问题一并纳入。
> - **记忆存取 = axolotl_rs 唯一**（已入图 `dec_memory_axolotl_only`）：假人运行时的记忆与日志**完全走 axolotl_rs 图存储**，**全面否定任何文档/文件形式的记忆与日志**（无 markdown/json 记忆日志、无并行文件态）。开发文档（docs/、se-semantic-graph）与 dsh 会话记录不在此列。理由：axolotl_rs 已构建（Rust 图、本地、跨进程持久可见），顺带规避 dsh `storageDomain` 的 H3 进程内限制。
> - **抽取时机是架构层的事**（已入图 `br_extract_separate_phases`）：建记忆（写）和读记忆漏出（读）分属不同阶段/环节，时机不冲突；具体管线（抽取器单/双消费者）留阶段三架构定，需求层不约束。

---

## 1. 缺口分析：lobster-memory 完整能力 vs 假人现有需求

lobster-memory（v0.2.2）的核心能力，逐条对照假人 `requirements.md`：

| lobster-memory 能力 | 假人现有需求 | 判定 | 说明 |
|---|---|---|---|
| 持久图记忆基座（实体-关系-情绪 valence 图，跨会话持久） | — | ❌ **缺失** | `req_l0_real_history_drift` 假设"会话事件日志"作基质，但那是 dsh 的事件流，**不是可查询的记忆图**；假人没有"agent 对自己/用户/世界积累的知识图"这一需求 |
| 自动抽取（每轮从对话抽取实体/关系/反馈入图） | — | ❌ **缺失** | 无"agent 自动从对话建记忆"的需求 |
| 目标导向回忆（`recall(keywords)` / `recall_feedback(valence)`） | 图检索通道 | ✅ 已覆盖 | 由 `RecallChannel` + `MemoryReader.recall` 服务，是*自己的记忆图*召回（非外部事实） |
| 可观察巩固/遗忘（评分→留/剪/合并，产出报告） | `req_ambient_decay_stream` | ⚠️ 部分 | 那是 *ambient 流*衰减，不是 *记忆图*巩固；记忆图自身的巩固/遗忘缺失 |
| 情绪 valence | — | ❌ **缺失** | 无 valence 维度 |
| 因果边 | — | ❌ **缺失** | 无"事件间因果"需求（真实偶然性的载体） |
| 递归自成长抽取 | — | ❌ **缺失** | 无"记忆图从其自身内容递归生长"需求 |
| 跨域弱边（漂移种子的图结构基础） | `req_l0_real_history_drift`（行为） | ⚠️ 隐含 | L0 漂移描述了"周边采样"行为，但没定义*承载它的图结构*（陈旧/周边节点间的弱关联边） |

**结论**：最大的新维度是「记忆基座」——假人需要 lobster-memory 那套持久图记忆作为一切漏出层的地基。现有需求假定这块"免费存在"，但它必须被显式定义，否则阶段三架构会建在流沙上（这正是会话早前认定 lobster-memory 离散图"是被逃离的 L2"的反面——此处 axolotl 仅作*项目 traceability*，而假人运行时*需要*一个等效的记忆图作 substrate）。

---

## 2. 提案：新增维度 H. 记忆基座（lobster-memory 等效）

| # | 需求 | M/W/N | 对应 lobster 能力 | 与现有需求的边界 |
|---|---|---|---|---|
| `req_memory_graph_substrate` | 持久图记忆基座：实体-关系-情绪 valence 图，跨会话持久化，**本地存储复用 axolotl_rs**（已决：存取全走 axolotl_rs，否文件式记忆/日志） | **M** | 持久图记忆基座 | 地基；L0/L0.5/L1 三通道都建在其上 |
| `req_memory_auto_extract` | 自动抽取：每轮从(用户输入, 回复)抽取实体/关系/反馈写入图，LLM 复用自身（无第二模型） | **M** | 自动抽取 | 独立于 ambient 漏出；是"建记忆"不是"漏记忆" |
| `req_memory_recall_targeted` | 目标导向回忆：`recall(keywords)` + `recall_feedback(valence)`，供 agent 偏置判断、非机械复述 | **M** | 回忆/按需查询 | 与图检索通道同源：这是*自己的记忆图*召回（recall/recallFeedback），图检索通道即承载该召回，不引入外部事实源 |
| `req_memory_consolidation` | 可观察巩固/遗忘：多信号评分→留/剪/合并，定期或容量超限触发，产出巩固报告（剪了什么/合并了什么群落） | **M** | 巩固/遗忘 | 与 `req_ambient_decay_stream` 区分：这里是*记忆图*巩固，那里是*ambient 流*衰减 |
| `req_memory_valence` | **AI 自身情绪**（非 lobster-memory 的用户情绪）：节点/边带多维情感信号（AI 对实体/事件*自己的*感受，褒/贬/惧/恋…），支持按 valence 回忆与漂移加权 | **M** | 情绪 valence | **关键差异见下方"与 lobster-memory 的本质不同"** |
| `req_memory_causal_edges` | 因果边：事件/实体间因果链接（非纯相关），真实偶然性的载体 | **M** | 因果边 | — |
| `req_memory_recursive_growth` | 递归自成长抽取：记忆图可从其自身内容递归抽取，持续生长 | **M** | 递归自成长抽取 | — |
| `req_memory_crossdomain_edges` | 跨域弱边：陈旧/周边节点间的弱关联边，是 L0 漂移种子的物理载体（漏出机制的图结构基础） | **M** | 跨域边（本工程核心） | 与 `req_channel_separation` / `req_l0_real_history_drift` 互补：那里定义"行为"，这里定义"结构" |
| `req_l0_emotion_coupling` | **L0/L0.5 情绪耦合**：漂移通道被 AI 自身情绪加权——AI 自己情绪越强的记忆/事件，越容易进入 L0 漂移种子池、漏出权重越高 | **M** | （新增，bridging H↔A 维） | 把"情绪"接入漏出机制；依赖 `req_memory_valence` |

> 注：以上 8 条默认全 M（"等效完整能力"）。存储已决 = axolotl_rs 唯一，否文件式记忆/日志（见 `dec_memory_axolotl_only`）。Q1（是否全收）见第 4 节"说人话"版。

### 与 lobster-memory 的本质不同（用户 2026-08-23 拍板，关键分水岭）

维度 H 是"等效完整能力"，但**有一处语义被重新定义**，不能照搬 lobster-memory：

- **lobster-memory 的 valence = 用户的情绪**：记的是"用户夸了 / 骂了这条记忆"——是对*用户反馈*的标注。
- **假人的 valence = AI 自己的情绪**：记的是"AI 对这件事*自己*的感受"（褒 / 贬 / 惧 / 恋…）——是模拟的**第一人称情感（affective response）**，不是用户情绪标签。

**为什么必须这样**：人感不来自"记录用户心情"，而来自"自己活过的事在自己身上留下的情绪痕迹"。所以假人的 valence 是潜意识漏出的**驱动源**，而非 lobster 里那种"用户反馈记录"。

**结构性后果（写进两条需求）**：
1. `req_memory_valence` 重定义为 AI 自身情绪（已改上表）。
2. 新增 `req_l0_emotion_coupling`：L0/L0.5 漂移被这个自身情绪加权——AI 自己情绪越强的记忆/事件，越容易进入漂移种子池、漏出权重越高。这把"情绪"从 lobster 的"反馈记录"转成了假人的"潜意识驱动"。

> **边界纪律（防混淆）**：L1 处境通道在"理解用户当前状态"时*可能*涉及用户情绪，但那是 L1 的语义，与记忆 valence 是两回事。记忆 valence 始终是 **AI 自身情绪**，不存用户情绪标签。

---

## 3. 与既有纪律的对齐（把"以前的经验和已解决的问题"固化进需求）

这些不是新能力，而是早前已决议、需显式挂到记忆基座维度的纪律，避免阶段三遗忘：

- **`rule_mechanism_first`（机制正确优先 / 禁 fabricated）**：记忆基座的抽取与巩固**绝不可编造**内容；自动抽取失败时静默跳过（lobster 既有纪律），不报错、不补虚构。
- **`decision_l1_redefined_situational` / 三通道分离**：记忆图内的"目标导向回忆"（H 维 `req_memory_recall_targeted`）属*图检索通道*语义，与 L0 漂移（非目标漏出）物理隔离，不得借道彼此（呼应 C2 禁 sessionQuery 用于漂移）。
- **`decision_host_modality_agnostic`**：记忆基座存储的是"信息"，不规定其模态语义；感官内容的深度语义由各扩展组件负责。
- **`req_local_only`**：记忆图全本地持久，不出网。

---

## 4. 待确认点（已全部闭环 ✅）

**✅ Q2 已决（实现归属）**：记忆存取 = axolotl_rs 唯一，全面否定文件/文档式记忆与日志（`dec_memory_axolotl_only`）。阶段三只需在 axolotl_rs 上设计图 schema 与读写 API，不做任何文件态记忆。

**✅ Q3 已决（抽取时机）**：建记忆（写）与读记忆漏出（读）分属不同环节，时机不冲突（`br_extract_separate_phases`）。具体管线（单/双抽取器）阶段三架构定，需求层不约束。

**✅ Q1 已决（全收 + 情绪重定义）**：用户拍板——**8 样本事全收 M，不降级**；且额外两点：
1. **L0/L0.5 必须与情绪连接** → 新增 `req_l0_emotion_coupling`（漂移被 AI 自身情绪加权）。
2. **valence 重定义为 AI 自身情绪**（非 lobster 的用户情绪）→ 见上方"与 lobster-memory 的本质不同"。

> 维度 H 现已完备：8 条原能力（全 M）+ 1 条新增耦合（M）= **9 条需求**，加 1 条关键决策 `dec_valence_ai_self`。下一步：正式并入 `requirements.md` 维度 H + 全录入语义图，然后进阶段三架构评审。
