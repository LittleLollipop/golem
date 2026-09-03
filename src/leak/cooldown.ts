/**
 * LeakCooldown — ONE cooldown implementation shared by every drift sub-channel
 * (req_leak_cooldown_symmetry, docs/leak-seed-pool.md §4.1).
 *
 * ### Why this exists
 *
 * The 2026-08-29 requirement — "同一个会话里相同的记忆不需要反复的漏" — used to
 * be implemented twice, inconsistently:
 *
 * | sub-channel  | before                                  | symptom                     |
 * |---|---|---|
 * | crossDomain  | no dedup at all (regathered every turn) | old knowledge leaked 20/40 turns |
 * | L0.5         | once-per-session, forever               | new knowledge leaked once, then never again (67 / 17 / 3 turns silent) |
 *
 * It was never a conflict between two requirements — it was ONE requirement
 * implemented at half strength on one side and over-shot on the other. Both
 * sides now go through this class so they cannot drift apart again.
 *
 * ### Semantics
 *
 * `available()` is true when **any** declared gate has elapsed ("取先到"):
 *   - `policy.turns` — N `beginTurn()` calls must have passed since the last leak
 *   - `policy.ms`    — N milliseconds must have passed since the last leak
 * An undeclared gate is *not* a satisfied gate (otherwise a time-only policy
 * would release instantly). Zero declared gates → always available.
 *
 * Scope is the conversation (`sessionId`): a fresh conversation starts with an
 * empty cooldown table, so a fact can remind again in a later talk.
 */

export interface CooldownPolicy {
  /** Turns that must elapse before the same key may leak again. Undeclared = not gated by turns. */
  turns?: number;
  /** Milliseconds that must elapse before the same key may leak again. Undeclared = not gated by time. */
  ms?: number;
}

/**
 * crossDomain (old knowledge) — the pool is static-ish and was re-gathered every
 * single turn, so it needs a real gate. 10 turns *or* 30 minutes, whichever
 * comes first: a long session stops seeing the same 3 edges on every turn, while
 * a session that stalls for half an hour gets fresh air on return.
 */
export const CROSS_DOMAIN_COOLDOWN: CooldownPolicy = {
  turns: 10,
  ms: 30 * 60 * 1000,
};

/**
 * L0.5 (new knowledge) — 6h, NOT the 24h the design doc first proposed.
 *
 * ⚠️ Why 24h would have been a no-op: `l05FreshDays` is 1, so a fact is only a
 * candidate for 24h after it is learned. A 24h cooldown inside a 24h freshness
 * window means "at most one leak per fact" — *exactly* what the old
 * once-per-session Set already did. The bug (new knowledge never surfaces)
 * would have survived the fix untouched.
 *
 * 6h puts ~4 reminders inside the freshness window (0h / 6h / 12h / 18h) —
 * enough to be noticed, far from "每轮都漏". `l05FreshDays` stays the hard
 * gate: after 24h the fact ages out entirely, so the cool-down never extends
 * a fact's life, it only paces it.
 */
export const L05_COOLDOWN: CooldownPolicy = { ms: 6 * 3600 * 1000 };

interface LeakRecord {
  /** turn index (within scope) at which this key was last leaked; -1 = never */
  turn: number;
  /** epoch ms at which this key was last leaked */
  at: number;
}

/** Never leaked ⇒ treated as maximally starved (see `turnsSince`). */
const NEVER: LeakRecord = { turn: -1, at: Number.NEGATIVE_INFINITY };

export class LeakCooldown {
  /** `${scope}\u0000${key}` → last leak record */
  private readonly records = new Map<string, LeakRecord>();
  /** scope → turn counter (advanced by beginTurn) */
  private readonly turnOf = new Map<string, number>();

  /**
   * Advance the turn counter for a scope and return the new index.
   * Called once per drift gather — a turn suppressed by triggerProbability
   * does NOT advance the counter (nothing leaked, so nothing cooled down).
   */
  beginTurn(scope: string): number {
    const next = (this.turnOf.get(scope) ?? -1) + 1;
    this.turnOf.set(scope, next);
    return next;
  }

  currentTurn(scope: string): number {
    return this.turnOf.get(scope) ?? -1;
  }

  /**
   * Record that `key` leaked in `scope` **now**. Also implicitly starts the
   * scope's turn counter at 0 if it has not begun yet.
   */
  take(scope: string, key: string, now: number = Date.now()): void {
    if (!this.turnOf.has(scope)) this.turnOf.set(scope, 0);
    this.records.set(this.id(scope, key), { turn: this.turnOf.get(scope)!, at: now });
    this.evictIfLarge();
  }

  /** Whether `key` has ever leaked in `scope` (never-leaked = maximally starved). */
  hasLeaked(scope: string, key: string): boolean {
    return this.records.has(this.id(scope, key));
  }

  /** Whether `key` is released from cooldown in `scope`. */
  available(
    scope: string,
    key: string,
    policy: CooldownPolicy,
    now: number = Date.now(),
  ): boolean {
    const r = this.records.get(this.id(scope, key));
    if (!r) return true;
    const gates: boolean[] = [];
    if (policy.turns !== undefined) {
      gates.push((this.turnOf.get(scope) ?? 0) - r.turn >= policy.turns);
    }
    if (policy.ms !== undefined) {
      gates.push(now - r.at >= policy.ms);
    }
    return gates.length === 0 ? true : gates.some(Boolean);
  }

  /**
   * Turns elapsed since `key` last leaked in `scope` (capped at `cap`).
   * Never-leaked keys return `cap` — i.e. maximally starved, which is what
   * weights the crossDomain rotation towards seeds that have not been surfaced
   * yet (docs/leak-seed-pool.md §4.2).
   */
  turnsSince(scope: string, key: string, cap: number): number {
    const r = this.records.get(this.id(scope, key)) ?? NEVER;
    if (r.turn < 0) return cap;
    return Math.min(Math.max(0, (this.turnOf.get(scope) ?? 0) - r.turn), cap);
  }

  /** Test seam: drop all cooldown state (scope isolation is asserted per-session). */
  reset(): void {
    this.records.clear();
    this.turnOf.clear();
  }

  private id(scope: string, key: string): string {
    return `${scope}\u0000${key}`;
  }

  /** Bound memory in a long-running process: hard cap, then drop the oldest half. */
  private evictIfLarge(): void {
    if (this.records.size <= 4096) return;
    let drop = Math.floor(this.records.size / 2);
    for (const k of this.records.keys()) {
      if (drop-- <= 0) break;
      this.records.delete(k);
    }
  }
}
