import { describe, it, expect } from "vitest";
import { LlmValence } from "../src/memory/llm-valence.js";
import { valenceScalar } from "../src/types.js";

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

describe("LlmValence (#23 多维情绪)", () => {
  it("parses a 4-dim vector from the model", async () => {
    const v = new LlmValence(
      new FakeLlm('{"praise":0.8,"blame":-0.1,"fear":0.0,"attachment":0.6}') as any,
    );
    const r = await v.estimate("我喜欢她，舍不得离开");
    expect(r.praise).toBeCloseTo(0.8);
    expect(r.blame).toBeCloseTo(-0.1);
    expect(r.fear).toBeCloseTo(0.0);
    expect(r.attachment).toBeCloseTo(0.6);
  });

  it("clamps out-of-range values per dimension", async () => {
    const v = new LlmValence(new FakeLlm('{"praise":5,"blame":-9,"fear":2,"attachment":-3}') as any);
    const r = await v.estimate("x");
    expect(r.praise).toBe(1);
    expect(r.blame).toBe(-1);
    expect(r.fear).toBe(1);
    expect(r.attachment).toBe(-1);
  });

  it("returns neutral vector on model error", async () => {
    const v = new LlmValence(new Boom() as any);
    const r = await v.estimate("x");
    expect(r).toEqual({ praise: 0, blame: 0, fear: 0, attachment: 0 });
  });

  it("valenceScalar derives a single signed scalar from the vector", () => {
    expect(valenceScalar({ praise: 0.8, blame: 0, fear: 0, attachment: 0.6 })).toBeCloseTo(0.7);
    expect(valenceScalar({ praise: 0, blame: 0.6, fear: 0.4, attachment: 0 })).toBeCloseTo(-0.5);
    expect(valenceScalar({ praise: 9, blame: 0, fear: 0, attachment: 0 })).toBe(1);
  });
});
