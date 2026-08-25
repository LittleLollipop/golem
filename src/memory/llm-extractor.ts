/**
 * LlmExtractor — 真实抽取器 (#22). Replaces HeuristicExtractor with the agent's
 * own model, returning structured memory nodes/edges as JSON. Falls back to an
 * empty extraction on any model error so the pipeline never breaks.
 */

import type { Extractor, RawNode, RawEdge, TurnInput } from "./writer.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";

const SYSTEM = `你是记忆抽取器。从一段对话（用户说 / 助手答）中抽取结构化记忆，用于构建一个长期记忆图。
只能输出 JSON，不要任何解释或代码围栏。

节点类型：
- "Entity"：人、物、地点、概念、作品等具体或抽象对象
- "Event"：发生过的具体事件

边类型：
- "relates"：相关
- "causal"：因果
- "crossdomain_weak"：弱跨域联想（不同领域之间的微妙牵连）

输出格式：
{
  "nodes": [{"type":"Entity|Event","label":"简短标签（用原文语言）","props":{}}],
  "edges": [{"from":"<节点 label>","to":"<节点 label>","kind":"relates|causal|crossdomain_weak"}]
}
用节点的 label 作为 from/to 引用；相同 label 视为同一节点。`;

interface ParsedShape {
  nodes?: Array<{ type?: string; label?: string; props?: Record<string, unknown> }>;
  edges?: Array<{ from?: string; to?: string; kind?: string }>;
}

export class LlmExtractor implements Extractor {
  constructor(private readonly llm: LlmClient) {}

  async extract(input: TurnInput): Promise<{ nodes: RawNode[]; edges: RawEdge[] }> {
    const user = `用户说：${input.userText}\n助手答：${input.assistantText}`;
    let raw: string;
    try {
      raw = await this.llm.complete(SYSTEM, user);
    } catch {
      return { nodes: [], edges: [] };
    }
    return LlmExtractor.parse(raw);
  }

  /** Pure parse — exported for unit testing without a live model. */
  static parse(raw: string): { nodes: RawNode[]; edges: RawEdge[] } {
    let json: ParsedShape;
    try {
      json = JSON.parse(stripFence(raw)) as ParsedShape;
    } catch {
      return { nodes: [], edges: [] };
    }
    const nodes: RawNode[] = [];
    const idByLabel = new Map<string, string>();
    for (const n of json.nodes ?? []) {
      const label = typeof n.label === "string" && n.label.trim() ? n.label.trim() : null;
      if (!label) continue;
      const type = n.type === "Event" ? "Event" : "Entity";
      if (!idByLabel.has(label)) {
        const id = `llm_${idByLabel.size}_${label.slice(0, 16)}`;
        idByLabel.set(label, id);
        nodes.push({ id, type, label, props: n.props ?? {} });
      }
    }
    const edges: RawEdge[] = [];
    for (const e of json.edges ?? []) {
      const from = e.from ? idByLabel.get(e.from.trim()) : undefined;
      const to = e.to ? idByLabel.get(e.to.trim()) : undefined;
      if (!from || !to || from === to) continue;
      const kind = e.kind === "causal" || e.kind === "crossdomain_weak" ? e.kind : "relates";
      edges.push({ from, to, kind });
    }
    return { nodes, edges };
  }
}
