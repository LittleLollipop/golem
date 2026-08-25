import { describe, it, expect } from "vitest";
import { LlmValence } from "../src/memory/llm-valence.js";

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

describe("LlmValence (#23)", () => {
  it("parses a float in [-1,1]", async () => {
    const v = new LlmValence(new FakeLlm("0.7") as any);
    expect(await v.estimate("我喜欢这个")).toBeCloseTo(0.7);
  });

  it("clamps out-of-range values", async () => {
    const v = new LlmValence(new FakeLlm("5") as any);
    expect(await v.estimate("x")).toBe(1);
    const v2 = new LlmValence(new FakeLlm("-9") as any);
    expect(await v2.estimate("x")).toBe(-1);
  });

  it("returns 0 on model error", async () => {
    const v = new LlmValence(new Boom() as any);
    expect(await v.estimate("x")).toBe(0);
  });
});
