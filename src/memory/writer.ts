/**
 * MemoryWriter — extracts & persists a turn into the per-instance graph.
 *
 * Extraction is intentionally behind an `Extractor` interface with a naive
 * heuristic default. req_memory_auto_extract says "LLM 复用自身 (无第二模型)":
 * the production extractor should call the agent's own completion; we keep the
 * seam swappable so the architecture compiles and runs today.
 */

import type { GraphStore } from "./graph-store.js";
import { summarizeReply } from "./summarize.js";
import type {
  GraphNode,
  GraphEdge,
  InstanceId,
  NodeType,
  EdgeKind,
  ValenceVector,
} from "../types.js";
import { valenceScalar } from "../types.js";

export interface TurnInput {
  instanceId: InstanceId;
  userText: string;
  assistantText: string;
  timestamp?: number;
  /**
   * Conversation this turn belongs to. Stamped onto every extracted EDGE so the
   * drift pool can tell "settled history" from "what we just talked about" —
   * the golem should not leak a turn's own content back as a reminiscence
   * (docs/leak-seed-pool.md §4.3). Nodes are unaffected: they already carry
   * `timestamp`, and a node may be re-mentioned across sessions.
   */
  sessionId?: string;
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

/**
 * AI 自身多维情绪 (req_memory_valence + dec_valence_ai_self)。
 * 返回四维向量 (褒/贬/惧/恋)，各 ∈ [-1, 1]。Sync(启发式) 或 async(LLM, #23) 皆可。
 */
export interface ValenceEstimator {
  estimate(text: string): ValenceVector | Promise<ValenceVector>;
}

/** 把单维信号映射成四维向量的小工具。 */
function v(praise: number, blame: number, fear: number, attachment: number): ValenceVector {
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  return { praise: clamp(praise), blame: clamp(blame), fear: clamp(fear), attachment: clamp(attachment) };
}

/** Deterministic stand-in: emotion-signal lexicon sniff across four dimensions.
 *  Replace with LLM self-assessment (LlmValence) when a key is configured. */
export class HeuristicValence implements ValenceEstimator {
  private readonly pos = ["喜欢", "开心", "享受", "爱", "期待", "满意", "love", "happy", "enjoy", "温暖", "安心"];
  private readonly neg = ["讨厌", "害怕", "焦虑", "难过", "后悔", "怒", "hate", "fear", "sad", "regret", "烦", "厌恶"];
  private readonly afraid = ["怕", "恐惧", "警惕", "担心", "慌", "紧张", "scared", "anxious"];
  private readonly attach = ["舍不得", "牵挂", "想你", "在乎", "离不开", "依恋", "思念", "miss"];
  estimate(text: string): ValenceVector {
    const t = text.toLowerCase();
    let praise = 0, blame = 0, fear = 0, attachment = 0;
    for (const w of this.pos) if (t.includes(w)) praise += 0.3;
    for (const w of this.neg) if (t.includes(w)) blame += 0.3;
    for (const w of this.afraid) if (t.includes(w)) fear += 0.3;
    for (const w of this.attach) if (t.includes(w)) attachment += 0.3;
    return v(praise, blame, fear, attachment);
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
      props: {
        userText: input.userText,
        assistantText: input.assistantText,
        // Deterministic extractive summary so recall can surface the reply
        // without dumping the raw wall of text (no LLM, observable).
        assistantSummary: summarizeReply(input.assistantText ?? "", input.userText),
      },
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

  /**
   * Persist extracted nodes/edges into the graph. Shared by `writeTurn` and
   * `writePersonaExt` (docs/persona-layering.md §4 — reuse the extractor seam,
   * no second extraction channel). Returns the persisted node ids.
   */
  private async persist(
    input: TurnInput,
    extracted: { nodes: RawNode[]; edges: RawEdge[] },
    provenanceId?: string,
  ): Promise<string[]> {
    const ts = input.timestamp ?? Date.now();
    const ids: string[] = [];
    for (const r of extracted.nodes) {
      const text = r.label + " " + JSON.stringify(r.props ?? {});
      const vec = await this.valence.estimate(text);
      const node: GraphNode = {
        id: r.id,
        type: r.type,
        label: r.label,
        instanceId: input.instanceId,
        props: r.props ?? {},
        valence: valenceScalar(vec),
        valenceVec: vec,
        valenceSelf: true,
        weight: 1.0,
        decayed: false,
        timestamp: ts,
        provenanceId: provenanceId ?? `turn_${ts}`,
      };
      await this.store.addNode(node);
      ids.push(r.id);
    }
    for (const e of extracted.edges) {
      const edge: GraphEdge = {
        from: e.from,
        to: e.to,
        kind: e.kind,
        instanceId: input.instanceId,
        props: e.props,
        weight: 1.0,
        // Undefined for persona seeds / background writes ⇒ "settled history".
        sessionId: input.sessionId,
      };
      await this.store.addEdge(edge);
    }
    return ids;
  }

  async writeTurn(input: TurnInput): Promise<void> {
    const extracted = await this.extractor.extract(input);
    await this.persist(input, extracted);
  }

  /**
   * Seed a persona-extended block (background / relations / preference
   * instances / history) into the graph, wired to the persona-identity anchor
   * (docs/persona-layering.md §4). Reuses the exact extractor used for dialogue
   * — no second extraction channel. Returns the ids of seeded nodes.
   */
  async writePersonaExt(text: string, instanceId: InstanceId, anchorId: string): Promise<string[]> {
    const input: TurnInput = { instanceId, userText: text, assistantText: "" };
    const ids = await this.persist(input, await this.extractor.extract(input), `persona-seed_${Date.now()}`);
    for (const id of ids) {
      await this.store.addEdge({
        from: id,
        to: anchorId,
        kind: "relates",
        instanceId,
        weight: 1.0,
      });
    }
    return ids;
  }
}
