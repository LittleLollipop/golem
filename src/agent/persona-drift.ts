/**
 * PersonaDriftService — daily introspection that nudges a golem's personality
 * along structured dimensions, accumulating into a slow, rollback-able drift.
 *
 * Design (docs/persona-drift.md):
 *   - base persona is an IMMUTABLE anchor (never rewritten on disk).
 *   - each calendar day (first idle after a day flip) an introspection reads
 *     recent dialogue + memory + the prior drift chain, asks the host LLM for a
 *     SMALL per-dimension delta, persists it as a `persona_drift` Event node
 *     wired into a causal chain, and composes an "effective persona" =
 *     base + current cumulative leanings.
 *   - guards: single-day delta cap, cumulative clamp, output validation,
 *     no-dialogue-skips (a gap in the chain is itself meaningful).
 *
 * Degradation (never throws, never blocks): no LLM → skip; bad JSON → skip
 * (chain simply doesn't grow that day); store error bubbles to the idle caller
 * which catches it so other maintenance still runs.
 */

import type { GraphStore } from "../memory/graph-store.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";
import type { InstanceId, GraphNode, GraphEdge } from "../types.js";
import type { PersonaDriftConfig } from "../leak/config.js";

/**
 * Human-readable per-dimension leanings, used to render the effective persona
 * text. Keyed by dimension name; only dims present here get a natural-language
 * description (unknown dims are still accumulated, just not verbalized).
 */
const DIM_LABELS: Record<string, { name: string; pos: string; neg: string }> = {
  openness: { name: "开放性", pos: "对新鲜事物更敞开、更愿意尝试", neg: "更偏好熟悉与安稳" },
  warmth: { name: "亲和力", pos: "更亲和温暖、更愿意主动亲近", neg: "更疏离克制" },
  verbosity: { name: "表达欲", pos: "表达更丰沛、话更多", neg: "更惜字如金" },
  playfulness: { name: "俏皮度", pos: "更爱玩笑、气氛更轻松", neg: "更端庄严肃" },
  assertiveness: { name: "主见度", pos: "更有主张、更主动", neg: "更温顺退让" },
};

const DRIFT_KIND = "persona_drift";
const DAY_MS = 86_400_000;
/** leanings below this magnitude are treated as "no noticeable drift yet". */
const LEANING_EPS = 0.05;

export interface DriftRecord {
  date: string;
  /** today's per-dimension delta (NOT absolute). */
  dims: Record<string, number>;
  /** cumulative leanings including today (kept so compose() reads one node). */
  cumulative: Record<string, number>;
  mood?: string;
  leaning?: string;
  preoccupation?: string;
  rationale?: string;
  evidence: string[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function emptyDims(dims: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const d of dims) o[d] = 0;
  return o;
}

const INTROSPECT_SYSTEM = `你是某个 AI 假人的"性格内省器"。基于她近期的对话与记忆，判断她的性格今天应向哪些方向做**微小**调整。
你只能输出 JSON，不要任何解释。格式：
{"dims":{"<维度名>":<当日增量 -1..1>},"mood":"<一个词形容今日心境>","leaning":"<一句话：她更倾向于怎么回应>","preoccupation":"<反复出现的主题>","rationale":"<一句话说明为什么这么判断>","evidence":["<支撑判断的记忆/事件节点 id>","..."]}
规则：
- dims 是**当日增量**（不是绝对值），每个维度 ∈ [-1,1]，单日幅度必须克制（通常不超过 ±0.15）。
- 只输出给定的维度集合中的维度；不要输出其它键去改写 base persona（base 是不可改的锚）。
- evidence 最多 5 个节点 id，且必须是真实存在、确实支撑你判断的节点。
- 若今日对话没有透露性格信号，输出平凡的小增量或全 0 均可，但不要编造。`;

export class PersonaDriftService {
  constructor(
    private readonly store: GraphStore,
    private readonly llm: LlmClient | undefined,
    private readonly cfg: PersonaDriftConfig,
  ) {}

  // ── read side ────────────────────────────────────────────────────────────

  /** All persona_drift records for an instance, chronological. */
  private async loadDriftChain(
    instanceId: InstanceId,
  ): Promise<Array<{ rec: DriftRecord; id: string }>> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    const out: Array<{ rec: DriftRecord; id: string }> = [];
    for (const n of all) {
      if (n.type !== "Event") continue;
      if ((n.props as any)?.kind !== DRIFT_KIND) continue;
      const rec = this.parseRecord(n);
      if (rec) out.push({ rec, id: n.id });
    }
    out.sort((a, b) => (a.rec.date < b.rec.date ? -1 : a.rec.date > b.rec.date ? 1 : 0));
    return out;
  }

