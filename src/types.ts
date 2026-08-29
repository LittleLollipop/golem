/**
 * 假人 (Golem) — shared domain types + dsh seam contracts.
 *
 * The dsh boundary is intentionally typed loosely (`DshContext` is a structural
 * description of the seams proven to exist in base-analysis.md §2; we never fork
 * or patch dsh core — only consume its documented plugin surface). Everything
 * *inside* golem is strictly typed.
 */

// ── dsh seam contracts (mirror base-analysis.md §2 evidence) ────────────────

/** A message the model will see. `meta` carries our source-tags. */
export interface UserMessage {
  role: "user";
  content: string;
  /** golem source tags: e.g. { channel: "drift", seedId: "..." } */
  meta?: Record<string, unknown>;
}

/** Fired before the model sees the turn; listeners may rewrite `claimed`. */
export interface PreStepEvent {
  sessionId: string;
  /** The messages the harness *would* show; we return the augmented list. */
  claimed: UserMessage[];
}

export type PreStepListener = (
  ev: PreStepEvent,
) => UserMessage[] | Promise<UserMessage[]>;

/** A raw persisted session event (append-only source of truth). */
export interface RawSessionEvent {
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
  /**
   * Set when this event was synthesized by golem (persona / subconscious
   * leakage) rather than typed by the human. Lets syncLatestTurn exclude
   * injected text from the memory graph without fragile string-prefix matching
   * (TODO#28 resolved). Carried through from `data.source.fakeren` at load time.
   */
  injected?: boolean;
}

/** `ctx.sessionPersistence` — documented API (base-analysis §2.2). */
export interface SessionPersistence {
  list(): Promise<Array<{ id: string; createdAt: number; updatedAt: number }>>;
  load(id: string): Promise<RawSessionEvent[]>;
}

/** `ctx.userQuestions` — pause to ask the human. */
export interface UserQuestions {
  ask(question: string, opts?: { postFilter?: (answer: string) => boolean }): Promise<string>;
}

/**
 * The subset of dsh's Cordis context golem depends on. We cast the real
 * `ctx` to this at the plugin boundary (see adapter/dsh-seams.ts).
 */
export interface DshContext {
  /**
   * Cordis event API. We consume two dsh events:
   *   - `agent/pre-step`  (payload: { agent, messages, turn, step, signal }, next)
   *       → return `{ kind: "enter", messages }` to inject leakage context.
   *   - `agent/status`    (payload: { agent, status: "idle" | "running" })
   *       → trigger idle maintenance on "idle".
   * `agent`/`invariants` are NOT injectable services at the profile root
   * (base-analysis §2 was wrong here) — they live in a nested scope, so we
   * must use the event bus, never `ctx.agent.*`.
   */
  on(event: "agent/pre-step", listener: (payload: any, next: any) => any): void;
  on(event: "agent/status", listener: (payload: any) => any): void;
  on(event: string, listener: (...args: any[]) => any): void;
  sessionPersistence: SessionPersistence;
  userQuestions: UserQuestions;
  /** other dsh services we don't touch */
  [key: string]: unknown;
}

// ── Instance (维度 I: 多假人隔离) ──────────────────────────────────────────

export type InstanceId = string;

export interface InstanceMeta {
  id: InstanceId;
  name: string;
  createdAt: number;
  /** total turns this instance has lived through */
  turns: number;
  /**
   * Per-instance persona declaration (维度 I: multi-golem). Injected as the
   * first user-role message each session so the model adopts this identity.
   * When absent the agent falls back to DEFAULT_PERSONA (#27).
   */
  persona?: string;
}

// ── Memory graph (维度 H) ─────────────────────────────────────────────────

export type NodeType = "Entity" | "Event" | "MetaNode";

/**
 * AI 自身多维情绪 (req_memory_valence + dec_valence_ai_self)。
 * 不是 lobster 那种「用户夸了/骂了」的用户情绪标签，而是假人对实体/事件
 * *自己* 的第一人称 affective response：褒/贬/惧/恋。每个维度 ∈ [-1, 1]。
 * 这是「人感」机制的核心：潜意识漏出的是「自己活过的事留下的情绪痕迹」。
 */
