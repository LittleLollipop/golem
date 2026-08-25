/**
 * LlmGrader — 模型化任务分级器 (#25). Implements the same GradeEstimator seam
 * as the heuristic Grader, but asks the agent's own model to classify the turn.
 * Fail-safe: any error falls back to "zero" (max leakage) so we never silently
 * hide the human feel.
 */

import type { GradeResult, Grade } from "../types.js";
import type { GradeEstimator } from "./grader.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";

const SYSTEM = `你是任务分级器。判断用户这句话需要哪种回应模式，只输出 JSON：
{"grade":"zero|weak|strong","confidence":0到1的数字,"reason":"一句话理由"}

分级标准：
- "zero"：闲聊 / 自我表达 / 创作 / 构思 —— 可大量漏出潜意识（人感最强）
- "weak"：一般询问、轻度目标导向 —— 少量漏出
- "strong"：事实查询 / 执行命令 / 需要精准答案 —— 不要漏出，保持纯净

confidence 表示「你有多确定这是 strong（事实/执行）」：越确定越接近 1。`;

interface Parsed {
  grade?: string;
  confidence?: number;
  reason?: string;
}

export class LlmGrader implements GradeEstimator {
  constructor(private readonly llm: LlmClient) {}

  async grade(userText: string): Promise<GradeResult> {
    try {
      const raw = await this.llm.complete(SYSTEM, userText);
      const json = JSON.parse(stripFence(raw)) as Parsed;
      const grade: Grade = json.grade === "strong" || json.grade === "weak" ? json.grade : "zero";
      const confidence = typeof json.confidence === "number" ? json.confidence : 0.3;
      return { grade, confidence, reason: `llm: ${json.reason ?? ""}` };
    } catch {
      return { grade: "zero", confidence: 0.2, reason: "llm grader fallback → zero" };
    }
  }
}
