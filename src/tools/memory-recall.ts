/**
 * memory_recall — model-driven memory pull tool (Mechanism B).
 *
 * Registered into dsh via `ctx.tools.register` so the model can, during
 * reasoning, actively fetch full memory-graph nodes on demand. This lets the
 * auto-injected pointer block (Mechanism A) stay tiny while the model can still
 * reach any memory. Budget-guarded (≤3/turn) and length-capped.
 *
 * dsh's `tools` service calls `execute(args, exec)`; `exec.agent` is the same
 * agent object exposed at pre-step, so we derive the sessionId the same way
 * (dual-mechanism-recall.md §4 / §7 S2, verified against dsh-src).
 */

import type { InstanceId, GraphNode } from "../types.js";
import type { InstanceRegistry } from "../registry/instance-registry.js";
import type { RecallChannel } from "../channels/recall-channel.js";
import type { RecallBudget } from "../recall-budget.js";

/** Single tool-result node body is capped so one huge memory can't blow context. */
const SINGLE_RESULT_CAP = 1200;

/** Extract the session id from a dsh agent object (same logic as dsh-seams). */
export function extractSessionId(agent: any): string {
  const sess = agent?.session;
  if (typeof sess === "string") return sess;
  return String(sess?.id ?? sess?.sessionId ?? agent?.id ?? "");
}

export interface MemoryRecallDeps {
  registry: InstanceRegistry;
  recall: RecallChannel;
  budget: RecallBudget;
}

export function createMemoryRecallTool(deps: MemoryRecallDeps) {
  const { registry, recall, budget } = deps;
  return {
    name: "memory_recall",
    description:
      "回想你自己的记忆图：用检索词拉回相关的往昔对话与心事。每回合最多调用 3 次，只在确有需要、且指针提示里有对应记忆时才调用；优先回想最相关的一条。",
    // NOTE: dsh passes `parameters` DIRECTLY to the model as a JSON Schema
    // object (it does NOT auto-wrap a property map the way defineTool does).
    // The root MUST be { type: "object", properties, required } — otherwise the
    // provider rejects it with:
    //   Invalid schema for function 'memory_recall': schema must be a JSON
    //   Schema of 'type: "object"', got 'type: null'.
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "检索词，用于拉回相关的记忆节点（如人物名、事件关键词）。",
        },
        limit: {
          type: "number",
          description: "最多返回多少条记忆，默认 5，建议 1–8。",
        },
      },
      required: ["query"],
    },
    output: {
      schema: { type: "string" },
      render(_a: unknown, v: string) {
        return [{ type: "text" as const, text: v }];
      },
    },
    async execute(args: any, exec: any) {
      const sessionId = extractSessionId(exec?.agent);
      if (!sessionId) return "〔无法定位当前会话，记忆检索失败〕";
      const remaining = budget.tryConsume(sessionId);
      if (remaining < 0) {
        return "〔本回合记忆检索已达上限 3 次，剩余内容请基于已有上下文作答〕";
      }
      const instanceId: InstanceId | null = await registry.current(sessionId);
      if (!instanceId) return "〔尚未绑定任何假人实例，无法检索记忆〕";
      const query = String(args?.query ?? "").trim();
      if (!query) return "〔请提供检索词〕";
      const nodes: GraphNode[] = await recall.fetchNodes(query, instanceId, Number(args?.limit) || 5);
      if (nodes.length === 0) return "〔记忆图中没有与检索词相关的内容〕";
      const parts = nodes.map((n) => {
        const summary =
          typeof n.props?.assistantSummary === "string" && n.props.assistantSummary.trim().length > 0
            ? n.props.assistantSummary
            : typeof n.props?.assistantText === "string"
              ? n.props.assistantText
              : "";
        const body = `〔${n.label}〕${summary}`;
        return body.length > SINGLE_RESULT_CAP ? body.slice(0, SINGLE_RESULT_CAP) + "…〔已截断〕" : body;
      });
      return parts.join("\n");
    },
  };
}
