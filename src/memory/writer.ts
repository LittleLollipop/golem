/**
 * MemoryWriter — extracts & persists a turn into the per-instance graph.
 *
 * Extraction is intentionally behind an `Extractor` interface with a naive
 * heuristic default. req_memory_auto_extract says "LLM 复用自身 (无第二模型)":
 * the production extractor should call the agent's own completion; we keep the
 * seam swappable so the architecture compiles and runs today.
 */

import type { GraphStore } from "./graph-store.js";
import type { GraphNode, GraphEdge, InstanceId, NodeType, EdgeKind } from "../types.js";

export interface TurnInput {
  instanceId: InstanceId;
  userText: string;
  assistantText: string;
  timestamp?: number;
}

export interface RawNode {
  id: string;
  type: NodeType;
  label: string;
  props?: Record<string, unknown>;
}
export interface RawEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  props?: Record<string, unknown>;
}

export interface Extractor {
  /** Sync (heuristic) or async (LLM-backed, #22) — both satisfy this seam. */
  extract(input: TurnInput): { nodes: RawNode[]; edges: RawEdge[] } | Promise<{ nodes: RawNode[]; edges: RawEdge[] }>;
}

/** AI's *own* emotional response to content, [-1, 1]. */
export interface ValenceEstimator {
  /** Sync (heuristic) or async (LLM-backed, #23) — both satisfy this seam. */
  estimate(text: string): number | Promise<number>;
}

/** Deterministic stand-in: emotion-signal lexicon sniff. Replace with LLM self-assessment. */
export class HeuristicValence implements ValenceEstimator {
  private readonly pos = ["喜欢", "开心", "享受", "爱", "期待", "满意", "love", "happy", "enjoy"];
  private readonly neg = ["讨厌", "害怕", "焦虑", "难过", "后悔", "怒", "hate", "fear", "sad", "regret"];
  estimate(text: string): number {
    const t = text.toLowerCase();
    let s = 0;
    for (const w of this.pos) if (t.includes(w)) s += 0.3;
    for (const w of this.neg) if (t.includes(w)) s -= 0.3;
    return Math.max(-1, Math.min(1, s));
  }
}

/** Very small extractor: turn → Event node; salient quoted/capitalized spans → Entity nodes. */
export class HeuristicExtractor implements Extractor {
  extract(input: TurnInput): { nodes: RawNode[]; edges: RawEdge[] } {
    const nodes: RawNode[] = [];
    const edges: RawEdge[] = [];
    const eventId = `evt_${input.timestamp ?? Date.now()}`;
    nodes.push({
      id: eventId,
      type: "Event",
      label: input.userText.slice(0, 80),
      props: { userText: input.userText, assistantText: input.assistantText },
    });

    const spans = new Set<string>();
    for (const m of input.userText.matchAll(/[“"「]([^”"」]{2,20})[”"」]/g)) spans.add(m[1]);
    for (const m of input.userText.matchAll(/\b([A-Z][a-zA-Z]{2,})\b/g)) spans.add(m[1]);

    for (const s of spans) {
      const eid = `ent_${s}`;
      nodes.push({ id: eid, type: "Entity", label: s });
      edges.push({ from: eventId, to: eid, kind: "relates" });
    }
    return { nodes, edges };
  }
}

export class MemoryWriter {
  constructor(
    private readonly store: GraphStore,
    private readonly extractor: Extractor = new HeuristicExtractor(),
    private readonly valence: ValenceEstimator = new HeuristicValence(),
  ) {}

  async writeTurn(input: TurnInput): Promise<void> {
    const { nodes, edges } = await this.extractor.extract(input);
    const ts = input.timestamp ?? Date.now();
    for (const r of nodes) {
      const node: GraphNode = {
        id: r.id,
        type: r.type,
        label: r.label,
        instanceId: input.instanceId,
        props: r.props ?? {},
        valence: await this.valence.estimate(r.label + " " + JSON.stringify(r.props ?? {})),
        valenceSelf: true,
        weight: 1.0,
        decayed: false,
        timestamp: ts,
        provenanceId: `turn_${ts}`,
      };
      await this.store.addNode(node);
    }
    for (const e of edges) {
      const edge: GraphEdge = {
        from: e.from,
        to: e.to,
        kind: e.kind,
        instanceId: input.instanceId,
        props: e.props,
        weight: 1.0,
      };
      await this.store.addEdge(edge);
    }
  }
}
