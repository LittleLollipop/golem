/**
 * RecallChannel — 目标导向图检索（goal-directed graph recall, C2-separated）.
 *
 * This is the channel that surfaces targeted recalls from the agent's OWN
 * memory graph during reasoning. It is deliberately a SEPARATE code path from
 * DriftChannel: drift = "my own memory leaks" (non-goal-directed); recall =
 * "I looked something up in my own graph" (goal-directed). The two never share
 * a source. Swap `RecallSource` for a real graph-query backend later (e.g.
 * MemoryReader.recall) — the contract stays.
 *
 * NOTE: this is NOT vector / RAG retrieval. The substrate is axolotl_rs (a
 * typed graph), so recall is graph traversal, not embedding similarity. No
 * vector store is involved.
 */

import type { ChannelContribution, InstanceId } from "../types.js";

export interface RecallSource {
  /** Returns targeted recall snippets from the agent's own memory graph. */
  recall(userText: string, instanceId: InstanceId, limit?: number): Promise<string[]>;
}

/** Default: no recall backend wired yet (keeps architecture runnable). */
export class GraphRecallStub implements RecallSource {
  async recall(): Promise<string[]> {
    return [];
  }
}

export class RecallChannel {
  constructor(private readonly source: RecallSource = new GraphRecallStub()) {}

  async gather(userText: string, instanceId: InstanceId, limit = 3): Promise<ChannelContribution[]> {
    const facts = await this.source.recall(userText, instanceId, limit);
    return facts.map((f, i) => ({
      channel: "recall" as const,
      content: `[图检索] ${f}`,
      seedId: `recall_${i}`,
    }));
  }
}