export interface ValenceVector {
  /** 褒: 喜爱 / 认可 / 温暖 / 满足 */
  praise: number;
  /** 贬: 厌恶 / 否定 / 抵触 / 失望 */
  blame: number;
  /** 惧: 畏惧 / 不安 / 警惕 / 焦虑 */
  fear: number;
  /** 恋: 依恋 / 牵绊 / 舍不得 / 牵挂 */
  attachment: number;
}

/** 把多维情绪压成一个标量，供按 |valence| 排序 / recall by magnitude 复用。 */
export function valenceScalar(v: ValenceVector): number {
  const s = (v.praise + v.attachment - v.blame - v.fear) / 2;
  return Math.max(-1, Math.min(1, s));
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  instanceId: InstanceId;
  props: Record<string, unknown>;
  /** AI's *own* emotional valence toward this node, [-1, 1] (req_memory_valence).
   * 由 valenceVec 派生，供按 |valence| 排序 / recall by magnitude 复用。 */
  valence: number;
  /** 多维情绪本体 (褒/贬/惧/恋)。记忆图按 valence 回忆与漂移加权。 */
  valenceVec?: ValenceVector;
  /** Always true for golem — distinguishes from lobster's *user* emotion. */
  valenceSelf: true;
  /** Drift seed weight; lower → decays out of injection (Plan B). */
  weight: number;
  /** Plan B decay mark: stop re-injecting, but keep the permanent record. */
  decayed: boolean;
  timestamp?: number;
  provenanceId?: string;
}

export type EdgeKind = "relates" | "causal" | "crossdomain_weak";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  instanceId: InstanceId;
  props?: Record<string, unknown>;
  weight?: number;
}

export interface ConsolidationReport {
  instanceId: InstanceId;
  reviewed: number;
  decayed: number; // newly stopped-from-injection (Plan B)
  merged: Array<[string, string]>;
  grownMeta: string[]; // new MetaNode ids (conservative recursive growth)
  kept: number;
}

export interface GraphStats {
  instanceId: InstanceId;
  nodes: number;
  edges: number;
  decayed: number;
}

// ── Channels (三通道分离, C2) ─────────────────────────────────────────────

export type ChannelName = "drift" | "recall" | "situational" | "recall-pointer";

/**
 * Seed provenance (req_seed_provenance): every injected seed must record
 *   - source:        where it came from — a URL / event id / node id / sample id
 *   - selectionPath: WHY it was chosen (rank, capture kind, keyword trigger, …)
 *   - injectedAt:    WHEN it was injected (ISO timestamp, stamped at assemble time)
 * The source + selectionPath are filled by the producing channel; injectedAt is
 * stamped by the assembler so the audit trail is grounded in real injection time,
 * never in the model's self-report (rule_mechanism_first).
 */
export interface SeedProvenance {
  /** 来源标识：知识 URL / 会话事件 id / 图节点 id / 环境样本 id（可机读可审计） */
  source: string;
  /** 选择路径：为何被选中（rank / capture kind / keyword trigger） */
  selectionPath: string;
  /** 注入时机：ISO 时间戳，由 assemble 在注入时刻盖章 */
  injectedAt?: string;
}

/** A contribution assembled into the model-visible context, source-tagged. */
export interface ChannelContribution {
  channel: ChannelName;
  content: string;
  /** opaque id for provenance/audit (req_seed_provenance). */
  seedId: string;
  /** AI-self valence that weighted this (drift only). */
  valence?: number;
  /** structured metadata for attribution/audit (source citation, selection path, …). */
  meta?: Record<string, unknown>;
  /** 种子溯源 (req_seed_provenance)：来源 + 选择路径（注入时机由 assemble 盖章） */
  provenance?: SeedProvenance;
}

// ── Task classification (按任务类型分级漏出, req_leak_by_task_class) ──────────

/** 任务性质：决定潜意识漏出强度，不靠用户手动开关，由任务本身判定。 */
export type TaskClass = "execute" | "creative" | "neutral";

/**
 * 漏出强度（对应架构三通道路由）：
 *  - "none"   执行命令 → 严谨，零漏（仅 recall，不注入潜意识）
 *  - "weak"   一般询问 → 轻漏（drift + recall）
 *  - "strong" 对话/创作/构思 → 灵气，强漏（drift + situational + recall）
 */
export type LeakLevel = "none" | "weak" | "strong";

export interface TaskAssessment {
  taskClass: TaskClass;
  leakLevel: LeakLevel;
  /** 分类置信度 [0,1] */
  confidence: number;
  reason: string;
}
