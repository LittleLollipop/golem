import { describe, it, expect } from "vitest";
import { LeakPostFilter, looksExecLike } from "../src/leak/post-filter.js";
import type { ChannelContribution } from "../src/types.js";

function mk(channel: string, content: string): ChannelContribution {
  return { channel: channel as ChannelContribution["channel"], content, seedId: `s-${channel}-${content}` };
}

const drift = mk("drift", "[跨域联想] a ↔ b");
const situ = mk("situational", "[情境] 此刻下雨");
const recall = mk("recall", "[图检索] 猫是橘色");

describe("LeakPostFilter (req_leak_postfilter_dynamic)", () => {
  const pf = new LeakPostFilter();

  it("strips leakage on execute command, keeping only recall (purity bias)", () => {
    const d = pf.decide([drift, situ, recall], {
      taskClass: "execute",
      leakLevel: "none",
      userText: "运行这个脚本",
    });
    expect(d.action).toBe("strip");
    expect(d.contributions.map((c) => c.channel)).toEqual(["recall"]);
    expect(d.reason).toContain("纯净");
  });

  it("strips leakage when execution-time code-mod hints appear (safety net beyond pre-classifier)", () => {
    const d = pf.decide([drift, recall], {
      taskClass: "neutral",
      leakLevel: "weak",
      userText: "帮我重构这段实现",
    });
    expect(d.action).toBe("strip");
    expect(d.contributions).toHaveLength(1);
    expect(d.contributions[0].channel).toBe("recall");
  });

  it("asks (dual-candidate) on ambiguous neutral query that still carries leakage", () => {
    const d = pf.decide([drift, recall], {
      taskClass: "neutral",
      leakLevel: "weak",
      userText: "你觉得呢？",
    });
    expect(d.action).toBe("ask");
    expect(d.userPrompt).toBeTruthy();
    expect(d.userPrompt).toContain("保留");
    expect(d.contributions).toHaveLength(2); // unchanged — let the user decide
  });

  it("keeps leakage for creative/strong queries", () => {
    const d = pf.decide([drift, situ, recall], {
      taskClass: "creative",
      leakLevel: "strong",
      userText: "帮我写个故事",
    });
    expect(d.action).toBe("keep");
    expect(d.contributions).toHaveLength(3);
  });

  it("looksExecLike detects code-modification intent", () => {
    expect(looksExecLike("改一下这段代码")).toBe(true);
    expect(looksExecLike("帮我写个故事")).toBe(false);
  });
});
