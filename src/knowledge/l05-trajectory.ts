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
import {
  L05_COOLDOWN,
  LeakCooldown,
  type CooldownPolicy,
} from "../leak/cooldown.js";

export interface L05Seed {
  observationText: string;
  seedId: string;
  meta?: Record<string, unknown>;
  /** 种子溯源 (req_seed_provenance)：来源 URL + 选择路径（注入时机由 assemble 盖章） */
  provenance?: SeedProvenance;
}

export class L05Trajectory {
  /**
   * Cooldown table for leaked learned facts (user 2026-08-29: "同一个会话里
   * 相同的记忆不需要反复的漏").
   *
   * ⚠️ This used to be a per-session Set that *permanently* excluded a fact
   * after its first leak. That overshot the requirement and locked new
   * knowledge out of the leak entirely: a fact leaked once at turn N and then
   * never again for the remaining 67 turns of the session, so the persona
   * stopped mentioning it, the extractor never saw it, and it could never
   * reach the graph (docs/leak-seed-pool.md §2.2). Suppression must be a
   * *window*, not a life sentence — hence the shared cooldown (6h; see
   * L05_COOLDOWN for why it must stay well below `freshDays`).
   *
   * DriftChannel injects its own instance so both sub-channels cool down
   * through the same code path (§4.1).
   */
  private cooldown = new LeakCooldown();

  constructor(
    private readonly tracker: DailyKnowledgeTracker,
    private readonly windowSize = 7,
    private readonly log?: BackgroundTaskLog,
    /** Max age (days) a learned fact stays an ambient drift seed. Older facts
     *  drop out of the auto-leak but remain in the recall graph. Default 1. */
    private readonly freshDays = 1,
    private readonly cooldownPolicy: CooldownPolicy = L05_COOLDOWN,
  ) {}

  /**
   * Share one cooldown table with the rest of the drift channel. Idempotent —
   * calling it twice with the same instance is a no-op; calling it with a
   * different instance replaces the table (kept permissive for tests).
   */
  attachCooldown(cd: LeakCooldown): void {
    this.cooldown = cd;
  }

  /** Test seam: inspect the shared instance (asserts cross-channel symmetry). */
  get cooldownTable(): LeakCooldown {
    return this.cooldown;
  }

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
   *  2. cooldown: a fact is not re-surfaced within the cooldown window
   *     (default 24h, per sessionId). It CAN resurface afterwards — unlike the
   *     old permanent per-session exclusion.
   */
  seedCandidates(
    instanceId: string,
    limit = 4,
    sessionId?: string,
    now: number = Date.now(),
  ): L05Seed[] {
    const freshMs = this.freshDays * 24 * 3600 * 1000;
    // scope: per-conversation. No sessionId → no suppression (pre-existing
    // semantics for callers that do not track a conversation, e.g. tests).
    const scope = sessionId;
    // Only *learned* content leaks into drift; status records (empty/junk/error)
    // are audited but never surfaced.
    const facts = this.tracker
      .recentTrajectory(instanceId, Math.max(limit, this.windowSize))
      .filter((f) => f.status === "learned")
      // freshness gate: a learned fact is "today's trajectory" only while fresh
      .filter((f) => now - f.learnedAt <= freshMs)
      // cooldown gate: suppressed while inside the window, released after it
      .filter((f) => !scope || this.cooldown.available(scope, f.id, this.cooldownPolicy, now))
      .slice(0, limit);

    // Arm the cooldown so later turns inside the window skip it.
    if (scope && facts.length > 0) {
      for (const f of facts) this.cooldown.take(scope, f.id, now);
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
