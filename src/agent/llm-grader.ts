/**
 * LlmGrader — 模型化任务分级器 (#25). Implements the same TaskClassifier seam as
 * the heuristic Grader, but asks the agent's own model to classify the turn by
 * task type (execute/creative/neutral). Fail-safe: any error falls back to
 * "neutral" (weak leak) so we never accidentally go to zero-leak on a creative
 * turn (which would hide the human feel) — and never to execute (which would
 * wrongly suppress leakage on a real chat).
 */

import type { TaskAssessment, TaskClass, LeakLevel } from "../types.js";
import type { TaskClassifier } from "./grader.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";

const SYSTEM = `你是任务分级器。判断用户这句话的任务性质，只输出 JSON：
{"taskClass":"execute|creative|neutral","leakLevel":"none|weak|strong","confidence":0到1的数字,"reason":"一句话理由"}

分级标准（由任务性质判定，不靠用户手动开关）：
- "execute"：执行命令 / 改代码 / 跑脚本 / 部署 / 系统操作 —— 需要严谨 → leakLevel "none"（零漏，不注入潜意识）
- "creative"：对话闲聊 / 文本创作 / 构思架构方案 / 脑洞 —— 需要灵气 → leakLevel "strong"（强漏）
- "neutral"：一般询问、轻度目标导向 —— leakLevel "weak"（轻漏）

confidence 表示你有多确定这个分类。`;

interface Parsed {
  taskClass?: string;
  leakLevel?: string;
  confidence?: number;
  reason?: string;
}

export class LlmGrader implements TaskClassifier {
  constructor(private readonly llm: LlmClient) {}

  async assess(userText: string): Promise<TaskAssessment> {
    try {
      const raw = await this.llm.complete(SYSTEM, userText);
      const json = JSON.parse(stripFence(raw)) as Parsed;
      const task: TaskClass =
        json.taskClass === "execute" || json.taskClass === "creative"
          ? json.taskClass
          : "neutral";
      const leak: LeakLevel =
        json.leakLevel === "none" || json.leakLevel === "strong"
          ? json.leakLevel
          : "weak";
      const confidence = typeof json.confidence === "number" ? json.confidence : 0.5;
      return { taskClass: task, leakLevel: leak, confidence, reason: `llm: ${json.reason ?? ""}` };
    } catch {
      return { taskClass: "neutral", leakLevel: "weak", confidence: 0.3, reason: "llm grader fallback → neutral/weak" };
    }
  }
}
