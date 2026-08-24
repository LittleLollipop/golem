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

import * as fs from "node:fs";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type {
  DshContext,
  PreStepListener,
  RawSessionEvent,
  UserQuestions,
  SessionPersistence,
  UserMessage,
} from "../types.js";

/**
 * Persistent pre-step log. dsh's stdout/stderr lives in a transient background
 * task that the harness may reap, so we ALSO append every key event here. This
 * is the authoritative audit trail for "did the leak actually reach the model".
 */
const PRESTEP_LOG = process.env.FAKEREN_PRESTEP_LOG ?? "/tmp/fakeren-prestep.log";
function pLog(line: string): void {
  try {
    fs.appendFileSync(PRESTEP_LOG, line + "\n");
  } catch {
    /* best-effort; never let logging crash the agent */
  }
  console.error(line);
}

/** Flatten a dsh content (string | ContentBlock[] | other) into plain text. */
function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b?.text === "string" ? b.text : typeof b === "string" ? b : ""))
      .join("");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return String(content ?? "");
}

/** Log the real pre-step session shape once, to confirm the id field. */
let loggedSessionShape = false;

export class DshAdapter {
  constructor(private readonly ctx: DshContext) {}

  /**
   * Register a pre-step listener. dsh fires `agent/pre-step` with the pending
   * message list; we hand the listener our domain view, then return the
   * augmented list (baseline + injected leakage) as a `PreStepDecision`.
   */
  onPreStep(fn: PreStepListener): void {
    this.ctx.on("agent/pre-step", async (ev: any, _next: any) => {
      // dsh's session-reference plugin injects `agent` into the pre-step event;
      // ev.agent.session is a Session OBJECT (not a string id). Extract id
      // defensively and log the shape once so we can confirm the real field.
      const ag = ev?.agent;
      const sess = ag?.session;
      let sessionId: string;
      if (typeof sess === "string") {
        sessionId = sess;
      } else {
        sessionId = String(
          sess?.id ?? sess?.sessionId ?? ag?.id ?? ev?.sessionId ?? "",
        );
        if (!loggedSessionShape && sess) {
          loggedSessionShape = true;
          pLog(
            `[fakeren:pre-step] DEBUG agent.session keys=${JSON.stringify(Object.keys(sess))} id=${JSON.stringify(sess?.id)}`,
          );
        }
      }
      // dsh message → our domain shape. dsh content is ContentBlock[]; flatten
      // to plain text for the assemble fn (recall/drift/grade all work on text).
      const claimed: UserMessage[] = (ev?.messages ?? []).map((m: any) => ({
        role: "user" as const,
        content: toText(m?.content),
      }));
      pLog(`[fakeren:pre-step] enter session=${sessionId} claimed=${claimed.length}`);

      // The assemble fn touches the axolotl sidecar (registry/recall/drift).
      // If the sidecar is down it throws — never let that crash the dsh process.
      let augmented: UserMessage[] = claimed;
      try {
        augmented = await fn({ sessionId, claimed });
      } catch (err) {
        pLog(
          `[fakeren:pre-step] WARNING: assemble threw, injecting nothing (agent still runs): ${String(err)}`,
        );
      }

      // dsh requires content as ContentBlock[] (NOT a bare string). Wrap each
      // injected message's text in a text block so downstream .map() won't throw.
      // Only the *assembled* leakage block is newly injected — the baseline
      // claimed messages already live in ev.messages, so re-adding them would
      // duplicate the user's own turn.
      let leaked: unknown[] = [];
      try {
        leaked = augmented
          .filter((m) => m.meta && (m.meta as any).channel === "assembled")
          .map((m) =>
            createUserMessage({
              content: [{ type: "text" as const, text: m.content }],
              source: { kind: "user" },
            }),
          );
      } catch (err) {
        pLog(`[fakeren:pre-step] WARNING: createUserMessage threw: ${String(err)}`);
      }
      pLog(`[fakeren:pre-step] exit leaked=${leaked.length}`);
      for (const m of augmented) {
        if (m.meta && (m.meta as any).channel === "assembled") {
          pLog(`[fakeren:pre-step] LEAK BLOCK >>>\n${m.content}\n<<< LEAK BLOCK`);
        }
      }
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
}
