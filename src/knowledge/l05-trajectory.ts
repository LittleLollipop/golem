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

  /** Idle tick: ensure today's fact is learned for this instance. */
  async tick(instanceId: string): Promise<LearnedFact | null> {
    const fact = await this.tracker.learnOne(instanceId);
    // 后台调度日志：记录"学了什么"（req_background_task_log）
    if (fact && this.log) {
      this.log.learn(instanceId, fact);
    }
    return fact;
  }

  seedCandidates(instanceId: string, limit = 2): L05Seed[] {
    const facts = this.tracker
      .recentTrajectory(instanceId, Math.max(limit, this.windowSize))
      .slice(0, limit);
    return facts.map((f) => ({
      observationText: `${f.title}：${f.summary}（来源 ${f.source}）`,
      seedId: `l05_${f.id}`,
      meta: {
        source: f.source,
        sourceUrl: f.sourceUrl,
        chosenRank: f.chosenRank,
        selectionPath: f.selectionPath,
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
