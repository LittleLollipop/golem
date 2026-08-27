/**
 * DailyKnowledgeTracker — the L0.5 cadence + dedup ledger (req_l05_knowledge_trajectory).
 *
 * Dual-track (req_l05 dual-track, polarization-resistant):
 *   - Slot 1 RANDOM: a mechanical wiki-random fetch — NEVER reads the graph, NEVER
 *     calls the model. Pure serendipity; guarantees breadth every day.
 *   - Slot 2 PURPOSEFUL: model-driven (LearningPlanner reads the instance graph
 *     and emits a LearningDirective). The attempt is recorded with a `status`
 *     (learned/empty/junk/error) — per the user's abstract-status decision, a
 *     failed/empty/junk attempt is a VALID recorded outcome and NEVER falls back
 *     to default content.
 *
 * At most one attempt per slot per calendar day ("每天每条轨学/试 1 次"). Persisted
 * as a JSON ledger per instance (lightweight dedup state — NOT memory content).
 *
 * `now` is injectable so tests can advance the calendar day deterministically.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  KnowledgeSource,
  KnowledgeCandidate,
  LearnedFact,
  LearningDirective,
  LearnKind,
  LearnStatus,
} from "./types.js";
import type { KnowledgeSourceRegistry } from "./registry.js";
import type { LearningPlanner } from "./planner.js";

export interface TrackerState {
  instanceId: string;
  /** learned content ids — drives "top1 学过则 top2" dedup (learned slots only) */
  learnedIds: string[];
  /** YYYY-MM-DD of the last *any* learn (legacy gate; slots use the two below) */
  lastLearnedDate: string;
  /** recent learned facts (newest last), bounded window */
  trajectory: LearnedFact[];
  /** slot gates — one attempt per slot per day */
  randomDoneDate: string;
  purposefulDoneDate: string;
}

export type NowFn = () => Date;

const TRAJECTORY_WINDOW = 30;

/** Light quality gate: drops ad/spam hosts, placeholder/empty text. Only decides
 *  status (junk vs learned) — never rewrites content. */
const JUNK_HOST =
  /(doubleclick|adsystem|adservice|taboola|outbrain|amazon-adsystem|googleadservices|clickbank|shareasale|criteo|scorecardresearch)\.?/i;

export class DailyKnowledgeTracker {
  private readonly cache = new Map<string, TrackerState>();

  constructor(
    private readonly randomSource: KnowledgeSource,
    private readonly sources: KnowledgeSourceRegistry,
    private readonly dir: string,
    private readonly planner?: LearningPlanner,
    private readonly now: NowFn = () => new Date(),
  ) {}

