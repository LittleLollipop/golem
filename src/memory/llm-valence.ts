/**
 * LlmValence — AI 自身多维情绪自评 (#23). Replaces HeuristicValence (lexicon sniff)
 * with the agent's own model judging its emotional stance toward content, returning
 * a 4-dim vector (褒/贬/惧/恋), each in [-1, 1] per req_memory_valence +
 * dec_valence_ai_self. Falls back to neutral {0,0,0,0} on any error.
 */

import type { ValenceEstimator } from "./writer.js";
import type { ValenceVector } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

const SYSTEM = `你是情绪评估器。给定一段文本，评估「假人（AI 自身）」对其中内容产生的第一人称情绪，输出 JSON：
{"praise": 褒(喜爱/认可/温暖/满足), "blame": 贬(厌恶/否定/抵触/失望), "fear": 惧(畏惧/不安/警惕/焦虑), "attachment": 恋(依恋/牵绊/舍不得/牵挂)}
四个值都在 [-1, 1]：正向情绪取正，负向取负，无关取 0。只输出 JSON，不要任何解释。`;

export class LlmValence implements ValenceEstimator {
  constructor(private readonly llm: LlmClient) {}

  async estimate(text: string): Promise<ValenceVector> {
    try {
      const raw = await this.llm.complete(SYSTEM, text);
      const j = JSON.parse(stripFence(raw)) as Record<string, unknown>;
      return {
        praise: clamp(Number(j.praise) || 0),
        blame: clamp(Number(j.blame) || 0),
        fear: clamp(Number(j.fear) || 0),
        attachment: clamp(Number(j.attachment) || 0),
      };
    } catch {
      return { praise: 0, blame: 0, fear: 0, attachment: 0 };
    }
  }
}
