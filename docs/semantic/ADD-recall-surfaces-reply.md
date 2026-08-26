# 设计增补：召回时露出助手回复摘要（recall 展示层修复）

## 问题
用户让假人"看新闻"后，记忆渗漏里只出现自己的提问，假人的回复/总结从不出现，观感像"没记住"。

## 根因（已逐行核对代码）
- 回复**已正确落库**：`FakerenAgent.syncLatestTurn`（fakeren-agent.ts:134-139）把 `assistant.payload.text` 送 `writeTurn`；`HeuristicExtractor`（writer.ts:84-89）写入一个 Event 节点，`props.assistantText` = 完整回复（含甲醛白菜等）。
- 回复**已可检索**：sidecar `matchNodes`（memory-sidecar.mjs:151）匹配范围为 `label + " " + JSON.stringify(props)`，回复正文参与关键词命中（"白菜"可命中该节点）。
- **唯一缺口**：`RecallChannel.gather`（recall-channel.ts:59）写死 `content: [图检索] ${n.label}`，只回显标签（用户的提问），`props.assistantText`（她的回复）从不吐出。

结论：回复已存、已可检索，只是渗漏时只露出了标签。修复纯在展示层 + 一个写入时摘要。

## 修复（展示层 + 写入时摘要）
分两步：
1. **写入时生成摘要**（确定性抽取式，无 LLM）：`writeTurn` 落库时对 `assistantText` 跑轻量抽取摘要器，产出 `props.assistantSummary`（取首句 + 含实体/关键词的句子，去重，合并上限 ~120 字 / 2–3 句），与 `assistantText` 同存，仅用于召回展示。
2. **召回时露出摘要**：`RecallChannel.gather` 取 `n.props?.assistantSummary ?? n.props?.assistantText` 拼入 content。**不再用固定 240 字硬截断**（会断句、易夹噪声）。

```ts
// recall-channel.ts gather 的 map 内
const summary =
  typeof n.props?.assistantSummary === "string" ? n.props.assistantSummary :
  typeof n.props?.assistantText === "string" ? n.props.assistantText : "";
const summaryLine = summary ? `\n  ↳ ${summary}` : "";
content: `[图检索] ${n.label}${summaryLine}`,
```

**确定性抽取摘要器（可观察、可控、无 LLM）**：
- 以中文句界（。！？；\n）切句；
- 打分：首句加权；含引号片段 / 大写词 / 与 `userText` 重叠词的句子加权；
- 取前 1–3 句、总长度封顶 ~120 字，超出则句界截断末句并补"…"。

## 摘要方法的分叉（待定）
- **A 确定性抽取式（推荐 v1）**：零成本、可观察、可控，不引入 LLM 黑盒；质量"够用"，偶发漏重点。
- **B LLM 自身摘要（#22/#23）**：调用 agent 自身 completion 生成一句式摘要，质量最高；需补 completion seam（成本/延迟/错误处理），是之前搁置的大块。

若 v1 用 A、跑出来观感不够，再升 B。

## 预期行为
- 用户后续提及与回复相关的词（如"白菜""投洽会"），该新闻 Event 节点被召回，渗漏块出现「你可以帮我看看今天的新闻… ↳ （她的回复摘要，而非 240 字生切）」。
- 人设事实（橘猫豆豆等离散 Entity 节点）行为不变。

## 业务层测试
- `tests/recall-surfaces-reply.test.ts`：构造含 `assistantSummary` 的 Event 节点，以摘要中的关键词调用 `RecallChannel.gather`，断言 `content` 含 label + 摘要片段；
- 断言超长摘要按**句界**温和截断（而非硬 240 字切），且召回 content 不混入原始长文噪声。

## 影响面
仅 `src/channels/recall-channel.ts` + `src/memory/writer.ts`（摘要器，确定性）；不动检索/存储语义，可回滚。
