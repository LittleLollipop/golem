/**
 * L05Trajectory — drives the daily knowledge trajectory and exposes it as drift
 * seeds (req_l05_knowledge_trajectory). L0/L0.5 are drift (not targeted recall),
 * so learned facts enter the DriftChannel seed pool.
 *
 * tick() is called on idle (once per instance) to ensure "today's fact" is
 * captured; seedCandidates() feeds the recent trajectory into drift, carrying the
 * source citation + selection path as meta for attribution/audit.
 */

import type { LearnedFact } from "./types.js";
import type { SeedProvenance } from "../types.js";
import type { DailyKnowledgeTracker } from "./daily-tracker.js";
import type { BackgroundTaskLog } from "../scheduler/background-log.js";

export interface L05Seed {
  observationText: string;
  seedId: string;
  meta?: Record<string, unknown>;
  /** 种子溯源 (req_seed_provenance)：来源 URL + 选择路径（注入时机由 assemble 盖章） */
  provenance?: SeedProvenance;
}

export class L05Trajectory {
  /**
   * Per-session dedup of leaked learned facts. Keyed by sessionId so the SAME
   * fact is surfaced at most ONCE per conversation (user 2026-08-29: "同一个
   * 会话里相同的记忆不需要反复的漏"). A new conversation (new sessionId) starts
   * fresh, so the fact can remind once in a later talk — but never repeats
   * within the same session.
   */
  private readonly sessionLeaked = new Map<string, Set<string>>();

  constructor(
    private readonly tracker: DailyKnowledgeTracker,
    private readonly windowSize = 7,
    private readonly log?: BackgroundTaskLog,
    /** Max age (days) a learned fact stays an ambient drift seed. Older facts
     *  drop out of the auto-leak but remain in the recall graph. Default 1. */
    private readonly freshDays = 1,
  ) {}

  /**
   * Idle tick: ensure today's two learning slots are attempted for this instance.
   * Returns the resulting records (random + purposeful), or null if both already
   * done today.
   */
  async tick(instanceId: string): Promise<{ random?: LearnedFact; purposeful?: LearnedFact } | null> {
    const res = await this.tracker.ensureToday(instanceId);
    // 后台调度日志：记录"学了什么 / 状态"（req_background_task_log）
    if (res.random && this.log) this.log.learn(instanceId, res.random);
    if (res.purposeful && this.log) this.log.learn(instanceId, res.purposeful);
    return res.random || res.purposeful ? res : null;
  }

  /**
   * L0.5 drift seeds — KEYWORD POINTERS only (user 2026-08-29: "改成关键词，
   * 告诉她有这么记忆就行了，不需要漏的这么详细"). We surface just the fact's
   * *title* as a memory hint; the full summary + source stay in the daily
   * tracker / recall graph and are NOT dumped into the leak. This mirrors the
   * recall-pointer (Mechanism A) philosophy: hint existence, pull detail on
   * demand.
   *
   * Two gates keep it from becoming interference:
   *  1. freshness: only facts learned within `freshDays` are ambient seeds.
   *  2. per-session dedup: a fact leaks at most once per sessionId.
   */
  seedCandidates(
    instanceId: string,
    limit = 4,
    sessionId?: string,
    now: number = Date.now(),
  ): L05Seed[] {
    const freshMs = this.freshDays * 24 * 3600 * 1000;
    const alreadyLeaked = sessionId ? this.sessionLeaked.get(sessionId) : undefined;
    // Only *learned* content leaks into drift; status records (empty/junk/error)
    // are audited but never surfaced.
    const facts = this.tracker
      .recentTrajectory(instanceId, Math.max(limit, this.windowSize))
      .filter((f) => f.status === "learned")
      // freshness gate: a learned fact is "today's trajectory" only while fresh
      .filter((f) => now - f.learnedAt <= freshMs)
      // per-session dedup: don't re-leak a fact already surfaced this session
      .filter((f) => !alreadyLeaked?.has(f.id))
      .slice(0, limit);

    // Record as leaked in this session so later turns skip it (dedup).
    if (sessionId && facts.length > 0) {
      let set = this.sessionLeaked.get(sessionId);
      if (!set) {
        set = new Set();
        this.sessionLeaked.set(sessionId, set);
        // bound the map across many sessions in a long-running process
        if (this.sessionLeaked.size > 256) {
          const eldest = this.sessionLeaked.keys().next().value;
          if (typeof eldest === "string") this.sessionLeaked.delete(eldest);
        }
      }
      for (const f of facts) set.add(f.id);
    }

    return facts.map((f) => ({
      // KEYWORD-ONLY pointer: just the title, no summary/source text.
      observationText: f.title,
      seedId: `l05_${f.id}`,
      meta: {
        source: f.source,
        sourceUrl: f.sourceUrl,
        chosenRank: f.chosenRank,
        selectionPath: f.selectionPath,
        kind: f.kind,
      },
      // 种子溯源 (req_seed_provenance): source URL + selection path; injectedAt
      // is stamped later by the assembler at real injection time.
      provenance: {
        source: f.sourceUrl,
        selectionPath: f.selectionPath,
      },
    }));
  }
}
