import { describe, it, expect } from "vitest";
import { DriftChannel } from "../src/channels/drift-channel.js";
import type { MemoryReader } from "../src/memory/reader.js";
import type { DshAdapter } from "../src/adapter/dsh-seams.js";
import type { InstanceRegistry } from "../src/registry/instance-registry.js";

// Isolate the 往昔 path: no cross-domain edges, no ambient, no L0.5.
const stubReader = { crossDomain: async () => [] } as unknown as MemoryReader;

describe("DriftChannel 往昔回放带出助手回复", () => {
  it("surfaces a deterministic summary of the past assistant reply under the 往昔 line", async () => {
    const persist = {
      loadSessionEvents: async (_id: string) =>
        [
          { type: "user", timestamp: 100, payload: { text: "你可以帮我看看今天的新闻有什么值得关注的吗" } },
          {
            type: "assistant",
            timestamp: 200,
            payload: {
              text: "好的，今天有几条：甲醛白菜保鲜问题引发关注；投洽会设双主宾省；文旅项目巡林。",
            },
          },
        ] as any,
    } as unknown as DshAdapter;
    const reg = { sessionsOf: async () => ["sess-news"] } as unknown as InstanceRegistry;
    const ch = new DriftChannel(stubReader, persist, reg);
    const out = await ch.gather("instA");
    const hist = out.filter((c) => c.content.startsWith("[往昔]"));
    expect(hist).toHaveLength(1);
    expect(hist[0].content).toContain("你可以帮我看看今天的新闻");
    // 回复摘要应随往昔行带出，且与 recall 通道同一视觉标记
    expect(hist[0].content).toContain("↳");
    expect(hist[0].content).toContain("甲醛");
    expect(hist[0].provenance?.selectionPath).toContain("reply surfaced");
    expect(hist[0].channel).toBe("drift");
  });

  it("still surfaces only the question when no assistant reply exists", async () => {
    const persist = {
      loadSessionEvents: async (_id: string) =>
        [{ type: "user", timestamp: 100, payload: { text: "随便聊聊" } }] as any,
    } as unknown as DshAdapter;
    const reg = { sessionsOf: async () => ["sess-x"] } as unknown as InstanceRegistry;
    const ch = new DriftChannel(stubReader, persist, reg);
    const out = await ch.gather("instA");
    const hist = out.filter((c) => c.content.startsWith("[往昔]"));
    expect(hist).toHaveLength(1);
    expect(hist[0].content).not.toContain("↳");
  });

  it("strips model thinking from the surfaced reply", async () => {
    const persist = {
      loadSessionEvents: async (_id: string) =>
        [
          { type: "user", timestamp: 100, payload: { text: "今天有什么新闻" } },
          {
            type: "assistant",
            timestamp: 200,
            payload: {
              text: "The user is continuing the roleplay. I'm 林夏. <thinking>plan the answer</thinking>今天有三部门处置白菜甲醛事件。",
            },
          },
        ] as any,
    } as unknown as DshAdapter;
    const reg = { sessionsOf: async () => ["sess-think"] } as unknown as InstanceRegistry;
    const ch = new DriftChannel(stubReader, persist, reg);
    const out = await ch.gather("instA");
    const hist = out.filter((c) => c.content.startsWith("[往昔]"));
    expect(hist[0].content).toContain("↳");
    expect(hist[0].content).toContain("白菜");
    expect(hist[0].content).not.toContain("roleplay");
    expect(hist[0].content).not.toContain("plan the answer");
  });
});
