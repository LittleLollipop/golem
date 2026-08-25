/**
 * LeakPostFilter — 执行时后筛 (req_leak_postfilter_dynamic).
 *
 * Complements the PRE-classification (req_leak_by_task_class): that one decides
 * leak LEVEL before assembly; this one re-checks at execution time against the
 * actual request signal and decides the FINAL fate of the leakage:
 *
 *   - execute / code-modification signal  → STRIP: purge drift + situational
 *     leakage, keep only factual recall (purity bias).
 *   - neutral query that still carries leakage → ASK: do NOT silently decide;
 *     hand the user a dual-candidate choice (keep-pure vs keep-leak).
 *   - otherwise → KEEP.
 *
 * The classifier may miss an execute intent (e.g. "改一下这段代码"), so the
 * post-filter adds a lightweight execution-time heuristic as a safety net. The
 * decision is a pure function — fully deterministic and testable.
 */

import type { ChannelContribution, TaskClass, LeakLevel } from "../types.js";

export type PostFilterAction = "keep" | "strip" | "ask";

export interface PostFilterSignal {
  taskClass: TaskClass;
  leakLevel: LeakLevel;
  userText: string;
}

/** Execution-time hints that bias toward purity (complementary to pre-classification).
 *  Deliberately code/command-specific — NOT broad creative words like "写个/写一". */
const CODE_MOD_HINTS = [
  "改代码", "写代码", "修改代码", "改一下", "改这段", "这段代码", "重构", "创建文件", "删除文件",
  "commit", "部署", "执行命令", "运行命令", "跑一下", "deploy", "refactor",
  "sudo", "rm -", "rmdir", "kill ", "systemctl",
];

export function looksExecLike(text: string): boolean {
  const t = text.toLowerCase();
  return CODE_MOD_HINTS.some((h) => t.includes(h));
}

export interface PostFilterDecision {
  action: PostFilterAction;
  contributions: ChannelContribution[];
  reason: string;
  /** present when action === "ask": a dual-candidate prompt to hand the user. */
  userPrompt?: string;
}

export class LeakPostFilter {
  decide(contributions: ChannelContribution[], signal: PostFilterSignal): PostFilterDecision {
    const execLike = signal.taskClass === "execute" || looksExecLike(signal.userText);
    if (execLike) {
      // purity bias: drop drift/situational leakage, keep only factual recall
      const kept = contributions.filter((c) => c.channel === "recall");
      return {
        action: "strip",
        contributions: kept,
        reason: "执行时信号=执行命令/代码修改 → 偏纯净：移除潜意识渗漏，仅保留事实检索",
      };
    }

    // ambiguity: a neutral query that still carries leakage → hand the user the choice
    if (signal.taskClass === "neutral" && signal.leakLevel !== "none") {
      return {
        action: "ask",
        contributions,
        reason: "意图歧义（一般询问但带漏出），执行时后筛不替用户决定，交双候选",
        userPrompt:
          "本次回复是否保留「潜意识渗漏」（人感/跨域联想）？回复「保留」则照常带入，回复「纯净」则仅保留事实检索。",
      };
    }

    return { action: "keep", contributions, reason: "非执行意图且非歧义 → 保留漏出" };
  }
}
