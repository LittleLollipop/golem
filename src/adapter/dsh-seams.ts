/**
 * DshAdapter — the *single* module that imports dsh's Cordis context.
 *
 * C3 (base-analysis §7): this is the only place that knows about dsh. rc
 * changes touch only here. Everything above (L2–L5) depends on the domain
 * API exposed by this class, never on dsh directly.
 */

import type {
  DshContext,
  PreStepListener,
  RawSessionEvent,
  UserQuestions,
  StorageDomain,
  SessionPersistence,
} from "../types.js";

export class DshAdapter {
  constructor(private readonly ctx: DshContext) {}

  /** Register a pre-step listener that returns the augmented message list. */
  onPreStep(fn: PreStepListener): void {
    this.ctx.agent.on("pre-step", (ev) => fn(ev));
  }

  /** Run non-turn work from the true idle phase (L0/L0.5 maintenance). */
  runIdle(task: () => Promise<void>): Promise<void> {
    return this.ctx.agent.runMaintenance(task);
  }

  whenIdle(): Promise<void> {
    return this.ctx.agent.whenIdle();
  }

  registerInvariant(name: string, check: (ctx: unknown) => void | Promise<void>): void {
    this.ctx.invariants.register(name, check);
  }

  askUser(question: string, opts?: { postFilter?: (answer: string) => boolean }): Promise<string> {
    return (this.ctx.userQuestions as UserQuestions).ask(question, opts);
  }

  /** RealHistoryCursor rides on sessionPersistence (NOT ctx.sessionQuery). */
  listSessions(): Promise<Array<{ id: string; createdAt: number; updatedAt: number }>> {
    return (this.ctx.sessionPersistence as SessionPersistence).list();
  }

  loadSessionEvents(id: string): Promise<RawSessionEvent[]> {
    return (this.ctx.sessionPersistence as SessionPersistence).load(id);
  }

  storage(): StorageDomain {
    return this.ctx.storageDomain;
  }
}
