import { describe, it, expect } from "vitest";
import { LlmExtractor } from "../src/memory/llm-extractor.js";

const canned = JSON.stringify({
  nodes: [
    { type: "Entity", label: "橘猫豆豆", props: { kind: "pet" } },
    { type: "Event", label: "雨天听歌" },
  ],
  edges: [{ from: "橘猫豆豆", to: "雨天听歌", kind: "relates" }],
});

class FakeLlm {
  async complete() {
    return canned;
  }
}
class Boom {
  async complete() {
    throw new Error("boom");
  }
}

describe("LlmExtractor (#22)", () => {
  it("parses model JSON into typed nodes/edges and maps labels to ids", async () => {
    const ex = new LlmExtractor(new FakeLlm() as any);
    const { nodes, edges } = await ex.extract({
      instanceId: "i",
      userText: "x",
      assistantText: "y",
      timestamp: 1,
    });
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("Entity");
    expect(nodes[0].label).toBe("橘猫豆豆");
    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBe(nodes[0].id);
    expect(edges[0].to).toBe(nodes[1].id);
  });

  it("static parse tolerates code fences and bad input", () => {
    expect(LlmExtractor.parse("```json\n" + canned + "\n```").nodes).toHaveLength(2);
    expect(LlmExtractor.parse("not json").nodes).toHaveLength(0);
  });

  it("falls back to empty on model error", async () => {
    const ex = new LlmExtractor(new Boom() as any);
    const r = await ex.extract({ instanceId: "i", userText: "x", assistantText: "y", timestamp: 1 });
    expect(r.nodes).toHaveLength(0);
    expect(r.edges).toHaveLength(0);
  });
});
