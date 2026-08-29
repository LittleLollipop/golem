# 双机制记忆检索：自动注入（指针）+ 模型主动反查（`memory_recall`）

> 状态：v0.2 设计草案（已纳入评审反馈：指针不必 in-character、护栏须告知模型、S1/S2 查源码确认无需 spike）
> 作者：golem 协作（架构方向由 sai 定，文档由助手整理）
> 关联：# 渗漏修复 `1230ffe`、recall-channel.ts、golem-agent.ts:assemble()、dsh `system-prompt` 工具注册 API

---

## 1. 背景与动机

### 1.1 现状（单机制：自动全量注入）

记忆检索目前**只有一条自动链路**，发生在每个回合的 `step 1`：

- `golem-agent.ts:assemble()` 无条件调用 `recall.gather(userText, instanceId)`（`golem-agent.ts:65`，注释明确 "recall is ALWAYS on"）
- `RecallChannel.gather`（`recall-channel.ts:56`）从**用户发言**抽关键词（`toKeywords`）→ 经 sidecar `POST /{id}/recall` 做**图遍历**（关键词/2-gram 匹配节点 label+props，**非 embedding/RAG**）→ 把命中的**完整内容**作为"内心活动"块注入模型上下文

### 1.2 这套设计的天花板

1. **模型零主动性**：recall 完全由用户字面词触发。模型内部"想记起某事"但用户文本没出现匹配词 → 查不到。
2. **全量注入 = token 贵 + 上下文肥胖**：每次都把命中节点的整段 `assistantSummary` 灌进 pre-step，且受 `limit=3` 硬截断，触达量有限。
3. **匹配是图遍历而非语义**：换种说法就 hits 不到（paraphrase 不友好）。

### 1.3 用户决策（2026-08-29）

> "两套机制都需要。模型能自行反查记忆，我就可以只漏关键词给它，能漏出来的记忆量会大幅上升。"

即：**自动链路降级为"只漏指针/关键词"，模型用 `memory_recall` 工具主动把完整内容拉回来**。单次注入 token 大降，可触达记忆总量反升。本质是拆分"提示记忆存在"（push-hint）与"取出记忆内容"（pull）。

---

## 2. 目标与不可破原则

- **`rule_mechanism_first`（禁编造）红线**：工具返回 = 真实图命中，绝不合成记忆。
- **不触发 `1230ffe` 已锁的回归**：工具调用轮（`step>=2`）不注入 leak / 不调用 `assemble`；`memory_recall` 走 dsh 原生 tool 通道，**不进 assemble/leak 链路**。
- **预算可控**：模型主动调用不能无限膨胀成本（见 §6）。
- **指针块不必强求 in-character（评审修正 2026-08-29）**：指针块的职责是"提示记忆存在 + 触发工具调用"，不是像现状 leak 块那样被织进对白。因此用干净的"记忆索引"式呈现（如"可回想：橘猫豆豆 / 旧相机故障"）比裹成角色内心独白更贴合其功能；in-character 与否差异不大。真正的角色化发生在 `memory_recall` 拉回的**完整内容**被模型吸收并重述时——那部分仍走 in-character 路线。

---

## 3. 双机制架构

```
                        用户发言
                            │
            ┌───────────────┴────────────────┐
            ▼                                ▼
   【机制 A：push-hint 自动】          【机制 B：pull 模型主动】
   pre-step (step 1)                   模型推理中自行决定
            │                                │
   RecallChannel.pointers()          调用 tool: memory_recall(query, limit?)
   只抽 node label / 关键词            │
            │                                │
   注入为「你想起：橘猫豆豆、           RecallChannel.fetch(query)
   旧相机故障…」的轻量指针块           → sidecar /recall → 真实节点
            │                                │
            └───────────────┬────────────────┘
                            ▼
                    模型综合两类上下文作答
        （指针提示"有什么"，工具拉回"具体是什么"）
```

- **机制 A（自动·指针）**：`step 1` 仍跑，但 `RecallChannel` 拆出 `pointers()`——只返回命中标签/关键词的**轻量清单**（不返回 `assistantSummary` 全文）。呈现为干净的"记忆索引"式提示（"可回想：橘猫豆豆 / 旧相机故障"），意在触发模型调用 `memory_recall`，**不必裹成角色内心独白**（评审修正 2026-08-29：指针的 in-character 与否差异不大，其功能是触发而非被织入）。
- **机制 B（主动·拉取）**：模型看到指针后，按需调用 `memory_recall(query)`，取回完整内容作为 `tool_result`。

### 3.1 去重

若机制 A 已提示某节点指针，模型再 `memory_recall` 同一节点——属正常放大，不冲突；`tool_result` 是模型显式索取，优先级高于自动指针。无需额外去重逻辑，但 `limit` 与预算（§6）共同约束总量。

---

## 4. 工具契约：`memory_recall`

