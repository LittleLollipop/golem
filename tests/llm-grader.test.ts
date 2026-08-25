import { describe, it, expect } from "vitest";
import { LlmGrader } from "../src/agent/llm-grader.js";
import { Grader } from "../src/agent/grader.js";

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

describe("LlmGrader (#25 任务类型分级)", () => {
  it("parses taskClass JSON from the model", async () => {
    const g = new LlmGrader(
      new FakeLlm('{"taskClass":"execute","leakLevel":"none","confidence":0.9,"reason":"执行命令"}') as any,
    );
    const r = await g.assess("帮我运行这个脚本部署到服务器");
    expect(r.taskClass).toBe("execute");
    expect(r.leakLevel).toBe("none");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("falls back to neutral/weak on model error (never wrongly zero-leak a chat)", async () => {
    const g = new LlmGrader(new Boom() as any);
    const r = await g.assess("x");
    expect(r.taskClass).toBe("neutral");
    expect(r.leakLevel).toBe("weak");
  });
});

describe("Grader heuristic (#25)", () => {
  const g = new Grader();

  it("execute task → none (zero leak)", () => {
    const r = g.assess("帮我运行这个脚本部署到服务器");
    expect(r.taskClass).toBe("execute");
    expect(r.leakLevel).toBe("none");
  });

  it("creative task → strong (max leak)", () => {
    const r = g.assess("帮我构思一个小说世界观设定");
    expect(r.taskClass).toBe("creative");
    expect(r.leakLevel).toBe("strong");
  });

  it("plain question → neutral/weak", () => {
    const r = g.assess("北京的面积是多少？");
    expect(r.taskClass).toBe("neutral");
    expect(r.leakLevel).toBe("weak");
  });
});
