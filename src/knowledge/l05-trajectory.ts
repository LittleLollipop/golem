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
import type { DailyKnowledgeTracker } from "./daily-tracker.js";

export interface L05Seed {
  observationText: string;
  seedId: string;
  meta?: Record<string, unknown>;
}

export class L05Trajectory {
  constructor(
    private readonly tracker: DailyKnowledgeTracker,
    private readonly windowSize = 7,
  ) {}

  /** Idle tick: ensure today's fact is learned for this instance. */
  async tick(instanceId: string): Promise<LearnedFact | null> {
    return this.tracker.learnOne(instanceId);
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
    }));
  }
}
