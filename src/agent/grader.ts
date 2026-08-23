/**
 * Grader — 任务分级器.
 *
 * Routes which channels may leak. Lower confidence → more leakage (fail-safe per
 * architecture tension #2: mis-classifying a zero as strong hides the "human
 * feel"; mis-classifying a strong as zero only adds a little noise). v1 uses a
 * heuristic; swap for a model-based estimator later behind this interface.
 */

import type { GradeResult, Grade } from "../types.js";

export class Grader {
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
    if (/\b(how|what|why|when|where|who|怎么|什么|为什么|如何|查|计算|总结)\b/i.test(t)) c += 0.3;
    return Math.min(1, c);
  }
}
