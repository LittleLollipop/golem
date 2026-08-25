/**
 * Grader — 任务分级器.
 *
 * Routes which channels may leak. Lower confidence → more leakage (fail-safe per
 * architecture tension #2: mis-classifying a zero as strong hides the "human
 * feel"; mis-classifying a strong as zero only adds a little noise). v1 uses a
 * heuristic; swap for a model-based estimator later behind this interface.
 */

import type { GradeResult, Grade } from "../types.js";

/**
 * Grading seam. v1 is the synchronous heuristic below; a model-based estimator
 * (#25) implements the same interface and may return a Promise (the agent's
 * assemble() awaits it either way). Fail-safe stays: lower confidence → more
 * leakage, so mis-classifying a factual ask as "zero" only adds a little noise.
 */
export interface GradeEstimator {
  grade(userText: string): GradeResult | Promise<GradeResult>;
}

export class Grader implements GradeEstimator {
  grade(userText: string): GradeResult {
    const confidence = this.estimate(userText);
    const grade: Grade = confidence > 0.7 ? "strong" : confidence > 0.4 ? "weak" : "zero";
    return {
      grade,
      confidence,
      reason: `heuristic confidence=${confidence.toFixed(2)} → ${grade}`,
    };
  }

  private estimate(t: string): number {
    let c = 0.2;
    if (t.includes("?") || t.includes("？")) c += 0.4;
    // NOTE: \b word boundaries do NOT work for CJK (no whitespace tokenization),
    // so the Chinese cues below must be matched WITHOUT \b — otherwise "什么/怎么"
    // never fire and the grader is effectively blind to Chinese questions.
    if (/(how|what|why|when|where|who|怎么|什么|为什么|如何|几|哪|谁|查|计算|总结)/i.test(t)) c += 0.3;
    return Math.min(1, c);
  }
}
