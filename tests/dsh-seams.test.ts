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
    // (the real FakerenAgent.provenance stamping produces exactly this shape).
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
