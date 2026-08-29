import { describe, it, expect } from "vitest";
import { DshAdapter } from "../src/adapter/dsh-seams.js";

/** Minimal dsh context that captures the pre-step listener (mirrors verify-prestep.mjs). */
function makeMockCtx() {
  let preStep: ((ev: any, next: any) => Promise<any>) | null = null;
  const ctx: any = {
    on(event: string, listener: any) {
      if (event === "agent/pre-step") preStep = listener;
    },
    sessionPersistence: { list: async () => [], load: async () => ({ events: [] }) },
    userQuestions: { ask: async (_q: string) => "" },
  };
  return { ctx, getPreStep: () => preStep };
}

describe("DshAdapter.onPreStep — message source hygiene", () => {
  it("never embeds seed provenance into the dsh-persisted message source", async () => {
    const { ctx, getPreStep } = makeMockCtx();
    const adapter = new DshAdapter(ctx);

    // Assemble stub that returns an injected "assembled" block carrying seeds
    // (the real GolemAgent.provenance stamping produces exactly this shape).
    adapter.onPreStep(async () => [
      {
        role: "user",
        content: "（你心里很清楚：）\n喜欢在雨天独处听歌 ↔ 对陌生环境有警惕心",
        meta: {
          channel: "assembled",
          seeds: [
            {
              id: "drift_xd_a_b",
              channel: "drift",
              valence: 0,
              provenance: {
                source: "edge:a->b",
                selectionPath: "crossDomain by |valence| rank 1 (valence 0)",
                injectedAt: "2026-08-26T00:00:00.000Z",
              },
            },
          ],
        },
      },
    ]);

    const preStep = getPreStep();
    expect(preStep).toBeTruthy();

    const decision = await preStep(
      {
        agent: { session: "s-dsh-seams-test-1" },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      () => {},
    );

    expect(decision.kind).toBe("enter");
    const injected = (decision.messages as any[]).filter((m) => m.source?.fakeren);
    expect(injected.length).toBeGreaterThan(0);

    for (const m of injected) {
      // The regression: seeds must NOT ride along in the dsh-persisted source,
      // otherwise the host dsh runtime throws
      // "session event 'user/message' carries non-JSON-serializable data".
      expect(m.source.fakeren.seeds).toBeUndefined();
      expect(["persona", "subconscious"]).toContain(m.source.fakeren.kind);
    }
  });
});

describe("DshAdapter.onPreStep — tool-loop leak suppression (2026-08-29)", () => {
  /** Assemble stub returning one leak + one persona block, like the real agent. */
  function makeAssemble() {
    const calls = { count: 0 };
    const fn = async () => {
      calls.count++;
      return [
        {
          role: "user" as const,
          content: "（你心里很清楚：）\nleak fragment",
          meta: { channel: "assembled" },
        },
        {
          role: "user" as const,
          content: "persona text",
          meta: { channel: "persona" },
        },
      ];
    };
    return { fn, calls };
  }

  async function runPreStep(ev: any) {
    const { ctx, getPreStep } = makeMockCtx();
    const adapter = new DshAdapter(ctx);
    const { fn, calls } = makeAssemble();
    adapter.onPreStep(fn);
    const decision = await getPreStep()!(ev, () => {});
    return { calls, decision };
  }

  it("skips assemble() and injects no leak on a tool-loop continuation (step >= 2)", async () => {
    const { calls, decision } = await runPreStep({
      agent: { session: "s-tool-loop-1" },
      messages: [{ role: "user", content: [{ type: "text", text: "tool result" }] }],
      turn: 1,
      step: 2,
    });
    // the whole point: don't spin the sidecar or leak on every search call
    expect(calls.count).toBe(0);
    const injected = (decision.messages as any[]).filter((m) => m.source?.fakeren);
    expect(injected.length).toBe(0);
  });

  it("still assembles and injects the leak on the turn-opening step (step === 1)", async () => {
    const { calls, decision } = await runPreStep({
      agent: { session: "s-tool-loop-2" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      turn: 1,
      step: 1,
    });
    expect(calls.count).toBe(1);
    const leaked = (decision.messages as any[]).filter(
      (m) => m.source?.fakeren?.kind === "subconscious",
    );
    expect(leaked.length).toBe(1);
  });
});
