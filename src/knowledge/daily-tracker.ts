/**
 * DailyKnowledgeTracker — the L0.5 cadence + dedup ledger (req_l05_knowledge_trajectory).
 *
 * Per-instance (req_iso_learning_scoped): each 假人 has its own learned ledger.
 * - At most ONE new fact per calendar day ("每天学 1 条").
 * - Selection follows real ranking: top1 if not yet learned, else top2, ... ("top1
 *   学过则 top2"). The chosen fact records its selectionPath for auditability.
 * - Persisted as a JSON ledger per instance (lightweight dedup state — NOT memory
 *   content; the memory substrate remains axolotl. A production build can back
 *   this ledger with the graph, but the cadence/dedup logic is identical).
 *
 * `now` is injectable so tests can advance the calendar day deterministically.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { KnowledgeSource, KnowledgeCandidate, LearnedFact } from "./types.js";

export interface TrackerState {
  instanceId: string;
  /** all learned fact ids — drives "top1 学过则 top2" dedup */
  learnedIds: string[];
  /** YYYY-MM-DD of the last learn */
  lastLearnedDate: string;
  /** recent learned facts (newest last), bounded window */
  trajectory: LearnedFact[];
}

export type NowFn = () => Date;

const TRAJECTORY_WINDOW = 30;

export class DailyKnowledgeTracker {
  private readonly cache = new Map<string, TrackerState>();

  constructor(
    private readonly source: KnowledgeSource,
    private readonly dir: string,
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
    let st: TrackerState = { instanceId, learnedIds: [], lastLearnedDate: "", trajectory: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(instanceId), "utf8"));
      st = { ...st, ...raw, trajectory: Array.isArray(raw.trajectory) ? raw.trajectory : [] };
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

  /**
   * Learn at most one new fact today. Returns it (with selectionPath + citation)
   * or null if today's quota is already spent / nothing new remains.
   */
  async learnOne(instanceId: string): Promise<LearnedFact | null> {
    const st = this.load(instanceId);
    const today = this.today();
    if (st.lastLearnedDate === today) return null; // already learned today

    const candidates = await this.source.rankedCandidates();
    let chosen: KnowledgeCandidate | null = null;
    let skipped = 0;
    for (const c of candidates) {
      if (st.learnedIds.includes(c.id)) {
        skipped++;
        continue;
      }
      chosen = c;
      break;
    }
    if (!chosen) return null; // everything learned

    const learned: LearnedFact = {
      id: chosen.id,
      title: chosen.title,
      summary: chosen.summary,
      source: chosen.source,
      sourceUrl: chosen.sourceUrl,
      learnedAt: this.now().getTime(),
      chosenRank: chosen.rank,
      selectionPath:
        skipped > 0
          ? `top${skipped} 已学过 → 选 rank ${chosen.rank}`
          : `选 top1 (rank ${chosen.rank})`,
    };
    st.learnedIds.push(chosen.id);
    st.lastLearnedDate = today;
    st.trajectory.push(learned);
    if (st.trajectory.length > TRAJECTORY_WINDOW) st.trajectory = st.trajectory.slice(-TRAJECTORY_WINDOW);
    this.save(st);
    return learned;
  }

  /** Recent learned facts, newest first — used as drift seeds (L0.5). */
  recentTrajectory(instanceId: string, limit = 7): LearnedFact[] {
    const st = this.load(instanceId);
    return st.trajectory.slice(-limit).reverse();
  }
}
