import { describe, it, expect } from "vitest";
import { summarizeReply } from "../src/memory/summarize.js";
import { RecallChannel } from "../src/channels/recall-channel.js";
import type { GraphNode } from "../src/types.js";

const REPLY =
  "今天国内有几条要闻。三部门指导地方快速处置白菜蘸甲醛溶液问题，引发关注。" +
  "文旅项目推进巡林计划，意在拉动周边消费。投洽会首次设双主宾省，签约额创新高。";

describe("summarizeReply (deterministic extractive)", () => {
  it("keeps the lead sentence and stays within the char budget", () => {
    const sum = summarizeReply(REPLY, "你可以帮我看看今天的新闻有什么值得关注的吗");
    expect(sum.length).toBeLessThanOrEqual(120);
    expect(sum).toContain("今天国内有几条要闻"); // lead preserved
    // ends on a sentence boundary or an ellipsis, never mid-word
    expect(sum.endsWith("。") || sum.endsWith("…")).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(summarizeReply("", "x")).toBe("");
    expect(summarizeReply("   ", "x")).toBe("");
  });

  it("hard-caps a single over-long sentence with an ellipsis", () => {
    const long = "甲醛" + "白菜".repeat(200) + "。";
    const sum = summarizeReply(long, "x");
    expect(sum.endsWith("…")).toBe(true);
    expect(sum.length).toBeLessThanOrEqual(121);
  });
});

describe("RecallChannel surfaces the reply summary (assistantSummary)", () => {
  function node(props: Record<string, unknown>): GraphNode {
    return {
      id: "evt_1",
      type: "Event",
      label: "你可以帮我看看今天的新闻有什么值得关注的吗",
      instanceId: "instA",
      props,
      valence: 0,
      valenceSelf: true,
      weight: 1,
      decayed: false,
    } as GraphNode;
  }

  it("recall content includes the summary, not the raw long tail", async () => {
    const summary = summarizeReply(REPLY, "你可以帮我看看今天的新闻有什么值得关注的吗");
    const src = {
      recall: async () => [node({ userText: "你可以帮我看看今天的新闻有什么值得关注的吗", assistantText: REPLY, assistantSummary: summary })],
    };
    const ch = new RecallChannel(src as any);
    const contribs = await ch.gather("今天的新闻里白菜那事后来怎样了", "instA");
    expect(contribs.length).toBe(1);
    const c = contribs[0].content;
    expect(c).toContain(summary);
    expect(c).toContain("[图检索]");
    // raw tail (only in the 4th sentence) must not leak into the recall surface
    expect(c).not.toContain("投洽会首次设双主宾省");
  });

  it("falls back to assistantText when no summary exists (backward compat)", async () => {
    const src = { recall: async () => [node({ assistantText: "她记得那天的雨。" })] };
    const ch = new RecallChannel(src as any);
    const contribs = await ch.gather("那天的雨", "instA");
    expect(contribs[0].content).toContain("她记得那天的雨");
  });
});
