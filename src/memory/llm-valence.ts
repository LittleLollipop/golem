/**
 * LlmValence — AI 自身情绪自评 (#23). Replaces HeuristicValence (lexicon sniff)
 * with the agent's own model judging its emotional stance toward content,
 * returning a float in [-1, 1]. Falls back to 0 on any error.
 */

import type { ValenceEstimator } from "./writer.js";
import type { LlmClient } from "../llm/client.js";

const SYSTEM = `你是情绪评估器。给定一段文本，评估「假人（AI 自身）」对其中内容产生的情绪倾向，范围 [-1, 1]：
-1 = 极负面（讨厌 / 恐惧 / 愤怒 / 焦虑）
 0 = 中性
 1 = 极正面（喜爱 / 期待 / 满足）
只输出一个数字（可带负号与小数），不要任何解释。`;

export class LlmValence implements ValenceEstimator {
  constructor(private readonly llm: LlmClient) {}

  async estimate(text: string): Promise<number> {
    try {
      const raw = await this.llm.complete(SYSTEM, text);
      const m = raw.match(/-?\d+(\.\d+)?/);
      if (!m) return 0;
      return Math.max(-1, Math.min(1, parseFloat(m[0])));
    } catch {
      return 0;
    }
  }
}
