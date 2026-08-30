# 假人基础人设分层（Persona Layering）设计文档 v0.1

> 状态：**已实现**（2026-08-30，代码已落地，待发版）
> 日期：2026-08-30
> 目标：把 base persona 拆为「常驻核心（core）+ 图库扩展（extended）」。core 每 session 注入、ext 进 axolotl 图库按需 recall，降低 token / 注意力成本、理顺与 drift 的分工，并让长期人设事实可经图记忆召回。
>
> 配套调整：每轮 `memory_recall` 调用上限由 3 提至 6（`src/recall-budget.ts` 的 `RecallBudget(6)`）。

---

## 1. 目标与非目标

### 目标

1. **base 精简**：每 session 注入的 persona 只含"身份锚 + 红线 + 维度基线 + 护栏指令"，长度收敛到几十~一百字级。
2. **人设事实进图**：背景故事 / 关系 / 偏好实例 / 历史事件等拆进图库，靠现有 dual-mechanism recall（push-hint + `memory_recall`）按需拉取。
3. **初始化 seed**：实例创建 / 迁移时把 ext 写入图、连到身份节点，使图库成为人设事实的"单源"。
4. **安全守门**：红线 / 身份 / 维度基线绝不进入 recall 路径；recall 失败仅降级细节、不危及身份与安全。

### 非目标

- 不改"每 session 注入一次"的节奏（仅缩小注入内容）。
- 不动 drift 维度基线的"不可变锚"语义，只把锚从"整段 persona"缩为"core"。
- 不做第二套召回机制；复用现有 recall。
- 不自动删除现有 `meta.persona` 字段（保留作兼容 fallback）。

---

## 2. 现状核查（已实测，非推断）

| 项 | 实测结论 | 证据 |
|---|---|---|
| persona 存储 | 单一字符串，存 axolotl 图 `__meta__` 顶点 | `instance-registry.ts:32` `set_meta` → sidecar `set_meta` → `meta_json` |
| persona 注入 | 压成 `channel="persona"` 块，每 session 仅一次 | `golem-agent.ts:96-105` 生成；`dsh-seams.ts:198-210` `personaSeen` Set 去重 |
| 注入内容 | base 全文 + 【近期性格倾向】段 | `index.ts:204` `composeEffectivePersona(meta?.persona ?? DEFAULT_PERSONA)`；`persona-drift.ts:416` 追加段 |
| drift 锚 | base = `getMeta(instanceId).persona`，不可变 | `persona-drift.ts:245,329` |
| 人设进图 | **无**：`writeTurn` 只抽"对话"，未把 persona 设定 seed 进图 | `memory/writer.ts:80-109` `HeuristicExtractor` / `llm-extractor.ts` 仅消费 `TurnInput`（用户说 + 助手答） |

结论：当前 base 全文每 session 常驻，且人设设定本身**未进图库**——长背景"占 base 又不进图"，正是本次要解的点。

---

## 3. 分层边界（关键决策）

### 3.1 常驻 core（每 session 注入，不可拆）

- **身份锚**：我是谁、第一人称、角色边界。
- **红线 / 不可违背指令**：如"不声明自己是 AI / 没有身体"等。
- **性格维度基线定义**：5 维基准值，drift 偏移的 0 点参照。
- **行为护栏指令**：如 memory-first 类操作指令（若走 persona 通道）。

### 3.2 进图 ext（按需 recall，可拆）

- 背景故事（经历、来历）。
- 关系网络（豆豆、朋友、家人）。
- 具体偏好 / 禁忌实例（"喜欢雨天听歌""讨厌 X"）。
- 历史事件 / 记忆片段。

### 3.3 铁律

红线 / 身份 / 维度基线 **绝不** 进入 recall 候选集。recall 失败仅丢失"细节背景"，不影响身份与安全——这与红线丢失的后果有本质区别（红线是安全底线，细节是体验细节）。

---

## 4. 数据结构

### 4.1 实例元数据

- 新增 `meta.personaCore`：常驻核心（短）。
- 新增 `meta.personaExt`（可选）：人设设定原文，作图库 seed 的真相源。
- 保留 `meta.persona` 作兼容 fallback（见 §8）。

### 4.2 图库节点

- `persona-identity`（Entity，常驻锚，**不靠 recall**）：由 core 派生，稳定 id，永远在场。
- ext 事实 → Entity / Event 节点，以 `relates` 边连到 `persona-identity`。
- seed 复用现有 `MemoryWriter` / `LlmExtractor` 管线（消费 `personaExt` 而非对话），不新建抽取通道。

---

## 5. 召回路径（复用现有 dual-mechanism）

