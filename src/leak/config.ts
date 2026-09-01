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
//   FAKEREN_DRIFT_REVERT_K     重力回弹基准系数 (默认 0.2)
//   FAKEREN_DRIFT_SOFT_BAND    自由漂移带半宽 (默认 0.4)
//   FAKEREN_DRIFT_DIM_CAPS     per-dim 单日上限 JSON (默认 {"emotionality":0.08})
//   FAKEREN_DRIFT_HEURISTIC_VOL 启发式波动幅度 (1 开 / 0 关，默认关)
//
// ⚠️ FAKEREN_DRIFT_DIMS 的默认值在 v0.5.0 从旧五维（openness/warmth/verbosity/
// playfulness/assertiveness）换成了「HEXACO 状态轴 + 表现层」六维。旧链靠
// drift 节点的 schemaVersion 过滤，不会污染新累积（docs/persona-drift-dimensions.md §7）。

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
  /**
   * 重力回弹基准系数。软带内每天把累积拉回 target 的 `k` 倍；
   * 超出软带后系数按超出量线性放大（docs/persona-drift-dimensions.md §5.2）。
   * 0 = 关闭回弹（退化为旧行为，仅硬 clamp）。
   */
  revertK: number;
  /** 自由漂移带半宽：|cum - target| ≤ softBand 时只有弱回弹。 */
  softBand: number;
  /** per-dim 单日增量上限，覆盖 dailyDeltaCap。缺省用 dailyDeltaCap。 */
  dimCaps: Record<string, number>;
  /**
   * 启发式波动幅度：trait 水平越高 → 允许波动越大。
   * ⚠️ 这是工程启发式，**没有文献支持**，默认关闭。
   */
  heuristicVol: boolean;
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
    : [
        "extraversion",
        "agreeableness",
        "openness",
        "emotionality",
        "verbosity",
        "playfulness",
      ];
  return {
    enabled: boolEnv(process.env.FAKEREN_DRIFT_ENABLED, true),
    dailyDeltaCap: num(process.env.FAKEREN_DRIFT_DAILY_CAP, 0.15),
    cumulativeClamp: num(process.env.FAKEREN_DRIFT_CLAMP, 1.0),
    recentDays: num(process.env.FAKEREN_DRIFT_RECENT_DAYS, 7),
    historyDays: num(process.env.FAKEREN_DRIFT_HISTORY_DAYS, 14),
    dims,
    revertK: num(process.env.FAKEREN_DRIFT_REVERT_K, 0.2),
    softBand: num(process.env.FAKEREN_DRIFT_SOFT_BAND, 0.4),
    dimCaps: (() => {
      const raw = process.env.FAKEREN_DRIFT_DIM_CAPS;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const out: Record<string, number> = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) out[k] = n;
            }
            return out;
          }
        } catch {
          /* fall through to default — a malformed env must not crash startup */
        }
      }
      return { emotionality: 0.08 };
    })(),
    heuristicVol: boolEnv(process.env.FAKEREN_DRIFT_HEURISTIC_VOL, false),
    reportDir:
      process.env.FAKEREN_DRIFT_REPORT_DIR ??
      path.join(os.homedir(), ".fakeren", "drift-reports"),
  };
}

// ── Persona Layering (基础人设分层, docs/persona-layering.md) ───────────────
//   FAKEREN_PERSONA_LAYER_ENABLED  总开关 (1/true | 0/false，默认开)
//   FAKEREN_PERSONA_CORE_MAX       core 超长告警阈值 (字符，0 = 不告警)
//   FAKEREN_PERSONA_ANCHOR_ID      persona-identity 锚节点 id (默认 persona-identity)

export interface PersonaLayerConfig {
  /** master switch for the persona layering feature. */
  enabled: boolean;
  /** warn when personaCore exceeds this many chars (0 = no check). */
  coreMax: number;
  /** stable id of the in-graph persona-identity anchor node. */
  anchorId: string;
}

export function loadPersonaLayerConfig(): PersonaLayerConfig {
  return {
    enabled: boolEnv(process.env.FAKEREN_PERSONA_LAYER_ENABLED, true),
    coreMax: num(process.env.FAKEREN_PERSONA_CORE_MAX, 0),
    anchorId: process.env.FAKEREN_PERSONA_ANCHOR_ID ?? "persona-identity",
  };
}
