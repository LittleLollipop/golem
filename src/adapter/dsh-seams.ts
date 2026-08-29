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
import { recallBudget } from "../recall-budget.js";

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

/**
 * Persona injection. dsh's web profile has no fake-person identity, so the model
 * defaults to "I'm an AI" and rejects the leak as something to roleplay. The
 * agent surfaces a per-instance persona (channel="persona", #27); we inject it
 * as a user-role message BEFORE the real question + leak, ONCE per session
 * (the Set resets only on a full dsh restart, which is fine — a new session
 * just gets it again on its first turn). The DEFAULT_PERSONA lives in index.ts.
 *
 * Rendering contract (dsh 0.1.2-alpha.1 web UI): a `user/message` event renders
 * as a right-aligned USER BUBBLE when `source.kind === "user"`, but as a
 * collapsible inline CONTEXT block ("in the middle" of the conversation, never
 * as sent content) when `source.kind !== "user"`. Persona + subconscious
 * leakage MUST surface as those context blocks, so we tag them with a plugin
 * source. The model still receives them (pre-step `enter` messages are always
 * user-role), so `role` stays "user"; only `source.kind` changes the *display*.
 * We keep `fakeren` so loadSessionEvents() can still mark them `injected: true`
 * and exclude them from the memory graph (TODO#28 resolved).
 */

/**
 * Source tag for injected messages. ONLY a minimal `kind` marker is carried in
 * the dsh-persisted message source — `loadSessionEvents` (line ~246) uses the
 * presence of `fakeren` to mark events as `injected: true` so they are excluded
 * from the memory graph structurally.
 *
 * Seed provenance (id/source/selectionPath/injectedAt) is intentionally NOT
 * placed here: it belongs to golem's own audit trail (the pre-step log,
 * #55, and the scheduler log, #58), and embedding a nested object array into a
 * dsh-persisted `source` triggers "non-JSON-serializable data" when the host
 * dsh runtime serializes the `user/message` session event.
 */
function fakerenUserMessage(
  text: string,
  kind: "persona" | "subconscious" | "recall-pointer",
): ReturnType<typeof createUserMessage> {
  // source.kind !== "user" → dsh renders this as an inline CONTEXT block (in the
  // middle of the conversation) rather than a user bubble. Distinct plugin labels
  // keep persona vs leakage vs recall-index visually distinguishable. `fakeren`
  // is retained for loadSessionEvents()'s injected-detection.
  const plugin =
    kind === "persona" ? "golem-identity"
    : kind === "recall-pointer" ? "golem-recall"
    : "golem-leak";
  return createUserMessage({
    content: [{ type: "text" as const, text }],
    source: { kind: "plugin", plugin, fakeren: { kind } } as any,
  });
}

