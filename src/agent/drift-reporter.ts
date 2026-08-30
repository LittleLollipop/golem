/**
 * FileDriftReporter — makes the idle introspection observable.
 *
 * For every run it appends a human-readable section to `<reportDir>/<inst>.drift-log.md`
 * (full history) and overwrites `<reportDir>/<inst>.last.json` (machine-readable
 * latest). It also prints a loud, scannable line to stdout so the run is visible
 * even without opening the file. Without this the introspection is a black box
 * (user 2026-08-30).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DriftExecutionResult, DriftReporter } from "./persona-drift.js";

const SKIP_TEXT: Record<string, (r: DriftExecutionResult) => string> = {
  "already-done": (r) => `今日已完成（节点 ${r.existingNodeId ?? "?"} 已存在）`,
  "no-dialogue": () => "近期无对话 → 跳过（链断档）",
  "no-llm": () => "无 LLM → 跳过",
  "model-empty": () => "模型返回合法 JSON 但无有效维度 → 平凡日跳过",
};

function render(r: DriftExecutionResult): string {
  const out: string[] = [];
  out.push(`## 内省执行 @ ${r.triggeredAt}  (instance=${r.instanceId}, date=${r.date})`);
  out.push(`- 触发: ${r.triggered ? "是" : "否"}`);
  if (r.skipReason) {
    const fn = SKIP_TEXT[r.skipReason];
    out.push(`- 跳过原因: ${fn ? fn(r) : r.skipReason}`);
  }
  if (r.input) {
    out.push(
      `- 输入: 对话 ${r.input.dialogTurns} 轮 / 记忆主题 ${r.input.memoryTopics} / 历史 drift ${r.input.historyDrifts} / 窗口 ${r.input.recentDays} 天`,
    );
  }
  if (r.llmRaw) {
    const trimmed = r.llmRaw.length > 800 ? r.llmRaw.slice(0, 800) + " …(truncated)" : r.llmRaw;
    out.push(`- LLM 原始输出:\n  \`\`\`\n${trimmed}\n  \`\`\``);
  }
  if (r.error) out.push(`- 错误: ${r.error}`);
  if (r.parsed) {
    out.push(`- 解析结果:`);
    out.push(`  - dims: ${JSON.stringify(r.parsed.dims)}`);
    out.push(`  - cumulative: ${JSON.stringify(r.parsed.cumulative)}`);
    if (r.parsed.mood) out.push(`  - mood: ${r.parsed.mood}`);
    if (r.parsed.leaning) out.push(`  - leaning: ${r.parsed.leaning}`);
    if (r.parsed.preoccupation) out.push(`  - preoccupation: ${r.parsed.preoccupation}`);
    if (r.parsed.rationale) out.push(`  - rationale: ${r.parsed.rationale}`);
    if (r.parsed.evidence.length) out.push(`  - evidence: ${r.parsed.evidence.join(", ")}`);
  }
  if (r.written) {
    out.push(
      `- 落盘: 节点 ${r.written.nodeId}（causal 边 ${r.written.causalEdges}，evidence 边 ${r.written.evidenceEdges}）`,
    );
  }
  return out.join("\n");
}

export class FileDriftReporter implements DriftReporter {
  constructor(private readonly dir: string) {}

  report(instanceId: string, r: DriftExecutionResult): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const logPath = path.join(this.dir, `${instanceId}.drift-log.md`);
      const lastPath = path.join(this.dir, `${instanceId}.last.json`);
      const jsonlPath = path.join(this.dir, `${instanceId}.drift-records.jsonl`);
      fs.appendFileSync(logPath, render(r) + "\n\n---\n\n");
      fs.writeFileSync(lastPath, JSON.stringify(r, null, 2));
      // structured append-only timeline — the canonical source for the viewer page
      fs.appendFileSync(jsonlPath, JSON.stringify(r) + "\n");
    } catch (err) {
      console.error(`[golem:drift] failed to write report for ${instanceId}:`, err);
    }

    // loud, scannable stdout line
    if (r.triggered && r.written) {
      console.log(
        `[golem:drift] ✅ INTROSPECT done  ${instanceId}  date=${r.date}  node=${r.written.nodeId}  dims=${JSON.stringify(r.parsed?.dims)}`,
      );
    } else if (r.triggered) {
      console.log(
        `[golem:drift] ⚠️  INTROSPECT ran but no drift written  ${instanceId}  (${r.skipReason ?? r.error ?? "model-empty"})`,
      );
    } else {
      const reason =
        r.skipReason === "already-done"
          ? `already-done (${r.existingNodeId})`
          : r.skipReason ?? "?";
      console.log(`[golem:drift] ⏭️  INTROSPECT skipped  ${instanceId}  reason=${reason}`);
    }
  }
}
