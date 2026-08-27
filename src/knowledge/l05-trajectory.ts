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
  constructor(
    private readonly tracker: DailyKnowledgeTracker,
    private readonly windowSize = 7,
    private readonly log?: BackgroundTaskLog,
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

  seedCandidates(instanceId: string, limit = 4): L05Seed[] {
    // Only *learned* content leaks into drift; status records (empty/junk/error)
    // are audited but never surfaced.
    const facts = this.tracker
      .recentTrajectory(instanceId, Math.max(limit, this.windowSize))
      .filter((f) => f.status === "learned")
      .slice(0, limit);
    return facts.map((f) => ({
      observationText: `${f.title}：${f.summary}（来源 ${f.source}）`,
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