| 项 | 定义 |
|----|------|
| 名称 | `memory_recall` |
| 注册点 | `golem` 插件 `apply(ctx)` 内，加 `inject:["tools",...]` 后调 `ctx.tools.register({...})`（dsh cordis 教程同形）|
| 参数 | `query: string`（必填，检索词）；`limit?: number`（可选，默认 5，受 §6 上限钳制）|
| 隐含参数 | `instanceId`——从当前 session 上下文取（同 `assemble` 现有取法），不暴露给模型 |
| 实现 | 复用 `RecallChannel.fetch()` / `GraphRecallSource.recall()` → sidecar `POST /{id}/recall`（图遍历，与现状同 substrate）|
| 返回 | 命中图节点：`label` + `assistantSummary`（优先）/ `assistantText`（回退），经 `output.render` 转为 dsh `tool_result` 文本块 |
| 渲染 | `render(_a, v) => [{ type: 'text', text: v }]`（与 dsh `preset_check` 示例同形）|

### 4.1 dsh 注册接法（已核实可行）

dsh `system-prompt` 层提供 `tools(provider)`（`packages/core/system-prompt/src/index.ts:481`），cordis 插件可通过：

```js
inject: ['tools', /* 现有 deps */],
apply(ctx) {
  ctx.tools.register({
    name: 'memory_recall',
    description: '回想你自己的记忆图：用检索词拉回相关的往昔对话与心事。每回合最多调用 3 次，只在确有需要、且指针提示里有对应记忆时才调用；优先回想最相关的一条。',
    parameters: {
      query: { type: 'string', required: true },
      limit: { type: 'number', required: false },
    },
    output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
    async execute(args, exec) {
      const instanceId = instanceIdFromAgent(exec.agent); // 复用 dsh-seams.ts:120-128
      const nodes = await recallSource.recall(instanceId, [args.query], args.limit ?? 5);
      return nodes.map(n => `〔${n.label}〕${n.props?.assistantSummary ?? ''}`).join('\n');
    },
  });
}
```

> 证据：dsh 自带 cordis 教程 `docs/cordis-tutorial/07-into-the-harness.zh.md:49` 明确 `inject:['tools']` + `ctx.tools.register({...})`（`defineTool` 负责参数校验与 `output.render`）；`packages/core/tools/src/index.ts:235` 的 `execute(args, exec)` 返回值即回传模型的 `tool_result`，且 `exec.agent`（`index.ts:326`）提供当前 session 的 `instanceId` 取法——正是机制 B 所需。

---

## 5. 对现有通道的影响

| 组件 | 变化 |
|------|------|
| `RecallChannel` | **拆分**为 `pointers(userText)`（机制 A，只返标签/关键词）与 `fetch(query)`（机制 B，返完整节点）。二者共用 `GraphRecallSource`。 |
| `golem-agent.assemble()` | `step 1` 调用 `pointers()` 而非 `gather()` 全文；注入的块文案改为"你隐约想起：…"的指针语气。 |
| `drift` / `situational` | **不变**——仍是潜意识泄漏层，与检索解耦（C2 hard rule 保持）。 |
| `leak post-filter` | **不动**——`memory_recall` 结果走 dsh 原生 tool 通道，不进 leak/assemble，天然不触发 `1230ffe` 已锁的"工具轮注入"回归。 |
| `dsh-seams.step>=2` 闸门 | **已锁**：工具循环轮不注入 leak/不调 `assemble`，`memory_recall` 调用本身落在 `step>=2`，本就不在 assemble 路径内。 |

---

## 6. 成本与护栏（必须有，否则不可上线）

1. **每回合调用预算**：单个回合内 `memory_recall` 调用次数上限（建议 `≤3`）。
   - **护栏规则必须明确告知模型（评审修正 2026-08-29）**：服务端静默封顶会让模型在不知情下白白浪费调用、还以为拿到了结果。因此两条都要做：
     - **工具描述里写清上限与优先策略**——见 §4 `description`，已含"每回合最多 3 次、只在确有需要时调用"；
     - **超限时 `execute` 返回明确信号**（如 `"〔本回合记忆检索已达上限 3 次，剩余内容请基于已有上下文作答〕"`），让模型立即停止重试、改用已有信息。
2. **返回长度上限**：单工具结果 `assistantSummary` 拼接后截断（如 `≤1200` 字），防止单节点巨内容撑爆上下文（截断同样在结果里标注"已截断"）。
3. **提示词约束**：在人格/系统层加一句"只在确有需要时回想，不要每条消息都检索"，把过度调用压在模型侧（与第 1 条工具描述双重约束）。
4. **预算状态**：预算计数需跨 `step` 维持（挂在 session/instance 状态上，非闭包局部变量），否则工具循环会重置计数。

---

## 7. 未决 / 待 spike 项

> 2026-08-29 复核（查 dsh-src 源码）：**S1、S2 已实证无需 spike，从"待验证"降为"已确认"**。

