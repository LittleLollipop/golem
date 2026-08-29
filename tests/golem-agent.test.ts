import { describe, it, expect } from "vitest";
import { GolemAgent } from "../src/agent/golem-agent.js";
import type { GraphNode, InstanceId } from "../src/types.js";

/** Cast a partial stub to the strict dep type without dragging in real impls. */
function stub<T>(impl: T): any {
  return impl as any;
}

describe("GolemAgent.assemble — memory-first operating directive", () => {
  function buildAgent() {
    const classifier = stub({
      assess: async () => ({ taskClass: "creative", leakLevel: "strong", confidence: 1, reason: "" }),
    });
    const drift = stub({ gather: async () => [] });
    const recall = stub({
      pointers: async () => [
        { channel: "recall-pointer" as const, content: "卷一·不嫁", seedId: "p1", valence: 0 },
      ],
    });
    const situational = stub({ gather: async () => [] });
    const writer = stub({});
    const consolidator = stub({ run: async () => {} });
    const bus = stub({ register: () => {} });
    const persistence = stub({ loadSessionEvents: async () => [] });
    const postFilter = stub({
      decide: (_raw: unknown, _o: unknown) => ({ action: "keep", reason: "", contributions: [] }),
    });
    return new GolemAgent(
      classifier,
      drift,
      recall,
      situational,
      writer,
      consolidator,
      bus,
      persistence,
      postFilter,
    );
  }

  it("always injects the memory-first operating-directive block (every step-1)", async () => {
    const agent = buildAgent();
    const res = await agent.assemble([], "帮我给 卷一·不嫁 写个大纲", "instA", "你是林夏");
    const directive = res.messages.find((m: any) => m.meta?.channel === "operating-directive");
    expect(directive).toBeTruthy();
    expect(directive.content).toContain("memory_recall");
    expect(directive.content).toContain("先调用");
    // recall-pointer index still present and carries the named entity
    const ptr = res.messages.find((m: any) => m.meta?.channel === "recall-pointer");
    expect(ptr).toBeTruthy();
    expect(ptr.content).toContain("卷一·不嫁");
  });

  it("still surfaces the directive even when there are no recall pointers", async () => {
    const agent = buildAgent();
    const recall = stub({ pointers: async () => [] });
    const a = new GolemAgent(
      stub({ assess: async () => ({ taskClass: "neutral", leakLevel: "weak", confidence: 1, reason: "" }) }),
      stub({ gather: async () => [] }),
      recall,
      stub({ gather: async () => [] }),
      stub({}),
      stub({ run: async () => {} }),
      stub({ register: () => {} }),
      stub({ loadSessionEvents: async () => [] }),
      stub({ decide: (_r: unknown, _o: unknown) => ({ action: "keep", reason: "", contributions: [] }) }),
    );
    const res = await a.assemble([], "今天天气怎么样", "instA", "你是林夏");
    const directive = res.messages.find((m: any) => m.meta?.channel === "operating-directive");
    expect(directive).toBeTruthy();
  });
});
