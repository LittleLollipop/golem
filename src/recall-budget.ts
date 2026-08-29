/**
 * RecallBudget — per-turn guard for the model-driven `memory_recall` tool.
 *
 * The model can call `memory_recall` any number of times; without a cap the
 * token cost of pulling full memory nodes explodes. We budget calls per TURN
 * (dual-mechanism-recall.md §6). The budget is keyed by sessionId and reset at
 * the turn's step-1 opening (dsh-seams pre-step), so it survives the tool-loop
 * continuations (step >= 2) within a turn instead of resetting on every step.
 */

export class RecallBudget {
  private readonly counts = new Map<string, number>();

  constructor(private readonly perTurnLimit = 3) {}

  /** Reset the allowance for a session at the start of a new turn. */
  reset(key: string): void {
    this.counts.set(key, 0);
  }

  /**
   * Consume one allowance unit for `key`.
   * @returns remaining calls after this consume, or `-1` if the budget is
   *   already exhausted (caller should return a "limit reached" signal).
   */
  tryConsume(key: string): number {
    const used = this.counts.get(key) ?? 0;
    if (used >= this.perTurnLimit) return -1;
    const next = used + 1;
    this.counts.set(key, next);
    return this.perTurnLimit - next;
  }
}

/** Shared singleton: dsh-seams resets it (step 1), the tool consumes it. */
export const recallBudget = new RecallBudget(3);
