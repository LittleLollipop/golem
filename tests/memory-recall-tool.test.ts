import { describe, it, expect } from "vitest";
import { createMemoryRecallTool, extractSessionId } from "../src/tools/memory-recall.js";
import type { GraphNode, InstanceId } from "../src/types.js";

function node(id: string, label: string, summary = ""): GraphNode {
  return {
    id,
    type: "Entity",
    label,
    instanceId: "x",
    props: summary ? { assistantSummary: summary } : {},
    valence: 0,
    valenceSelf: true,
    weight: 1,
    decayed: false,
  };
}

/** Stub RecallChannel.fetchNodes */
class StubRecall {
  constructor(private readonly nodes: GraphNode[]) {}
  async fetchNodes(_q: string, _i: InstanceId, _l?: number): Promise<GraphNode[]> {
    return this.nodes;
  }
}

/** Stub InstanceRegistry.current */
class StubRegistry {
  constructor(private readonly inst: InstanceId | null) {}
  async current(_s: string): Promise<InstanceId | null> {
    return this.inst;
  }
}

/** Stub RecallBudget with a fixed remaining counter */
class StubBudget {
  constructor(private remaining = 3) {}
  tryConsume(_k: string): number {
    return this.remaining-- > 0 ? this.remaining : -1;
  }
  reset(): void {}
}

const deps = (over: Partial<{ inst: InstanceId | null; nodes: GraphNode[]; remaining: number }> = {}) => ({
  registry: new StubRegistry(over.inst === undefined ? "instA" : over.inst) as any,
  recall: new StubRecall(over.nodes ?? []) as any,
  budget: new StubBudget(over.remaining ?? 3) as any,
});

describe("createMemoryRecallTool", () => {
  it("extractSessionId reads the dsh agent shape (verified against dsh-src)", () => {
    expect(extractSessionId({ session: { id: "sess-9" } })).toBe("sess-9");
    expect(extractSessionId({ session: "sess-str" })).toBe("sess-str");
    expect(extractSessionId({ id: "fallback" })).toBe("fallback");
  });

  it("returns fetched node content as the tool_result", async () => {
    const tool = createMemoryRecallTool(
      deps({ nodes: [node("n1", "橘猫豆豆", "它是一只爱睡觉的橘猫")] }),
    );
    const res = await tool.execute({ query: "橘猫" }, { agent: { session: { id: "sess-1" } } });
    expect(res).toContain("〔橘猫豆豆〕");
    expect(res).toContain("它是一只爱睡觉的橘猫");
  });

  it("returns a 'limit reached' signal when the budget is exhausted", async () => {
    const tool = createMemoryRecallTool(
      deps({ nodes: [node("n1", "x", "y")], remaining: 0 }),
    );
    const res = await tool.execute({ query: "x" }, { agent: { session: { id: "sess-1" } } });
    expect(res).toContain("已达上限");
  });

  it("returns a 'no instance bound' signal when registry has no instance", async () => {
    const tool = createMemoryRecallTool(deps({ inst: null, nodes: [node("n1", "x", "y")] }));
    const res = await tool.execute({ query: "x" }, { agent: { session: { id: "sess-1" } } });
    expect(res).toContain("尚未绑定");
  });

  it("returns an 'empty' signal when no node matches", async () => {
    const tool = createMemoryRecallTool(deps({ nodes: [] }));
    const res = await tool.execute({ query: "x" }, { agent: { session: { id: "sess-1" } } });
    expect(res).toContain("没有与检索词相关");
  });

  it("parameters is an object-rooted JSON Schema (regression: dsh rejects non-object roots)", () => {
    const tool = createMemoryRecallTool(deps({}));
    const p = (tool as any).parameters;
    // Root MUST declare type:"object" + properties; dsh forwards this verbatim
    // to the model provider, which rejects roots without type:"object".
    expect(p).toBeDefined();
    expect(p.type).toBe("object");
    expect(p.properties).toBeDefined();
    expect(p.properties.query).toBeDefined();
    expect(p.properties.query.type).toBe("string");
    expect(Array.isArray(p.required) && p.required).toContain("query");
    // The property must NOT be a top-level key on the schema root.
    expect(p.query).toBeUndefined();
  });
});
