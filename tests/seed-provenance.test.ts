import { describe, it, expect } from "vitest";
import { stampInjection } from "../src/agent/provenance.js";
import { FakerenAgent } from "../src/agent/fakeren-agent.js";
import { Grader } from "../src/agent/grader.js";
import type { ChannelContribution } from "../src/types.js";

const FIXED = new Date("2026-08-25T04:00:00.000Z");

describe("seed provenance stamping (req_seed_provenance)", () => {
  it("stamps injectedAt at assemble time, preserving source + selectionPath", () => {
    const contribs: ChannelContribution[] = [
      {
        channel: "drift",
        content: "x",
        seedId: "d1",
        provenance: { source: "edge:a->b", selectionPath: "crossDomain rank 1" },
      },
    ];
    stampInjection(contribs, FIXED);
    expect(contribs[0].provenance!.injectedAt).toBe("2026-08-25T04:00:00.000Z");
    expect(contribs[0].provenance!.source).toBe("edge:a->b");
    expect(contribs[0].provenance!.selectionPath).toBe("crossDomain rank 1");
  });

  it("falls back to seedId as source when a channel forgot provenance (audit never empty)", () => {
    const contribs: ChannelContribution[] = [
      { channel: "recall", content: "y", seedId: "recall_n1_0" },
    ];
    stampInjection(contribs, FIXED);
    expect(contribs[0].provenance!.source).toBe("recall_n1_0");
    expect(contribs[0].provenance!.selectionPath).toBe("unknown");
    expect(contribs[0].provenance!.injectedAt).toBe("2026-08-25T04:00:00.000Z");
  });

  it("does not mutate when there are no contributions", () => {
    expect(stampInjection([], FIXED)).toEqual([]);
  });
});

// ── assemble integration: provenance must be stamped + surfaced, but kept OUT
//    of the model-visible text (rule_mechanism_first: no fabricated content). ──
const driftStub = {
  gather: async () => [
    {
      channel: "drift" as const,
      content: "[跨域联想] a ↔ b",
      seedId: "drift_xd_a_b",
      valence: 0.3,
      provenance: { source: "edge:a->b", selectionPath: "crossDomain rank 1" },
    },
  ],
  getState: () => "cooling",
};
const recallStub = {
  gather: async () => [
    {
      channel: "recall" as const,
      content: "[图检索] 橘猫",
      seedId: "recall_n1_0",
      provenance: { source: "node:n1", selectionPath: "recall keyword match rank 1" },
    },
  ],
};
const situationalStub = { gather: async () => [], perceive: async () => {} };
const writerStub = { writeTurn: async () => {} };
const consolidatorStub = { run: async () => {} };
const busStub = { register: () => {} };
const persistStub = { loadSessionEvents: async () => [] };
const postFilterStub = { decide: (c: any) => ({ action: "keep", contributions: c, reason: "stub" }) };

function buildAgent() {
  return new FakerenAgent(
    new Grader(),
    driftStub as any,
    recallStub as any,
    situationalStub as any,
    writerStub as any,
    consolidatorStub as any,
    busStub as any,
    persistStub as any,
    postFilterStub as any,
  );
}

describe("assemble stamps + surfaces provenance (req_seed_provenance)", () => {
  it("stamps injectedAt on every contribution and exposes provenance in the assembled seeds", async () => {
    const agent = buildAgent();
    const res = await agent.assemble([], "今天过得怎么样", "instA", "persona");
    expect(res.contributions.length).toBeGreaterThan(0);
    for (const c of res.contributions) {
      expect(c.provenance?.injectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const assembledMsg = res.messages.find((m) => (m.meta as any)?.channel === "assembled");
    expect(assembledMsg).toBeDefined();
    const seeds = (assembledMsg!.meta as any).seeds as any[];
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(s.provenance?.injectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(s.provenance?.source).toBeTruthy();
      expect(s.provenance?.selectionPath).toBeTruthy();
    }
  });

  it("keeps provenance OUT of the model-visible leak block (no fabricated content)", async () => {
    const agent = buildAgent();
    const res = await agent.assemble([], "最近在想些什么", "instA", "persona");
    const assembledMsg = res.messages.find((m) => (m.meta as any)?.channel === "assembled");
    expect(assembledMsg!.content).not.toContain("provenance");
    expect(assembledMsg!.content).not.toContain("injectedAt");
  });
});
