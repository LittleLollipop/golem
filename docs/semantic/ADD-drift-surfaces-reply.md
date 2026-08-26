# ADD: 往昔回放带出助手回复（drift 通道）

> 续 `ADD-recall-surfaces-reply.md`。那次只改了 recall 命中路径；本增补改 **drift 往昔** 路径，让"记得某段对话"时也自动带出当轮助手的回复。

## 背景 / 问题
用户观察：新闻会话之后，渗漏块里出现 `你可以帮我看看今天的新闻有什么值得关注的吗`，但**没有新闻回复**。

诊断（读真实 dsh 会话 + 代码）：
- 该现象来自 **drift 往昔回放**（`drift-channel.ts`），它只重放用户提问：`[往昔] 你曾经历过：<提问前60字>`。
- recall 路径（已改）只在「当前消息关键词命中记忆节点」时带出 `↳ <回复摘要>`；而 `我想看热血战斗的` 里没有"新闻/白菜"这类词，recall 不触发，于是只剩纯提问。
- `loadSessionEvents`（dsh-seams.ts:227）**已经**把 `user/message` 与 `assistant/message` 一起归一化返回，drift 手里本就有回复，只是没用。

## 修复（极小）
改 `drift-channel.ts` 往昔段：找到提问事件后，再取**紧随其后的 assistant 事件**，对其回复跑 `summarizeReply(...)`（复用 `src/memory/summarize.ts` 的确定性抽取摘要，与 recall 同一函数、同一视觉标记 `↳`），拼到往昔行下。

```ts
const sigIdx = evs.findIndex((e) => e.type === "user" && typeof e.payload?.text === "string");
if (sigIdx < 0) continue;
const sig = evs[sigIdx];
const reply = evs.slice(sigIdx + 1).find((e) => e.type === "assistant");
let content = `[往昔] 你曾经历过：${String(sig.payload.text).slice(0, 60)}`;
if (reply && typeof reply.payload?.text === "string" && String(reply.payload.text).trim()) {
  const summary = summarizeReply(String(reply.payload.text), String(sig.payload.text));
  if (summary) content += `\n  ↳ ${summary}`;
}
```

provenance.selectionPath 末尾追加 ` + reply surfaced`（无回复则不追加），便于审计"这次往昔带了回复"。

## 顺带修：回复里的内心独白（之前你点出的隐患）
实测老节点的 `assistantText` / `assistantSummary` 里混了模型英文内心独白（"The user is continuing the roleplay..."）。这类文本若被摘要/回放带出会**出戏**。

两道闸，覆盖新老节点：
1. **写入层**：`summarizeReply` 顶部加 `stripThinking`，新节点的 `assistantSummary` 从源头干净。
2. **展示层（关键）**：老节点（写入早于本修复）的 `assistantSummary`/`assistantText` 仍可能带独白。在 `RecallChannel.gather` 取最终 `summary` 后再过一遍 `stripThinking`，保证**任何来源的记忆都不把独白漏到模型上下文**——与写入时机/方式解耦，最稳。

`stripThinking` 规则（确定性、可观察、零 LLM）：
- 去 `<thinking>…</thinking>` / `<think>…</think>` / `<reasoning>…</reasoning>`（任意大小写，跨行）；
- 按句界切段，丢弃**开头连续**的低中文比（<30%）段（英文独白，可能含 CJK 人名如 "I'm 林夏"），直到首个以中文为主（≥30% CJK）的段——那是真实回复；
- 若整段文本中文比都低（纯英文回复），则**不剥离**，原样保留。

`stripThinking` 从 `summarize.ts` 导出，drift 与 recall 两通道共用。不动存储语义（`assistantText` 原样保留，仅展示层干净）。

## 范围与不变式
- 不破 C2：drift 仍只读 `loadSessionEvents`（RealHistoryCursor），不跨到 recall 图检索路径。
- 摘要确定性、零 LLM、可观察，与 recall 一致。
- 不引入新依赖；改动集中 2 文件 + 2 测试文件。

## 预期行为
- 之后某条消息触发 drift 往昔（触发概率命中），出现的将是：
  ```
  [往昔] 你曾经历过：你可以帮我看看今天的新闻有什么值得关注的吗
    ↳ 今天国内有几条要闻。三部门指导地方快速处置白菜蘸甲醛溶液问题…
  ```
- 同会话触发 recall（关键词命中）时仍是 `[图检索] …\n  ↳ <摘要>`，两条路径视觉一致。
- 人设事实（橘猫豆豆等）、跨域、环境、L0.5 渗漏行为不变。

## 测试
- `tests/drift-surfaces-reply.test.ts`（新）：①有 user+assistant 的会话 → 往昔行带 `↳` + 含关键词摘要；②仅有 user 无 assistant → 只回放提问、无 `↳`。
- `tests/recall-surfaces-reply.test.ts`（扩）：`summarizeReply` 在不同 thinking 形态下都干净（标签块 / 前置英文独白 / 纯英文回复保留）。

## 验证链
typecheck 0 错 → vitest 全绿（含新增）→ build → `scripts/verify-prestep.mjs` PASS（leak block 仍含人设/光合作用，新增往昔带回复）。