const personaSeen = new Set<string>();

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
            `[golem:pre-step] DEBUG agent.session keys=${JSON.stringify(Object.keys(sess))} id=${JSON.stringify(sess?.id)}`,
          );
        }
      }
      // dsh numbers steps WITHIN a turn: step 1 is the turn's user-facing opening
      // (the user's prompt enters), step >= 2 are tool-loop continuations. We use
      // this to suppress the subconscious leak on every non-first step (bug
      // reported 2026-08-29 — one leak was injected per search call).
      const step = typeof ev?.step === "number" ? ev.step : undefined;
      const turn = typeof ev?.turn === "number" ? ev.turn : undefined;
      // Reset the per-turn recall budget at the turn's step-1 opening so the cap
      // persists across tool-loop continuations (step >= 2) within the same turn
      // (dual-mechanism-recall.md §6). Only on an explicit step===1, so older dsh
      // builds that never send `step` don't clobber the counter every call.
      if (step === 1) recallBudget.reset(sessionId);
      // dsh message → our domain shape. dsh content is ContentBlock[]; flatten
      // to plain text for the assemble fn (recall/drift/grade all work on text).
      const claimed: UserMessage[] = (ev?.messages ?? []).map((m: any) => ({
        role: "user" as const,
        content: toText(m?.content),
      }));
      pLog(
        `[golem:pre-step] enter session=${sessionId} turn=${turn ?? "?"} step=${step ?? "?"} claimed=${claimed.length}`,
      );

      // On a tool-loop continuation (step >= 2) the model is reasoning/retrieving,
      // NOT addressing the user. Skip assemble() entirely: it only produces
      // persona/leak blocks we would discard, and its drift/recall/situational
      // gathers hit the sidecar for nothing. The leak is a per-turn *expression*
      // layer for replies to the USER, so it rides only the step-1 opening.
      const isToolContinuation = step !== undefined && step > 1;

      // The assemble fn touches the axolotl sidecar (registry/recall/drift).
      // If the sidecar is down it throws — never let that crash the dsh process.
      let augmented: UserMessage[] = claimed;
      if (isToolContinuation) {
        pLog(
          `[golem:pre-step] tool-continuation (turn=${turn ?? "?"} step=${step ?? "?"}) → skip assemble + leak`,
        );
      } else {
        try {
          augmented = await fn({ sessionId, claimed });
        } catch (err) {
          pLog(
            `[golem:pre-step] WARNING: assemble threw, injecting nothing (agent still runs): ${String(err)}`,
          );
        }
      }

      // dsh requires content as ContentBlock[] (NOT a bare string). Wrap each
      // injected message's text in a text block so downstream .map() won't throw.
      // Only the *assembled* leakage block is newly injected — the baseline
      // claimed messages already live in ev.messages, so re-adding them would
      // duplicate the user's own turn.
      //
      // The agent surfaces two synthetic blocks: a per-instance persona
      // (channel "persona") injected ONCE per session, and the subconscious
      // leak block (channel "assembled") injected on the step-1 opening of each
      // turn. On tool-loop continuations (step >= 2) assemble() was skipped, so
      // augmented === claimed and neither block is present → nothing leaks.
      const personaBlock = augmented.find(
        (m) => m.meta && (m.meta as any).channel === "persona",
      );
      let personaMsg: unknown[] = [];
      try {
        if (personaBlock && sessionId && !personaSeen.has(sessionId)) {
          personaSeen.add(sessionId);
          personaMsg.push(fakerenUserMessage(personaBlock.content, "persona"));
          pLog(`[golem:pre-step] persona injected for session=${sessionId}`);
        }
      } catch (err) {
        pLog(`[golem:pre-step] WARNING: persona createUserMessage threw: ${String(err)}`);
      }
      let leaked: unknown[] = [];
      try {
        leaked = augmented
          .filter((m) => m.meta && (m.meta as any).channel === "assembled")
          .map((m) => fakerenUserMessage(m.content, "subconscious"));
      } catch (err) {
        pLog(`[golem:pre-step] WARNING: createUserMessage threw: ${String(err)}`);
      }
      // Mechanism A pointer block (dual-mechanism-recall.md §3): a "memory index"
      // surfaced as its own inline context block (plugin label golem-recall),
      // distinct from the subconscious leak block.
      let pointerMsg: unknown[] = [];
      try {
        const pointerBlock = augmented.find(
          (m) => m.meta && (m.meta as any).channel === "recall-pointer",
        );
        if (pointerBlock) {
          pointerMsg.push(fakerenUserMessage(pointerBlock.content, "recall-pointer"));
          pLog(`[golem:pre-step] recall-pointer injected for session=${sessionId}`);
        }
      } catch (err) {
        pLog(`[golem:pre-step] WARNING: recall-pointer createUserMessage threw: ${String(err)}`);
      }
      pLog(`[golem:pre-step] exit leaked=${leaked.length} pointer=${pointerMsg.length}`);
      for (const m of augmented) {
        if (m.meta && (m.meta as any).channel === "assembled") {
          pLog(`[golem:pre-step] LEAK BLOCK >>>\n${m.content}\n<<< LEAK BLOCK`);
          const seeds = (m.meta as any).seeds as any[] | undefined;
          if (Array.isArray(seeds)) {
            for (const s of seeds) {
              const p = s.provenance;
              if (p) {
                pLog(
                  `[golem:pre-step]   seed ${s.id} [${s.channel}] src=${p.source} path="${p.selectionPath}" at=${p.injectedAt ?? "?"}`,
                );
              }
            }
          }
        }
      }
      return {
        kind: "enter",
        messages: [...personaMsg, ...(ev?.messages ?? []), ...leaked, ...pointerMsg],
      };
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

  /**
   * RealHistoryCursor. dsh's `sessionPersistence.load(id)` returns a
   * `SessionInspection` ({ meta, events }) — NOT a raw event array. We unwrap
   * `.events` and normalize each dsh `SessionEvent` ({ type: "user/message" |
   * "assistant/message", data, time }) into golem's `RawSessionEvent`
   * ({ type: "user" | "assistant", timestamp, payload: { text } }), which is
   * what drift/syncLatestTurn consume.
   *
   * dsh forbids `load()` while the session's live turn is open (red line:
   * "use the live Session or wait for the turn to close"). During pre-step the
   * current session IS live, so the call throws — we swallow it and return []
   * so the rest of `assemble` keeps running (the live turn's own events are
   * mid-flight and shouldn't be leaked as "往昔" anyway). Past (closed)
   * sessions load fine and yield real events.
   */
  async loadSessionEvents(id: string): Promise<RawSessionEvent[]> {
    let inspection: any;
    try {
      inspection = await (this.ctx.sessionPersistence as SessionPersistence).load(id);
    } catch {
      return []; // live turn open, or session not found → nothing to read
    }
    const events = Array.isArray(inspection?.events) ? inspection.events : [];
    const out: RawSessionEvent[] = [];
    for (const e of events) {
      const t = e?.type;
      if (t !== "user/message" && t !== "assistant/message") continue;
      const data = e?.data ?? {};
      // dsh stores message text as `content: ContentBlock[]` ({type:'text',text}).
      // `user/message` → data.content; `assistant/message` → data.message.content.
      const raw =
        t === "user/message"
          ? (data as any)?.content
          : (data as any)?.message?.content;
      const text = toText(raw);
      if (text.length === 0) continue;
      // TODO#28: a message golem synthesized (persona / leak) carries
      // `source.fakeren` in its dsh source tag. Surface that as `injected` so
      // syncLatestTurn can exclude it from the memory graph structurally
      // (no string-prefix matching).
      const injected = Boolean((data as any)?.source?.fakeren);
      out.push({
        type: t === "user/message" ? "user" : "assistant",
        timestamp: typeof e?.time === "number" ? e.time : Date.now(),
        payload: { text },
        ...(injected ? { injected: true } : {}),
      });
    }
    return out;
  }
}
