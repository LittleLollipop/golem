/**
 * 假人 (FakeRen) — shared domain types + dsh seam contracts.
 *
 * The dsh boundary is intentionally typed loosely (`DshContext` is a structural
 * description of the seams proven to exist in base-analysis.md §2; we never fork
 * or patch dsh core — only consume its documented plugin surface). Everything
 * *inside* fakeren is strictly typed.
 */

// ── dsh seam contracts (mirror base-analysis.md §2 evidence) ────────────────

/** A message the model will see. `meta` carries our source-tags. */
export interface UserMessage {
  role: "user";
  content: string;
  /** fakeren source tags: e.g. { channel: "drift", seedId: "..." } */
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
}

/** `ctx.sessionPersistence` — documented API (base-analysis §2.2). */
export interface SessionPersistence {
  list(): Promise<Array<{ id: string; createdAt: number; updatedAt: number }>>;
  load(id: string): Promise<RawSessionEvent[]>;
}

/** `ctx.invariants` — machine-enforced runtime checks. */
export interface Invariants {
  register(name: string, check: (ctx: unknown) => void | Promise<void>): void;
}

/** `ctx.userQuestions` — pause to ask the human. */
export interface UserQuestions {
  ask(question: string, opts?: { postFilter?: (answer: string) => boolean }): Promise<string>;
}

/** `ctx.storageDomain` — non-session persistent KV (dsh-storage-domain, sqlite/fs). */
export interface StorageDomain {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
}

/**
 * The subset of dsh's Cordis context fakeren depends on. We cast the real
 * `ctx` to this at the plugin boundary (see adapter/dsh-seams.ts).
 */
export interface DshContext {
  agent: {
    on(event: "pre-step", listener: PreStepListener): void;
    runMaintenance(task: () => Promise<void>): Promise<void>;
    whenIdle(): Promise<void>;
  };
  sessionPersistence: SessionPersistence;
  invariants: Invariants;
  userQuestions: UserQuestions;
  storageDomain: StorageDomain;
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
}

// ── Memory graph (维度 H) ─────────────────────────────────────────────────

export type NodeType = "Entity" | "Event" | "MetaNode";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  instanceId: InstanceId;
  props: Record<string, unknown>;
  /** AI's *own* emotional valence toward this node, [-1, 1] (req_memory_valence). */
  valence: number;
  /** Always true for fakeren — distinguishes from lobster's *user* emotion. */
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

export type ChannelName = "drift" | "recall" | "situational";

/** A contribution assembled into the model-visible context, source-tagged. */
export interface ChannelContribution {
  channel: ChannelName;
  content: string;
  /** opaque id for provenance/audit (req_seed_provenance). */
  seedId: string;
  /** AI-self valence that weighted this (drift only). */
  valence?: number;
}

// ── Grading (任务分级器) ──────────────────────────────────────────────────

export type Grade = "zero" | "weak" | "strong";

export interface GradeResult {
  grade: Grade;
  /** model confidence the user wants a factual/actionable answer, [0,1]. */
  confidence: number;
  reason: string;
}
