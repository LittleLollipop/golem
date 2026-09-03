/**
 * Pure helpers for the inspect CLI (req_inspect_cli). Kept free of I/O so they
 * are unit-testable under vitest and reusable by scripts/inspect.mjs.
 *
 * Three views, per the requirement:
 *   - 当前状态  (current state)  — driven by parseLeakConfig + ledger/sidecar introspection
 *   - 今日所学  (today learned)  — driven by reading the per-instance knowledge ledger
 *   - 近期种子  (recent seeds)   — driven by lastSeedsFromLog over the pre-step audit log
 */

/** Replicates src/leak/config.ts loadLeakConfig without importing TS (plain node). */
export function parseLeakConfig(env = process.env) {
  const num = (k, fb) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 0 ? v : fb;
  };
  const tp = Number(env.FAKEREN_LEAK_TRIGGER_P);
  return {
    maxSeeds: num("FAKEREN_LEAK_MAX", 0),
    driftLimit: num("FAKEREN_LEAK_DRIFT", 3),
    ambientLimit: num("FAKEREN_LEAK_AMBIENT", 2),
    l05Limit: num("FAKEREN_LEAK_L05", 2),
    l05FreshDays: num("FAKEREN_LEAK_L05_FRESH_DAYS", 1),
    triggerProbability: Number.isFinite(tp) && tp >= 0 && tp <= 1 ? tp : 1,
    // FAKEREN_LEAK_MIN_VALENCE removed in v0.6.0 — dead config: cross-domain
    // edges carry no valence, so the floor never filtered anything.
  };
}

/**
 * Parse one pre-step audit line produced by dsh-seams.ts (#55 provenance logging):
 *   [golem:pre-step]   seed <id> [<channel>] src=<source> path="<selectionPath>" at=<iso>
 * Returns null for non-seed lines so callers can filter the whole log safely.
 */
const SEED_RE = /^\[golem:pre-step\]   seed (.+) \[(\w+)\] src=(.+) path="(.+)" at=(.+)$/;

export function parseSeedLine(line) {
  const m = SEED_RE.exec(line ?? "");
  if (!m) return null;
  return { id: m[1], channel: m[2], source: m[3], selectionPath: m[4], at: m[5] };
}

/** Extract the most recent `n` seed records from a pre-step log's text. */
export function lastSeedsFromLog(text, n = 20) {
  if (!text) return [];
  const seeds = [];
  for (const line of text.split("\n")) {
    const s = parseSeedLine(line);
    if (s) seeds.push(s);
  }
  return n > 0 ? seeds.slice(-n) : seeds;
}

/** List instance ids that have a knowledge ledger under `dir`. */
export function listLedgerInstances(dir, readdirSync) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/**
 * 后台调度运行日志（req_background_task_log）默认路径，与运行时一致。
 */
export function defaultSchedulerLogPath(env = process.env) {
  return env.FAKEREN_SCHEDULER_LOG ?? ".fakeren-scheduler.log";
}

/**
 * Parse one JSONL scheduler-log line into a structured event. Returns null for
 * blank / unparseable lines so callers can filter the whole file safely.
 * Event shape: { ts, kind: "learn"|"refresh"|"drift", instanceId, detail }.
 */
export function parseSchedulerEvent(line) {
  const t = (line ?? "").trim();
  if (!t) return null;
  try {
    const e = JSON.parse(t);
    if (e && typeof e.kind === "string" && typeof e.ts === "string") return e;
  } catch {
    /* skip malformed line */
  }
  return null;
}

/** Extract the most recent `n` scheduler events from a log's text. */
export function parseSchedulerLog(text, n = 50) {
  if (!text) return [];
  const events = [];
  for (const line of text.split("\n")) {
    const e = parseSchedulerEvent(line);
    if (e) events.push(e);
  }
  return n > 0 ? events.slice(-n) : events;
}
