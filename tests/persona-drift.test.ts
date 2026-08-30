/**
 * PersonaDriftService unit tests — exercises the data model, guards, and
 * persistence WITHOUT the axolotl sidecar (FakeGraphStore + a scripted LLM).
 *
 * Covers docs/persona-drift.md §11 test cases:
 *   1. compose: no drift → base verbatim
 *   2. compose: drift → appends 【近期性格倾向】
 *   3. cumulative clamp (soft boundary)
 *   4. idempotent per calendar day (dedup via existing node)
 *   5. no LLM → skip (no node written)
 *   6. no dialogue → skip (chain gap)
 *   7. happy path → 1 node + causal + relates edges
 *   8. single-day delta clamp
 */
import { describe, it, expect } from "vitest";
import type { GraphStore, QuerySpec } from "../src/memory/graph-store.js";
import type { LlmClient } from "../src/llm/client.js";
import type { GraphNode, GraphEdge, InstanceId } from "../src/types.js";
import { PersonaDriftService } from "../src/agent/persona-drift.js";
import type { PersonaDriftConfig } from "../src/leak/config.js";
import { FakeGraphStore } from "./fake-graph-store.js";

const INST = "test-inst";

const cfg: PersonaDriftConfig = {
  enabled: true,
  dailyDeltaCap: 0.15,
  cumulativeClamp: 1.0,
  recentDays: 7,
  historyDays: 14,
  dims: ["openness", "warmth", "verbosity", "playfulness", "assertiveness"],
};

/** a fixed "now" so today's date is deterministic across assertions. */
const NOW = new Date(2026, 7, 30); // 2026-08-30 local
const YESTERDAY = new Date(2026, 7, 29);

class FakeLlm implements LlmClient {
  constructor(private resp: string) {}
  async complete(): Promise<string> {
    return this.resp;
  }
}

function mkEvent(
  id: string,
  props: Record<string, unknown>,
  ts: number,
  instanceId: InstanceId = INST,
): GraphNode {
  return {
    id,
    type: "Event",
    label: typeof props.userText === "string" ? String(props.userText).slice(0, 40) : id,
    instanceId,
    props,
    valence: 0,
    valenceSelf: true,
    weight: 1,
    decayed: false,
    timestamp: ts,
  };
}

function seedDialogue(store: GraphStore, daysAgo: number): void {
  const ts = NOW.getTime() - daysAgo * 86_400_000;
  store.addNode(
    mkEvent(
      `evt_${daysAgo}`,
      {
        userText: "你觉得写作技巧有哪些",
        assistantSummary: "我建议先从结构入手，写大纲再填充细节。",
      },
      ts,
    ),
  );
}

