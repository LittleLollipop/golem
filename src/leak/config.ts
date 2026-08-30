import * as os from "os";
import * as path from "path";

/**
 * Leak rate config — externalized, tunable leak knobs (req_leak_rate_tunable).
 *
 * "leak rate 外置可调（条数 / 权重 / 触发概率）": every leak-rate parameter that
 * used to be a magic number in DriftChannel is now a config value, overridable
 * via env at deploy time. No leak-rate constant is hardcoded in the channel.
 *
 *   FAKEREN_LEAK_MAX          overall cap on drift seeds per turn (0 = uncapped)
 *   FAKEREN_LEAK_DRIFT       cross-domain weak-edge seed count
 *   FAKEREN_LEAK_AMBIENT     ambient stream seed count
 *   FAKEREN_LEAK_L05         L0.5 knowledge-trajectory seed count
 *   FAKEREN_LEAK_TRIGGER_P   trigger probability [0..1] of injecting ANY leakage
 *   FAKEREN_LEAK_MIN_VALENCE minimum AI-self valence for a drift seed to survive
 */

export interface LeakConfig {
  /** overall cap on drift seeds surfaced per turn (0 = uncapped) */
  maxSeeds: number;
  /** cross-domain weak-edge seeds */
  driftLimit: number;
  /** ambient stream seeds */
  ambientLimit: number;
  /** L0.5 knowledge-trajectory seeds */
  l05Limit: number;
  /** L0.5 freshness window (days): a learned fact stays an ambient drift seed
   *  only this long after it was learned; older facts drop out of the auto-leak
   *  (they remain in the recall graph, retrievable via memory_recall).
   *  Prevents "yesterday's fact" from interfering forever (user 2026-08-29). */
  l05FreshDays: number;
  /** probability [0..1] of injecting any leakage at all (trigger probability) */
  triggerProbability: number;
  /** minimum valence weight for a drift seed to survive (0 = no filter) */
  minValence: number;
}

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function loadLeakConfig(): LeakConfig {
  return {
    maxSeeds: num(process.env.FAKEREN_LEAK_MAX, 0),
    driftLimit: num(process.env.FAKEREN_LEAK_DRIFT, 3),
    ambientLimit: num(process.env.FAKEREN_LEAK_AMBIENT, 2),
    l05Limit: num(process.env.FAKEREN_LEAK_L05, 2),
    l05FreshDays: num(process.env.FAKEREN_LEAK_L05_FRESH_DAYS, 1),
    triggerProbability: (() => {
      const v = Number(process.env.FAKEREN_LEAK_TRIGGER_P);
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
    })(),
    minValence: num(process.env.FAKEREN_LEAK_MIN_VALENCE, 0),
  };
}

// ── Persona Drift (性格漂移) ──────────────────────────────────────────────
// 维度偏移 + 累积 clamp + 单日增量上限，全部外置可调（req_persona_drift_tunable）。
//   FAKEREN_DRIFT_ENABLED      总开关 (1/true | 0/false，默认开)
//   FAKEREN_DRIFT_DAILY_CAP    单日增量上限 (默认 0.15)
//   FAKEREN_DRIFT_CLAMP        累积上限 (默认 1.0)
//   FAKEREN_DRIFT_RECENT_DAYS  近期对话/记忆窗口 (默认 7)
//   FAKEREN_DRIFT_HISTORY_DAYS 历史 drift 链窗口 (默认 14)
//   FAKEREN_DRIFT_DIMS         维度集合 (逗号分隔)

export interface PersonaDriftConfig {
  /** master switch — off → intro任务 completely skipped. */
  enabled: boolean;
  /** per-dimension single-day delta cap (|Δ| <= this). */
  dailyDeltaCap: number;
  /** cumulative clamp per dimension (value held within [-clamp, clamp]). */
  cumulativeClamp: number;
  /** recent dialogue/memory window in days (input assembly). */
  recentDays: number;
  /** how far back the drift chain is consulted for "current leanings". */
  historyDays: number;
  /** the personality dimensions the introspection may move. */
  dims: string[];
  /** where introspection execution reports are written (one .drift-log.md per
   *  instance + a machine-readable .last.json). Makes the otherwise-black-box
   *  idle introspection observable (user 2026-08-30). */
  reportDir: string;
}

function boolEnv(env: string | undefined, fallback: boolean): boolean {
  if (env === undefined) return fallback;
  return env === "1" || env.toLowerCase() === "true";
}

export function loadPersonaDriftConfig(): PersonaDriftConfig {
  const dimsEnv = process.env.FAKEREN_DRIFT_DIMS;
  const dims = dimsEnv
    ? dimsEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : ["openness", "warmth", "verbosity", "playfulness", "assertiveness"];
  return {
    enabled: boolEnv(process.env.FAKEREN_DRIFT_ENABLED, true),
    dailyDeltaCap: num(process.env.FAKEREN_DRIFT_DAILY_CAP, 0.15),
    cumulativeClamp: num(process.env.FAKEREN_DRIFT_CLAMP, 1.0),
    recentDays: num(process.env.FAKEREN_DRIFT_RECENT_DAYS, 7),
    historyDays: num(process.env.FAKEREN_DRIFT_HISTORY_DAYS, 14),
    dims,
    reportDir:
      process.env.FAKEREN_DRIFT_REPORT_DIR ??
      path.join(os.homedir(), ".fakeren", "drift-reports"),
  };
}
