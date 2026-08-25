import { describe, it, expect } from "vitest";
import { FakerenAgent } from "../src/agent/fakeren-agent.js";
import { Grader } from "../src/agent/grader.js";

/** Minimal fakes — vitest transpiles without typechecking, so loose stubs are
 *  fine here (the real contracts are covered by tsc over src/). */
const stub: any = { gather: async () => [], perceive: async () => {}, run: async () => {} };

class FakePersistence {
  constructor(private evs: any[]) {}
  async loadSessionEvents() {
    return this.evs;
  }
}

class FakeWriter {
  written: any[] = [];
  async writeTurn(i: any) {
    this.written.push(i);
  }
}

function makeAgent(evs: any[]) {
  return new FakerenAgent(
    new Grader(),
    stub,
    stub,
    stub,
    new FakeWriter() as any,
    stub,
    stub,
    new FakePersistence(evs) as any,
  );
}

describe("syncLatestTurn — TODO#28 structural injected marker", () => {
  it("writes only the genuine user input, skipping injected persona/leak", async () => {
    const agent = makeAgent([
      { type: "user", timestamp: 1, payload: { text: "真实用户输入：我养了只狗" }, injected: false },
      { type: "user", timestamp: 2, payload: { text: "（你心里很清楚：）喜欢在雨天听歌" }, injected: true },
      { type: "assistant", timestamp: 3, payload: { text: "助手回复内容" } },
    ]);
    const writer = (agent as any).writer as FakeWriter;
    await agent.syncLatestTurn("i1", "s1");
    expect(writer.written).toHaveLength(1);
    expect(writer.written[0].userText).toBe("真实用户输入：我养了只狗");
  });

  it("does NOT rely on text-prefix; a non-injected message starting with the leak prefix is still written", async () => {
    const agent = makeAgent([
      { type: "user", timestamp: 1, payload: { text: "（你心里很清楚：）其实我昨天赢了棋" }, injected: false },
      { type: "assistant", timestamp: 2, payload: { text: "牛" } },
    ]);
    const writer = (agent as any).writer as FakeWriter;
    await agent.syncLatestTurn("i1", "s1");
    expect(writer.written).toHaveLength(1);
    expect(writer.written[0].userText).toBe("（你心里很清楚：）其实我昨天赢了棋");
  });

  it("writes nothing when only injected messages are present", async () => {
    const agent = makeAgent([
      { type: "user", timestamp: 1, payload: { text: "leak only" }, injected: true },
      { type: "assistant", timestamp: 2, payload: { text: "ok" } },
    ]);
    const writer = (agent as any).writer as FakeWriter;
    await agent.syncLatestTurn("i1", "s1");
    expect(writer.written).toHaveLength(0);
  });
});