- ~~**[S1] golem TS 插件如何拿 `harness`**~~ ✅ **已确认**：dsh 自带 cordis 教程（`docs/cordis-tutorial/07-into-the-harness.zh.md:49`）用的就是我们 golem 插件已在用的同一模式——`inject: ['tools']` + `apply(ctx)` 内 `ctx.tools.register({...})`。`harness.registerTool/defineTool` 仅是 preset/skill 的封装写法，我们的插件直接走 `ctx.tools.register` 即可，无需引入 `harness` 自由变量。**风险消除**。
- ~~**[S2] `instanceId` 在工具调用上下文的取法**~~ ✅ **已确认**：`ToolProvider.execute(args, exec)` 的 `exec: ToolRunContext` 携带 `exec.agent`（`packages/core/tools/src/index.ts:326`，"agent on whose behalf the call runs"），即 pre-step 里 `ev.agent` 同一对象。故 `instanceId` 取法 = `dsh-seams.ts:120-128` 已实现的 `ev.agent.session` 提取逻辑，直接复用。**风险消除**。
- **[S3] 工具结果在 dsh web UI 的呈现**：唯一仍待核实项——确认 `memory_recall` 的 `tool_result` 显示为普通工具消息（而非 injected 块），避免与 leak 视觉混淆。属 UI 细节，不影响架构。
- ~~**[S4] 指针块的文案与"似有所忆"语气**~~ ⚠️ **评审修正**：指针块**不必**裹成角色内心独白（见 §2 原则、§3 机制 A）。其功能是"提示存在 + 触发工具调用"，干净的"记忆索引"式呈现更合适；in-character 与否差异不大。故 S4 不再是硬性要求，降为可选润色。

---

## 8. 验收 / 测试用例（业务层）

- **单元（RecallChannel 拆分）**：`pointers()` 只返回标签/关键词、不含 `assistantSummary` 全文；`fetch(query)` 返回完整节点。
- **集成（机制 B 贯通）**：模拟模型调用 `memory_recall("橘猫")`，断言 `tool_result` 含真实节点 `〔橘猫豆豆〕…`，且**不经过** `assemble`/leak 链路（与 `1230ffe` 测试同款断言）。
- **回归（不破既有）**：
  - `step>=2` 不注入 leak（已有测试锁定）。
  - 机制 A 在 `step 1` 注入的是**指针**而非全量（新增断言）。
  - `memory_recall` 调用轮不触发 leak 注入（新增断言）。
- **预算（§6）**：连续调用 >3 次时第 4 次返回上限提示；单结果超长被截断。

---

## 9. 实施顺序建议（评审通过后再让龙虾动手）

1. **S3 唯一 spike**：确认 `memory_recall` 的 `tool_result` 在 dsh web 的呈现（普通工具消息 vs injected 块）。S1/S2 已查源码确认无需 spike（见 §7）。
2. `RecallChannel` 拆分 `pointers` / `fetch`。
3. `assemble()` 改调 `pointers()`，指针文案重写。
4. 接 `memory_recall` 工具 + 预算护栏（§6）。
5. 补 §8 测试，跑 `vitest` + 手动会话验收。
6. 提交、重启 `dev-up.sh`、推送。

---

## 10. 实施记录（2026-08-29 已落地）

按 §9 顺序实现完毕，机器校验闭环通过：

- **新增 `src/recall-budget.ts`**：每回合 ≤3 预算的 `RecallBudget` 单例，pre-step `step 1` 复位，工具 `execute` 消费；超限返回显式信号。
- **`RecallChannel` 拆分**：`pointers()`（只返 label 清单，机制 A）、`fetchNodes()`（原始节点，供工具）、`fetch()`（完整贡献，原 `gather` 行为）；`gather` 保留为 `fetch` 别名。
- **`golem-agent.assemble()`**：recall 自动注入改 `pointers()`，且作为独立于潜意识 leak 块的「记忆索引」块注入（非 in-character，提示可调用 `memory_recall`）；指针不进 postFilter。
- **`src/tools/memory-recall.ts`**：`createMemoryRecallTool({registry, recall, budget})` 经 `exec.agent.session` 取 instanceId、`RecallChannel.fetchNodes` 拉内容、长度截断 + 预算护栏；`index.ts` 加 `inject:["tools"]` 并 `ctx.tools.register` 注册。
- **`dsh-seams.ts`**：`recall-pointer` 通道映射为独立 `golem-recall` 内联块；pre-step `step 1` 复位预算。
- **测试**：新增 `tests/recall-budget.test.ts`、`tests/memory-recall-tool.test.ts`；扩展 `recall-channel`（pointers/fetch/fetchNodes）、`dsh-seams`（指针注入 + 预算复位）、`seed-provenance`（补 `pointers` stub）。`vitest` 全绿（168 测试）。
- **运行时验证**：`npm run build` 零错；dsh web 启动日志确认 `[golem] registered tool: memory_recall`；实例经 `:3080` 正常鉴权起。S3（tool_result 渲染）由构造保证——`memory_recall` 是 dsh 原生工具、走普通 tool 消息，指针块为 `golem-recall` 内联块，二者视觉区分。

*本设计文档已评审通过（v0.2）并落地，由龙虾按 §9 实施。*