describe("PersonaDriftService", () => {
  it("composeEffectivePersona returns base verbatim when no drift exists", async () => {
    const store = new FakeGraphStore();
    const svc = new PersonaDriftService(store, undefined, cfg);
    const base = "你是林夏，内向但温柔。";
    const out = await svc.composeEffectivePersona(base, INST);
    expect(out).toBe(base);
  });

  it("composeEffectivePersona appends leanings when drift exists", async () => {
    const store = new FakeGraphStore();
    // a prior drift node with an openness lean
    store.addNode(
      mkEvent(
        "persona-drift-2026-08-29-aaa",
        {
          kind: "persona_drift",
          date: "2026-08-29",
          dims: { openness: 0.1 },
          cumulative: { openness: 0.4 },
          evidence: [],
        },
        YESTERDAY.getTime(),
      ),
    );
    const svc = new PersonaDriftService(store, undefined, cfg);
    const out = await svc.composeEffectivePersona("你是林夏。", INST);
    expect(out).toContain("你是林夏。");
    expect(out).toContain("【近期性格倾向】");
    expect(out).toContain("开放性");
  });

  it("clamps cumulative at the soft boundary", async () => {
    const store = new FakeGraphStore();
    // prior cumulative already at 0.95
    store.addNode(
      mkEvent(
        "persona-drift-2026-08-29-bbb",
        {
          kind: "persona_drift",
          date: "2026-08-29",
          dims: { openness: 0.95 },
          cumulative: { openness: 0.95 },
          evidence: [],
        },
        YESTERDAY.getTime(),
      ),
    );
    seedDialogue(store, 1);
    // model returns a large delta (0.9) → must be clamped to daily cap 0.15,
    // then cumulative 0.95+0.15 = 1.10 → clamped to 1.0
    const llm = new FakeLlm(
      JSON.stringify({ dims: { openness: 0.9 }, evidence: ["evt_1"] }),
    );
    const svc = new PersonaDriftService(store, llm, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();
    expect(rec!.dims.openness).toBe(0.15); // single-day clamp
    expect(rec!.cumulative.openness).toBe(1.0); // cumulative clamp
  });

  it("is idempotent per calendar day (dedup via existing node)", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { warmth: 0.05 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg);
    const first = await svc.introspect(INST, NOW);
    expect(first).not.toBeNull();
    const second = await svc.introspect(INST, NOW); // same day → skip
    expect(second).toBeNull();
    const driftNodes = store.allNodes.filter(
      (n) => (n.props as any).kind === "persona_drift",
    );
    expect(driftNodes).toHaveLength(1);
  });

  it("skips when no LLM is configured", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    const svc = new PersonaDriftService(store, undefined, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec).toBeNull();
    expect(
      store.allNodes.filter((n) => (n.props as any).kind === "persona_drift"),
    ).toHaveLength(0);
  });

  it("skips when there is no recent dialogue (chain gap)", async () => {
    const store = new FakeGraphStore();
    // only an Entity node, no dialogue Event
    store.addNode({
      id: "ent_x",
      type: "Entity",
      label: "写作",
      instanceId: INST,
      props: {},
      valence: 0,
      valenceSelf: true,
      weight: 1,
      decayed: false,
    });
    const llm = new FakeLlm(JSON.stringify({ dims: { warmth: 0.05 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec).toBeNull();
  });

  it("happy path: writes drift node + causal + relates edges", async () => {
    const store = new FakeGraphStore();
    // prior drift node to chain onto
    store.addNode(
      mkEvent(
        "persona-drift-2026-08-29-ccc",
        {
          kind: "persona_drift",
          date: "2026-08-29",
          dims: { warmth: 0.1 },
          cumulative: { warmth: 0.1 },
          evidence: [],
        },
        YESTERDAY.getTime(),
      ),
    );
    seedDialogue(store, 1);
    const llm = new FakeLlm(
      JSON.stringify({
        dims: { warmth: 0.08, playfulness: 0.04 },
        mood: "轻快",
        leaning: "更愿意开玩笑",
        rationale: "今天聊得开心",
        evidence: ["evt_1"],
      }),
    );
    const svc = new PersonaDriftService(store, llm, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();
    const driftNodes = store.allNodes.filter(
      (n) => (n.props as any).kind === "persona_drift",
    );
    expect(driftNodes).toHaveLength(2);
    // causal edge from prior → new
    const causal = store.allEdges.find(
      (e) => e.kind === "causal" && e.from === "persona-drift-2026-08-29-ccc",
    );
    expect(causal).toBeDefined();
    // relates edge to evidence
    const relates = store.allEdges.find((e) => e.kind === "relates" && e.to === "evt_1");
    expect(relates).toBeDefined();
  });

  it("clamps a runaway single-day delta from the model", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.9 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec!.dims.openness).toBe(0.15); // 0.9 → cap 0.15
  });

  it("drops non-dimension fields the model tries to inject", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    // model tries to rewrite base persona via an out-of-set key
    const llm = new FakeLlm(
      JSON.stringify({
        dims: { warmth: 0.05 },
        persona: "我变成了一个完全不同的人",
        evidence: [],
      }),
    );
    const svc = new PersonaDriftService(store, llm, cfg);
    const rec = await svc.introspect(INST, NOW);
    expect(rec!.dims.warmth).toBe(0.05);
    // the rogue field never reaches the stored record's dims
    expect(Object.keys(rec!.dims)).toEqual(["warmth"]);
  });
});
