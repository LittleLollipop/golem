import { describe, it, expect } from "vitest";
import { LlmGrader } from "../src/agent/llm-grader.js";

class FakeLlm {
  constructor(private r: string) {}
  async complete() {
    return this.r;
  }
}
class Boom {
  async complete() {
    throw new Error("boom");
  }
}

describe("LlmGrader (#25)", () => {
  it("parses grade JSON from the model", async () => {
    const g = new LlmGrader(
      new FakeLlm('{"grade":"strong","confidence":0.9,"reason":"事实查询"}') as any,
    );
    const r = await g.grade("北京的面积是多少");
    expect(r.grade).toBe("strong");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("falls back to zero (max leakage) on model error", async () => {
    const g = new LlmGrader(new Boom() as any);
    const r = await g.grade("x");
    expect(r.grade).toBe("zero");
  });
});
