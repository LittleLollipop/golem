/**
 * DshAdapter — the *single* module that imports dsh's Cordis context.
 *
 * C3 (base-analysis §7): this is the only place that knows about dsh. rc
 * changes touch only here. Everything above (L2–L5) depends on the domain
 * API exposed by this class, never on dsh directly.
 *
 * Wiring model (verified against dsh @ b150a55 source, 2026-08-24):
 *   - pre-step is a **cordis event** `agent/pre-step`, NOT a service
 *     `ctx.agent.on('pre-step')`. The listener returns a `PreStepDecision`
 *     `{ kind: "enter", messages }` to inject leakage into the model context.
 *   - idle is a **cordis event** `agent/status` (status: "idle" | "running");
 *     we call `agent.runMaintenance(task)` when idle.
 *   - `agent`/`invariants` are NOT injectable at the profile root — they live
 *     in a nested scope — so we never list them in `inject`.
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type {
  DshContext,
  PreStepListener,
  RawSessionEvent,
  UserQuestions,
  StorageDomain,
  SessionPersistence,
  UserMessage,
} from "../types.js";

export class DshAdapter {
  constructor(private readonly ctx: DshContext) {}

  /**
   * Register a pre-step listener. dsh fires `agent/pre-step` with the pending
   * message list; we hand the listener our domain view, then return the
   * augmented list (baseline + injected leakage) as a `PreStepDecision`.
   */
  onPreStep(fn: PreStepListener): void {
    this.ctx.on("agent/pre-step", async (ev: any, _next: any) => {
      // dsh message → our domain shape (extract text content).
      const claimed: UserMessage[] = (ev?.messages ?? []).map((m: any) => ({
        role: "user" as const,
        content:
          typeof m?.content === "string" ? m.content : JSON.stringify(m?.content),
      }));

      const augmented: UserMessage[] = await fn({
        sessionId: String(ev?.agent?.session ?? ""),
        claimed,
      });

      // dsh expects an array of dsh-compliant messages.
      const leaked = augmented.map((m) =>
        createUserMessage({ content: m.content, source: { kind: "user" } }),
      );
      return { kind: "enter", messages: [...(ev?.messages ?? []), ...leaked] };
    });
  }

  /** Run non-turn work from the true idle phase (L0/L0.5 maintenance). */
  runIdle(task: () => Promise<void>): void {
    this.ctx.on("agent/status", (ev: any) => {
      if (ev?.status === "idle") {
        void ev.agent.runMaintenance(task);
      }
    });
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
