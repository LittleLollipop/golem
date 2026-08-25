import { describe, it, expect } from "vitest";
import { attribute, overlapScore, counterfactualDiff } from "../src/attribution/attributor.js";

describe("Output-level attribution (req_output_attribution)", () => {
  it("overlapScore is high when the output reuses a seed's phrasing, ~0 when unrelated", () => {
    const seed = "[跨域联想] 喜欢在雨天独处听歌 ↔ 对陌生环境有警惕心";
    // full reuse of the seed's phrasing → high
    expect(overlapScore(seed, "她今天喜欢在雨天独处听歌，而且对陌生环境有警惕心")).toBeGreaterThan(0.8);
    // partial reuse of a long seed → still positive, but below full coverage
    expect(overlapScore(seed, "她今天喜欢在雨天独处听歌")).toBeGreaterThan(0);
    // unrelated output → 0
    expect(overlapScore(seed, "今天天气真不错")).toBe(0);
  });

  it("attribute() ranks seeds by verifiable text overlap (no model self-report)", () => {
    const seeds = [
      { seedId: "drift_1", channel: "drift", content: "[跨域联想] 喜欢在雨天独处听歌 ↔ 对陌生环境有警惕心" },
      { seedId: "recall_1", channel: "recall", content: "[图检索] 豆豆是一只橘猫" },
    ];
    const report = attribute("她平时喜欢在雨天独处听歌，面对陌生环境会警惕", seeds);
    expect(report.method).toBe("text-overlap");
    expect(report.attributed.map((a) => a.seedId)).toEqual(["drift_1"]); // only the overlapping seed
    expect(report.attributed[0].score).toBeGreaterThan(0.5);
    // recall seed shares no bigrams with the output → must NOT be attributed
    expect(report.attributed.find((a) => a.seedId === "recall_1")).toBeUndefined();
  });

  it("attribute() sorts multiple attributed seeds by influence", () => {
    const seeds = [
      { seedId: "a", channel: "drift", content: "喜欢在雨天独处听歌" },
      { seedId: "b", channel: "drift", content: "养了一只橘猫叫豆豆" },
    ];
    const report = attribute("喜欢在雨天独处听歌，而且还养了一只橘猫叫豆豆", seeds);
    expect(report.attributed).toHaveLength(2);
    expect(report.attributed[0].score).toBeGreaterThanOrEqual(report.attributed[1].score);
  });

  it("counterfactualDiff isolates the contamination delta (with-leak vs baseline)", () => {
    const withLeak = "喜欢在雨天独处听歌，养了橘猫豆豆";
    const without = "养了橘猫豆豆";
    const d = counterfactualDiff(withLeak, without);
    // the leak added the rainy-day phrasing; baseline-only content is not "removed"
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.added.join("")).toContain("雨天");
    expect(d.removed).toHaveLength(0);
    expect(d.addedCoverage).toBeGreaterThan(0);
  });

  it("is a pure, synchronous, model-free function (attribution is verifiable, never self-reported)", () => {
    // structural guarantee: no async, no LLM — just string math
    expect(attribute("x", [{ seedId: "s", channel: "drift", content: "x" }]).method).toBe("text-overlap");
  });
});