  private today(): string {
    const d = this.now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  private fileFor(instanceId: string): string {
    return path.join(this.dir, `${instanceId}.json`);
  }

  private load(instanceId: string): TrackerState {
    const hit = this.cache.get(instanceId);
    if (hit) return hit;
    const base: TrackerState = {
      instanceId,
      learnedIds: [],
      lastLearnedDate: "",
      trajectory: [],
      randomDoneDate: "",
      purposefulDoneDate: "",
    };
    let st: TrackerState = base;
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(instanceId), "utf8"));
      st = {
        ...base,
        ...raw,
        trajectory: Array.isArray(raw.trajectory) ? raw.trajectory : [],
        learnedIds: Array.isArray(raw.learnedIds) ? raw.learnedIds : [],
      };
    } catch {
      /* no record yet */
    }
    this.cache.set(instanceId, st);
    return st;
  }

  private save(st: TrackerState): void {
    this.cache.set(st.instanceId, st);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.fileFor(st.instanceId), JSON.stringify(st));
    } catch {
      /* best-effort */
    }
  }

  private qualityGate(cands: KnowledgeCandidate[]): KnowledgeCandidate[] {
    return cands.filter((c) => {
      try {
        const u = new URL(c.sourceUrl);
        if (JUNK_HOST.test(u.hostname)) return false;
      } catch {
        /* no url → keep, gate below still applies */
      }
      if (!c.summary || c.summary.trim().length < 15) return false;
      return true;
    });
  }

  /**
   * Ensure today's two learning slots are attempted for this instance. Returns
   * the (up to two) records — each with a `status`. Random is mechanical;
   * purposeful is model-driven (or a recorded empty/error when the planner/model
   * is unavailable). Either slot may be absent if already done today.
   */
  async ensureToday(instanceId: string): Promise<{ random?: LearnedFact; purposeful?: LearnedFact }> {
    const today = this.today();
    const st = this.load(instanceId);
    const out: { random?: LearnedFact; purposeful?: LearnedFact } = {};

    // ── Slot 1: RANDOM (mechanical wiki-random; no model, no graph) ──
    if (st.randomDoneDate !== today) {
      const c = await this.randomSource.rankedCandidates();
      const chosen = this.firstNotLearned(c, st.learnedIds);
      if (chosen) {
        out.random = this.persist(st, chosen, "random", "learned", today);
      } else {
        out.random = this.persistStatus(
          st,
          "random",
          "empty",
          today,
          null,
          "无新随机内容（源不可用或已全部学过）",
        );
      }
      st.randomDoneDate = today;
    }

    // ── Slot 2: PURPOSEFUL (model-driven; abstract status, never fallback) ──
    if (st.purposefulDoneDate !== today) {
      const directive: LearningDirective | null = this.planner
        ? await this.planner.plan(instanceId)
        : null;
      let rec: LearnedFact;
      if (!directive) {
        // 无模型规划 / 空图 / 规划失败 → 记 empty，不调源、不兜底默认内容
        rec = this.persistStatus(
          st,
          "purposeful",
          "empty",
          today,
          null,
          this.planner ? "规划未产出指令（图库为空 / 模型无法判断）" : "无模型规划，目的轨跳过",
        );
      } else {
        const backend = directive.source;
        try {
          const c = await this.sources.get(backend).rankedCandidates(directive);
          const good = this.qualityGate(c);
          const chosen = this.firstNotLearned(good, st.learnedIds);
          if (chosen) {
            rec = this.persist(st, chosen, "purposeful", "learned", today, directive);
          } else if (c.length === 0) {
            rec = this.persistStatus(st, "purposeful", "empty", today, directive, "检索返回 0 条");
          } else {
            rec = this.persistStatus(
              st,
              "purposeful",
              "junk",
              today,
              directive,
              "结果均疑似广告/垃圾，已丢弃",
            );
          }
        } catch (e) {
          rec = this.persistStatus(
            st,
            "purposeful",
            "error",
            today,
            directive,
            `源异常: ${(e as Error).message}`,
          );
        }
      }
      out.purposeful = rec;
      st.purposefulDoneDate = today;
    }

    this.save(st);
    return out;
  }

  private firstNotLearned(
    cands: KnowledgeCandidate[],
    learnedIds: string[],
  ): KnowledgeCandidate | null {
    for (const c of cands) {
      if (!learnedIds.includes(c.id)) return c;
    }
    return null;
  }

  private persist(
    st: TrackerState,
    c: KnowledgeCandidate,
    kind: LearnKind,
    status: LearnStatus,
    today: string,
    directive?: LearningDirective,
  ): LearnedFact {
    const learned: LearnedFact = {
      id: c.id,
      title: c.title,
      summary: c.summary,
      source: c.source,
      sourceUrl: c.sourceUrl,
      learnedAt: this.now().getTime(),
      chosenRank: c.rank,
      selectionPath:
        kind === "random"
          ? `随机选 (rank ${c.rank}, 来源 ${c.source})`
          : `模型规划: ${directive?.rationale ?? "-"} (source=${directive?.source ?? "?"}, query=${directive?.query ?? "-"})`,
      kind,
      status,
      directive: directive
        ? { source: directive.source, query: directive.query, rationale: directive.rationale }
        : undefined,
    };
    st.learnedIds.push(c.id);
    st.lastLearnedDate = today;
    st.trajectory.push(learned);
    this.trim(st);
    return learned;
  }

  private persistStatus(
    st: TrackerState,
    kind: LearnKind,
    status: LearnStatus,
    today: string,
    directive: LearningDirective | null,
    note: string,
  ): LearnedFact {
    const learned: LearnedFact = {
      id: `status-${kind}-${today}-${status}-${Math.random().toString(36).slice(2, 8)}`,
      title: status === "empty" ? "(无内容)" : status === "junk" ? "(结果被过滤)" : "(源异常)",
      summary: note,
      source: directive?.source ?? (kind === "random" ? "Wikipedia" : "model-planned"),
      sourceUrl: "",
      learnedAt: this.now().getTime(),
      chosenRank: 0,
      selectionPath: kind === "random" ? `随机槽: ${status}` : `目的轨: ${status}`,
      kind,
      status,
      directive: directive
        ? { source: directive.source, query: directive.query, rationale: directive.rationale }
        : undefined,
      statusNote: note,
    };
    st.lastLearnedDate = today;
    st.trajectory.push(learned);
    this.trim(st);
    return learned;
  }

  private trim(st: TrackerState): void {
    if (st.trajectory.length > TRAJECTORY_WINDOW) {
      st.trajectory = st.trajectory.slice(-TRAJECTORY_WINDOW);
    }
  }

  /** Recent learned facts, newest first — used as drift seeds (L0.5). */
  recentTrajectory(instanceId: string, limit = 7): LearnedFact[] {
    const st = this.load(instanceId);
    return st.trajectory.slice(-limit).reverse();
  }
}
