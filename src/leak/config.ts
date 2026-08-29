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