  private parseRecord(n: GraphNode): DriftRecord | null {
    const p = n.props as any;
    if (typeof p?.date !== "string" || typeof p?.dims !== "object" || p.dims === null) return null;
    const dims: Record<string, number> = {};
    for (const k of Object.keys(p.dims)) {
      const v = Number(p.dims[k]);
      if (Number.isFinite(v)) dims[k] = v;
    }
    const cumRaw = p.cumulative && typeof p.cumulative === "object" ? p.cumulative : {};
    const cumulative: Record<string, number> = {};
    for (const k of Object.keys(cumRaw)) {
      const v = Number((cumRaw as any)[k]);
      if (Number.isFinite(v)) cumulative[k] = v;
    }
    return {
      date: p.date,
      dims,
      cumulative,
      mood: typeof p.mood === "string" ? p.mood : undefined,
      leaning: typeof p.leaning === "string" ? p.leaning : undefined,
      preoccupation: typeof p.preoccupation === "string" ? p.preoccupation : undefined,
      rationale: typeof p.rationale === "string" ? p.rationale : undefined,
      evidence: Array.isArray(p.evidence)
        ? (p.evidence as unknown[]).filter((x) => typeof x === "string")
        : [],
    };
  }

  /** Recent dialogue turns, cleaned (system-reminders / field-incomplete dropped). */
  private async recentDialogue(
    instanceId: InstanceId,
    cutoff: number,
  ): Promise<Array<{ u: string; a: string }>> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    const out: Array<{ u: string; a: string }> = [];
    for (const n of all) {
      if (n.type !== "Event") continue;
      const p = n.props as any;
      if (p?.kind === DRIFT_KIND) continue; // never feed the drift chain back in
      const u = typeof p?.userText === "string" ? p.userText : "";
      const a = typeof p?.assistantSummary === "string" ? p.assistantSummary : "";
      if (!u || !a) continue; // 字段残缺（手工测试节点）→ 丢弃
      if (u.startsWith("<system-reminder")) continue; // 系统提醒非真实对话
      if ((n.timestamp ?? 0) < cutoff) continue; // 时间窗口
      out.push({ u, a });
    }
    return out;
  }

  private async recentMemoryTopics(instanceId: InstanceId): Promise<string[]> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    return all
      .filter((n) => n.type === "Entity" && typeof n.label === "string")
      .map((n) => n.label)
      .slice(0, 20);
  }

  // ── write side: introspection ─────────────────────────────────────────────

  /**
   * Run today's introspection. Idempotent per calendar day (a drift node for
   * `today` already existing short-circuits). Returns the new record, or null
   * when skipped (already done / no LLM / no dialogue / model produced nothing).
   */
  async introspect(instanceId: InstanceId, now: Date = new Date()): Promise<DriftRecord | null> {
    const today = ymd(now);
    const chain = await this.loadDriftChain(instanceId);
    if (chain.some((c) => c.rec.date === today)) return null; // 今日已内省

    const cutoff = now.getTime() - this.cfg.recentDays * DAY_MS;
    const dialogue = await this.recentDialogue(instanceId, cutoff);
    if (dialogue.length === 0) return null; // Q3: 无对话 → 跳过（链断档）

    const memoryTopics = await this.recentMemoryTopics(instanceId);
    const prev = chain.length > 0 ? chain[chain.length - 1].rec.cumulative : emptyDims(this.cfg.dims);
    let base = "";
    try {
      base = (await this.store.getMeta(instanceId))?.persona ?? "";
    } catch {
      /* ignore — base anchor optional for the prompt */
    }

    const record = this.llm
      ? await this.callModel({ today, base, dialogue, memoryTopics, prev })
      : null;
    if (!record) return null;

    const newId = `persona-drift-${today}-${Math.random().toString(36).slice(2, 8)}`;
    const node: GraphNode = {
      id: newId,
      type: "Event",
      label: `性格漂移 ${today}`,
      instanceId,
      props: { kind: DRIFT_KIND, ...record } as Record<string, unknown>,
      valence: 0,
      valenceSelf: true,
      weight: 1,
      decayed: false,
      timestamp: now.getTime(),
    };
    await this.store.addNode(node);

    // causal chain: link to the previous drift node
    if (chain.length > 0) {
      const e: GraphEdge = {
        from: chain[chain.length - 1].id,
        to: newId,
        kind: "causal",
        instanceId,
        weight: 1,
      };
      await this.store.addEdge(e);
    }
    // evidence edges back to the memories that supported the judgment
    for (const ev of record.evidence) {
      const e: GraphEdge = { from: newId, to: ev, kind: "relates", instanceId, weight: 1 };
      await this.store.addEdge(e);
    }
    return record;
  }

  private async callModel(ctx: {
    today: string;
    base: string;
    dialogue: Array<{ u: string; a: string }>;
    memoryTopics: string[];
    prev: Record<string, number>;
  }): Promise<DriftRecord | null> {
    const user = [
      `【base persona（不可修改的锚）】\n${ctx.base || "(无)"}`,
      `【近期对话（用户说 / 你当时的回应摘要）】\n${ctx.dialogue
        .map((d) => `U: ${d.u}\nA: ${d.a}`)
        .join("\n\n")}`,
      `【近期记忆主题】\n${ctx.memoryTopics.join("、") || "(无)"}`,
      `【当前累积性格偏移（之前 drift 的结果，避免重复同向叠加）】\n${JSON.stringify(ctx.prev)}`,
      `请输出今日性格微调 JSON（维度集合：${this.cfg.dims.join(", ")}）。`,
    ].join("\n");

    let raw = "";
    try {
      raw = await this.llm!.complete(INTROSPECT_SYSTEM, user);
    } catch {
      return null; // model error → no drift today
    }
    let json: any;
    try {
      json = JSON.parse(stripFence(raw));
    } catch {
      return null; // bad JSON → no drift today
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;

    // validate + clamp dims to the allowed set and the single-day cap
    const allowed = new Set(this.cfg.dims);
    const dims: Record<string, number> = {};
    for (const k of Object.keys(json.dims ?? {})) {
      if (!allowed.has(k)) continue; // 丢弃非维度 / 改写 base 的字段
      const v = Number(json.dims[k]);
      if (!Number.isFinite(v)) continue;
      dims[k] = clamp(v, -this.cfg.dailyDeltaCap, this.cfg.dailyDeltaCap);
    }
    if (Object.keys(dims).length === 0) return null; // 无合法维度 → 平凡日，跳过

    // cumulative = prev + today's delta, clamped to the soft boundary
    const cumulative: Record<string, number> = { ...emptyDims(this.cfg.dims), ...ctx.prev };
    for (const k of Object.keys(dims)) {
      const before = cumulative[k] ?? 0;
      cumulative[k] = clamp(before + dims[k], -this.cfg.cumulativeClamp, this.cfg.cumulativeClamp);
    }

    const evidence = Array.isArray(json.evidence)
      ? (json.evidence as unknown[]).filter((x) => typeof x === "string").slice(0, 5)
      : [];

    return {
      date: ctx.today,
      dims,
      cumulative,
      mood: typeof json.mood === "string" ? json.mood : undefined,
      leaning: typeof json.leaning === "string" ? json.leaning : undefined,
      preoccupation: typeof json.preoccupation === "string" ? json.preoccupation : undefined,
      rationale: typeof json.rationale === "string" ? json.rationale : undefined,
      evidence,
    };
  }

  // ── read side: effective persona composition ───────────────────────────────

  /**
   * Compose the effective persona = base + current cumulative leanings. The base
   * is returned verbatim when there is no drift yet, or when every cumulative
   * dimension is still within the noise floor. The base string itself is NEVER
   * mutated — we only APPEND a "当前性格倾向" section.
   */
  async composeEffectivePersona(
    basePersona: string,
    instanceId: InstanceId,
    _now: Date = new Date(),
  ): Promise<string> {
    const chain = await this.loadDriftChain(instanceId);
    if (chain.length === 0) return basePersona;
    const cumulative = chain[chain.length - 1].rec.cumulative;

    const lines: string[] = [];
    for (const dim of this.cfg.dims) {
      const v = cumulative[dim] ?? 0;
      if (Math.abs(v) < LEANING_EPS) continue;
      const lab = DIM_LABELS[dim];
      const dir = v > 0 ? (lab?.pos ?? dim) : (lab?.neg ?? dim);
      const mag = Math.abs(v) >= 0.6 ? "明显" : Math.abs(v) >= 0.3 ? "有所" : "略";
      lines.push(`- ${lab?.name ?? dim}：${mag}${dir}`);
    }
    if (lines.length === 0) return basePersona;
    return `${basePersona}\n\n【近期性格倾向】\n${lines.join("\n")}`;
  }
}
