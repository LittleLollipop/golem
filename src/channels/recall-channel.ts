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
import { stripThinking } from "../memory/summarize.js";

export interface RecallSource {
  /** Returns targeted recall nodes from the agent's own memory graph. */
  recall(instanceId: InstanceId, keywords: string[], limit?: number): Promise<GraphNode[]>;
  /** 1-hop neighbors of a node (for 2-hop recall expansion, dual-mechanism §C). */
  neighbors(instanceId: InstanceId, nodeId: string): Promise<GraphNode[]>;
}

/** Default source: delegates to the axolotl-backed MemoryReader (graph traversal). */
export class GraphRecallSource implements RecallSource {
  constructor(private readonly reader: MemoryReader) {}
  async recall(instanceId: InstanceId, keywords: string[], limit = 20): Promise<GraphNode[]> {
    return this.reader.recall(instanceId, keywords, undefined, limit);
  }
  async neighbors(instanceId: InstanceId, nodeId: string): Promise<GraphNode[]> {
    return this.reader.neighbors(instanceId, nodeId);
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

/**
 * Relevance ranking for recall results (fix: previously the sidecar returned
 * matches in graph-traversal order, so an early-inserted noise node could bury
 * the node the USER actually named — e.g. "卷一·不嫁" ranked ~8th and got
 * sliced off). Scoring, in priority order:
 *   (a) label matches (strongest — "提到作品名" should surface that node),
 *   (b) matched-keyword specificity (longer matched kw ⇒ more specific ⇒ higher),
 *   (c) total keyword coverage,
 * tie-broken by node weight then recency (dual-mechanism-recall.md §C).
 */
function rankNodes(nodes: GraphNode[], keywords: string[]): GraphNode[] {
  const kws = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  const scored = nodes.map((n) => {
    const label = (n.label ?? "").toLowerCase();
    const hay = label + " " + JSON.stringify(n.props ?? {}).toLowerCase();
    let labelMatches = 0;
    let anyMatches = 0;
    let specLen = 0;
    for (const k of kws) {
      if (k.length === 0) continue;
      const inLabel = label.includes(k);
      const inHay = hay.includes(k);
      if (inLabel) {
        labelMatches += 1;
        specLen += k.length;
      }
      if (inHay) anyMatches += 1;
    }
    const score = labelMatches * 10 + specLen * 1.5 + anyMatches * 1;
    const weight = typeof n.weight === "number" ? n.weight : 0;
    const ts = typeof n.timestamp === "number" ? n.timestamp : 0;
    return { n, score, weight, ts };
  });
  scored.sort((a, b) => b.score - a.score || b.weight - a.weight || b.ts - a.ts);
  return scored.map((s) => s.n);
}

export class RecallChannel {
  constructor(private readonly source: RecallSource) {}

  /** Mechanism B (pull): return the raw matched graph nodes for a query. Used by
   *  the `memory_recall` tool to fetch full content on demand. Over-fetches then
   *  ranks + slices so keyword relevance applies (dual-mechanism-recall.md §4/§C). */
  async fetchNodes(query: string, instanceId: InstanceId, limit = 5): Promise<GraphNode[]> {
    const kws = toKeywords(query);
    const ranked = rankNodes(await this.source.recall(instanceId, kws, limit * 4), kws);
    return ranked.slice(0, limit);
  }

  /** Mechanism B (pull): full content as ChannelContribution[] (the old
   *  `gather` shape), reusing fetchNodes. */
  async fetch(query: string, instanceId: InstanceId, limit = 5): Promise<ChannelContribution[]> {
    return (await this.fetchNodes(query, instanceId, limit)).map((n, i) => buildRecallContribution(n, i));
  }

  /** Mechanism A (push-hint): only the node labels / keywords, NO full summary.
   *  Surfaced as a lightweight "memory index" that prompts the model to call
   *  `memory_recall` for details (dual-mechanism-recall.md §3/§5). Results are
   *  ranked by relevance (§C) and 2-hop expanded around the top anchors so a
   *  named entity surfaces its whole cluster (e.g. 卷一·不嫁 → 钟无艳/梗概/节拍). */
  async pointers(userText: string, instanceId: InstanceId, limit = 5): Promise<ChannelContribution[]> {
    const kws = toKeywords(userText);
    const ranked = rankNodes(await this.source.recall(instanceId, kws, limit * 4), kws);
    // (C) 2-hop expansion: pull the neighbors of the top anchors (cap 3) so the
    // pointer list carries the named entity AND its immediate context cluster.
    const expanded: GraphNode[] = [...ranked];
    const seen = new Set(ranked.map((n) => n.id));
    const anchors = ranked.slice(0, Math.min(3, ranked.length));
    for (const a of anchors) {
      const anchorIdx = expanded.findIndex((n) => n.id === a.id);
      if (anchorIdx < 0) continue;
      try {
        const nbrs = await this.source.neighbors(instanceId, a.id);
        for (const nb of nbrs) {
          if (!seen.has(nb.id)) {
            seen.add(nb.id);
            // Insert immediately after its anchor so the named entity's cluster
            // stays grouped at the top (appending would push it past the slice).
            expanded.splice(anchorIdx + 1, 0, nb);
          }
        }
      } catch {
        /* sidecar down → skip expansion, keep the ranked anchors */
      }
    }
    return expanded.slice(0, limit).map((n, i) => ({
      channel: "recall-pointer" as const,
      content: n.label,
      seedId: `recall_ptr_${n.id}_${i}`,
      valence: typeof n.valence === "number" ? n.valence : 0,
      provenance: {
        source: `node:${n.id}`,
        selectionPath: `recall pointer rank ${i + 1}${i >= ranked.length ? " (2-hop)" : ""}`,
      },
    }));
  }

  /** Back-compat alias → fetch (full content). The auto-inject path now uses
   *  `pointers()` instead; kept so external callers/tests referencing gather()
   *  keep working (dual-mechanism-recall.md). */
  async gather(userText: string, instanceId: InstanceId, limit = 3): Promise<ChannelContribution[]> {
    return this.fetch(userText, instanceId, limit);
  }
}

/** Build a full-content recall contribution (label + extractive summary). */
function buildRecallContribution(n: GraphNode, i: number): ChannelContribution {
  // Surface the remembered reply, not just the question label. Prefer the
  // extractive summary (props.assistantSummary); fall back to the raw reply
  // for older nodes that predate summarization.
  const summary =
    typeof n.props?.assistantSummary === "string" && n.props.assistantSummary.trim().length > 0
      ? n.props.assistantSummary
      : typeof n.props?.assistantText === "string"
        ? n.props.assistantText
        : "";
  // Display-time guard: old nodes may carry raw model thinking in either
  // field. Strip it here so a malformed memory never leaks a monologue,
  // independent of when/how it was written.
  const cleanSummary = stripThinking(summary);
  const summaryLine = cleanSummary ? `\n  ↳ ${cleanSummary}` : "";
  return {
    channel: "recall" as const,
    content: `[图检索] ${n.label}${summaryLine}`,
    seedId: `recall_${n.id}_${i}`,
    valence: typeof n.valence === "number" ? n.valence : 0,
    provenance: {
      source: `node:${n.id}`,
      selectionPath: `recall keyword match rank ${i + 1}`,
    },
  };
}
