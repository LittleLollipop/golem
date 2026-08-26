/**
 * BackgroundTaskLog — 后台调度运行日志 (req_background_task_log).
 *
 * 记录"后台调度何时学了 / 拉了 / 漂了什么"，以 JSONL 时间线持久化，供检视 CLI
 * 与人工审计读取。设计要点：
 *   - 纯追加、时钟可注入（at 参数，便于测试），无 LLM、无网络、可复现。
 *   - 作为可选可观察性接缝注入各组件：传 undefined 即 no-op，保证既有测试密闭。
 *   - 路径由构造参数或 FAKEREN_SCHEDULER_LOG 决定（默认 .fakeren-scheduler.log）。
 *
 * 三个事件语义：
 *   learn   — L0.5 每日知识轨迹学到某条事实（学了什么）
 *   refresh — ambient daemon 后台拉取了若干真实感官样本（拉了什么）
 *   drift   — DriftChannel 在某实例上漂出了若干种子、按源分段（漂了什么）
 *
 * 全局 daemon（ambient refresh）不与某个假人实例绑定，统一记到 SCHEDULER_GLOBAL_INSTANCE。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type SchedulerEventKind = "learn" | "refresh" | "drift";

/** 全局后台 daemon（ambient refresh）的实例占位，不与具体假人绑定。 */
export const SCHEDULER_GLOBAL_INSTANCE = "global";

export interface SchedulerEvent {
  ts: string; // ISO 时间戳
  kind: SchedulerEventKind;
  instanceId: string;
  detail: Record<string, unknown>;
}

export interface LearnDetail {
  id: string;
  title: string;
  chosenRank: number;
  selectionPath: string;
}

export interface RefreshDetail {
  drewCount: number;
}

export interface DriftDetail {
  total: number;
  bySource: Record<string, number>;
}

export class BackgroundTaskLog {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? process.env.FAKEREN_SCHEDULER_LOG ?? ".fakeren-scheduler.log";
  }

  private ensureDir(): void {
    const d = dirname(this.path);
    if (d && d !== "." && !existsSync(d)) {
      mkdirSync(d, { recursive: true });
    }
  }

  private append(e: SchedulerEvent): void {
    this.ensureDir();
    appendFileSync(this.path, JSON.stringify(e) + "\n", "utf8");
  }

  learn(instanceId: string, fact: LearnDetail, at: Date = new Date()): void {
    this.append({
      ts: at.toISOString(),
      kind: "learn",
      instanceId,
      detail: {
        id: fact.id,
        title: fact.title,
        chosenRank: fact.chosenRank,
        selectionPath: fact.selectionPath,
      },
    });
  }

  refresh(instanceId: string, drewCount: number, at: Date = new Date()): void {
    this.append({
      ts: at.toISOString(),
      kind: "refresh",
      instanceId,
      detail: { drewCount },
    });
  }

  drift(instanceId: string, total: number, bySource: Record<string, number>, at: Date = new Date()): void {
    this.append({
      ts: at.toISOString(),
      kind: "drift",
      instanceId,
      detail: { total, bySource },
    });
  }

  /** 读取最近 limit 条事件（旧→新）。无文件返回 []。 */
  read(limit = 100): SchedulerEvent[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const all = lines.map((l) => JSON.parse(l) as SchedulerEvent);
    return all.slice(-limit);
  }
}