- **常驻注入**：`composeEffectivePersona` 改为 `personaCore + 维度基线 + 累积倾向`（不含 ext）。
- **ext 召回**：靠现有 `memory_recall`（模型主动拉完整节点）+ 每回合 `push-hint`（只提示相关标签、不刷全文）。无需新机制。
- **收敛效果**：每 session 注入显著变短；背景细节在模型需要时经 recall 命中。

---

## 6. 红线守门与兜底

- 红线 / 身份 / 基线只在 core，从不进 recall 集 → recall 拉不到也拉不到它们。
- **兜底降级**：recall 失败时缺失的仅是 ext 细节，对话仍可基于 core 身份继续，可接受。
- **防编造**（可选）：在 core 末尾加一句操作指令——"若不确定某背景细节，以本段身份设定为准，必要时经 `memory_recall` 补充，不得臆造"。降低模型凭空编人设的概率。

---

## 7. 与 drift 的关系

- drift 维度基线定义在 core，稳定不变；累积偏移仍相对它。
- effective persona 合成不变：`core + 基线 + 累积倾向`。
- 内省时 base 锚 = `personaCore`（而非整段），模型只看核心身份做漂移判断，更聚焦、更抗 base 噪声。

---

## 8. 迁移与兼容性

- `createInstance` 新增可选 `personaCore` / `personaExt` 参数；旧 `persona` 保留。
- 读取兼容：若只有旧 `persona`，运行时按启发式切分（身份 / 红线 / 维度句留 core，其余归 ext）或提示用户重设；old field 始终作 fallback。
- 已有实例：启动检测无 `persona-identity` 节点则补 seed（把 ext 写图）。
- 不破坏现有实例，不删字段。

---

## 9. 配置项（外置，沿用 leak/config.ts 风格）

- `FAKEREN_PERSONA_LAYER_ENABLED`（默认 true）
- `FAKEREN_PERSONA_CORE_MAX`（可选，core 超长告警）
- seed 行为可经同一 config 块收敛。

---

## 10. 验收 / 测试标准

### 单元

- `composeEffectivePersona` 输出不含 ext 全文；含 core + 基线 + 倾向。
- seed 后 ext 节点进图且 `relates` 连到 `persona-identity`。
- `memory_recall` 能按标签命中 ext 细节。
- 红线 / 身份 / 基线只出现在 core、不在 recall 候选。

### 集成

- 新 session 注入长度显著下降。
- 对话中提及背景（如"豆豆"）时 recall 命中对应节点。

### 回归

- drift 仍正常（基线在 core）；effective persona 合成等价。

---

## 11. 风险与开放问题

- **抽取失真**：seed 依赖 `LlmExtractor`，已知抽取边可能失真 → ext 节点可能不准。缓解：`personaExt` 是结构化设定原文，seed 时优先"按段落 / 条目解析"而非纯 LLM 抽取；或允许用户编辑 seed 结果。
- **召回时机**：模型可能不主动 recall。缓解：push-hint 提示 + core 防编造句兜底。
- **core / ext 切分主观**：缓解：身份 / 红线 / 维度句规则化识别 + UI（后续）让用户在设置里编辑 core vs ext。
- **UI 增强（开放）**：是否在「假人」设置面板提供 core / ext 双栏编辑？

---

## 12. 实施步骤（已全部落地）

1. ✅ 数据结构：`instance-registry` / `golem-instance-api` 加 `personaCore` / `personaExt` 字段 + 兼容读取（`types.ts` `InstanceMeta`）。
2. ✅ `composeEffectivePersona` 改用 core：`resolveCorePersona(meta, fallback)`（`persona-drift.ts`）——优先级 `personaCore > persona > fallback`。
3. ✅ seed 管线：`src/memory/persona-seed.ts`（`PersonaSeed.ensureSeeded`，幂等）——创建 / 迁移时把 ext 经 `MemoryWriter.writePersonaExt` 写图、连 `persona-identity` 锚。复用现有抽取管线，不新建通道。
4. ✅ 注入收敛：core 经 `composeEffectivePersona` 每 session 注入；ext 出 recall 路径（`index.ts` pre-step 懒 seed）。
5. ✅ 配置项并入 `leak/config.ts`（`loadPersonaLayerConfig`：`FAKEREN_PERSONA_LAYER_ENABLED` / `FAKEREN_PERSONA_CORE_MAX` / `FAKEREN_PERSONA_ANCHOR_ID`）。
6. ✅ 测试：`tests/persona-layering.test.ts`（resolveCorePersona 优先级 / writePersonaExt 连锚 / PersonaSeed 幂等）。
7. ⬜ （可选）设置面板 core / ext 双栏编辑——未做，留待后续。
