/**
 * RecallChannel — 目标导向图检索（goal-directed graph recall, C2-separated）.
 *
 * This is the channel that surfaces targeted recalls from the agent's OWN
 * memory graph during reasoning. It is a SEPARATE code path from DriftChannel:
 * drift = "my own memory leaks" (non-goal-directed); recall = "I looked
 * something up in my own graph" (goal-directed). The two never share a source.
 *
 * The substrate is axolotl_rs (a typed graph), so recall is graph traversal
 * (keyword match over node label + props), NOT embedding similarity / RAG. No
 * vector store is involved. The default source delegates to MemoryReader, which
 * reaches the real graph via the sidecar (POST /{id}/recall).
 */

import type { ChannelContribution, InstanceId, GraphNode } from "../types.js";
import type { MemoryReader } from "../memory/reader.js";

export interface RecallSource {
  /** Returns targeted recall nodes from the agent's own memory graph. */
  recall(instanceId: InstanceId, keywords: string[], limit?: number): Promise<GraphNode[]>;
}

/** Default source: delegates to the axolotl-backed MemoryReader (graph traversal). */
export class GraphRecallSource implements RecallSource {
  constructor(private readonly reader: MemoryReader) {}
  async recall(instanceId: InstanceId, keywords: string[], limit = 20): Promise<GraphNode[]> {
    return this.reader.recall(instanceId, keywords, undefined, limit);
  }
}

/**
 * Light keyword extraction from free text (no stopword model yet; v1 only).
 * CJK has no whitespace token boundaries, so a Chinese sentence would collapse
 * into one giant token that can never substring-match a single node label. We
 * therefore also emit 2-grams over CJK runs — e.g. "养了猫" surfaces "猫" as a
 * match against a label like "养了一只橘猫叫豆豆".
 */
function toKeywords(userText: string): string[] {
  const text = userText.toLowerCase();
  const seen = new Set<string>();
  for (const t of text.split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= 2) seen.add(t);
  }
  for (const run of text.match(/[\p{L}]+/gu) ?? []) {
    if (/[一-鿿]/.test(run)) {
      for (let i = 0; i + 2 <= run.length; i++) seen.add(run.slice(i, i + 2));
    }
  }
  return Array.from(seen).slice(0, 24);
}

export class RecallChannel {
  constructor(private readonly source: RecallSource) {}

  async gather(userText: string, instanceId: InstanceId, limit = 3): Promise<ChannelContribution[]> {
    const nodes = await this.source.recall(instanceId, toKeywords(userText), limit * 4);
    return nodes.slice(0, limit).map((n, i) => ({
      channel: "recall" as const,
      content: `[图检索] ${n.label}`,
      seedId: `recall_${n.id}_${i}`,
      valence: typeof n.valence === "number" ? n.valence : 0,
    }));
  }
}
