#!/usr/bin/env node
/**
 * 检视 CLI (req_inspect_cli): 当前状态 / 今日所学 / 近期种子。
 *
 * 直接对接 sidecar（实例元信息）+ 本地账本（L0.5 知识轨迹）+ pre-step 审计日志
 * （#55 种子溯源逐条记录）。无需 dsh 运行。
 *
 * 用法：
 *   node scripts/inspect.mjs state [instanceId?]
 *   node scripts/inspect.mjs learned [instanceId?]
 *   node scripts/inspect.mjs seeds [n=20]
 *   node scripts/inspect.mjs log [n=50]
 *
 * 可调环境变量（与运行时一致）：
 *   FAKEREN_SIDECAR_URL     默认 http://127.0.0.1:8741
 *   FAKEREN_KNOWLEDGE_DIR   默认 ./.fakeren-knowledge
 *   FAKEREN_PRESTEP_LOG     默认 /tmp/fakeren-prestep.log
 *   FAKEREN_SCHEDULER_LOG   默认 ./.fakeren-scheduler.log
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseLeakConfig,
  lastSeedsFromLog,
  listLedgerInstances,
  parseSchedulerLog,
  defaultSchedulerLogPath,
} from "./inspect-core.mjs";

const SIDECAR = process.env.FAKEREN_SIDECAR_URL ?? "http://127.0.0.1:8741";
const KNOWLEDGE_DIR = process.env.FAKEREN_KNOWLEDGE_DIR ?? "./.fakeren-knowledge";
const PRESTEP_LOG = process.env.FAKEREN_PRESTEP_LOG ?? "/tmp/fakeren-prestep.log";
const SCHEDULER_LOG = defaultSchedulerLogPath();

async function getJSON(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readLedger(id) {
  const p = join(KNOWLEDGE_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function fmtDate(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "?" : d.toISOString().slice(0, 10);
}

async function cmdState(instanceId) {
  console.log("== 当前状态 ==");
  const insts = await getJSON(`${SIDECAR}/instances/meta`);
  console.log(`sidecar (${SIDECAR}): ${insts ? `${insts.length} 实例` : "未连接"}`);

  const ids = listLedgerInstances(KNOWLEDGE_DIR, readdirSync);
  console.log(`知识账本 (${KNOWLEDGE_DIR}): ${ids.length} 实例`);
  for (const id of ids) {
    const l = readLedger(id);
    console.log(`  - ${id}: 已学 ${l?.learnedIds?.length ?? 0} 条, 最近 ${l?.lastLearnedDate ?? "?"}`);
  }

  console.log("leak 配置: " + JSON.stringify(parseLeakConfig()));
  const ac = join(process.cwd(), "ambient-control.json");
  if (existsSync(ac)) {
    try {
      const j = JSON.parse(readFileSync(ac, "utf8"));
      console.log(`ambient-control: camera=${j.camera} mic=${j.mic}`);
    } catch {
      console.log("ambient-control: (解析失败)");
    }
  } else {
    console.log("ambient-control: (无文件, 默认 off)");
  }

  if (existsSync(PRESTEP_LOG)) {
    const txt = readFileSync(PRESTEP_LOG, "utf8");
    const seeds = lastSeedsFromLog(txt);
    const last = seeds.length ? seeds[seeds.length - 1].at : "—";
    console.log(
      `prestep 日志 (${PRESTEP_LOG}): ${txt.split("\n").length} 行, 记录种子 ${seeds.length} 条, 最近注入 ${last}`,
    );
  } else {
    console.log(`prestep 日志: (无 ${PRESTEP_LOG})`);
  }

  if (existsSync(SCHEDULER_LOG)) {
    const evs = parseSchedulerLog(readFileSync(SCHEDULER_LOG, "utf8"));
    const last = evs.length ? evs[evs.length - 1].ts : "—";
    const kinds = evs.reduce((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `调度日志 (${SCHEDULER_LOG}): ${evs.length} 事件 [${Object.entries(kinds)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")}], 最近 ${last}`,
    );
  } else {
    console.log(`调度日志: (无 ${SCHEDULER_LOG})`);
  }
}

function cmdLearned(instanceId) {
  console.log("== 今日所学 / 近期知识轨迹 ==");
  const ids = instanceId ? [instanceId] : listLedgerInstances(KNOWLEDGE_DIR, readdirSync);
  if (!ids.length) {
    console.log("(无知识账本)");
    return;
  }
  const today = todayStr();
  for (const id of ids) {
    const l = readLedger(id);
    if (!l) {
      console.log(`- ${id}: (无账本)`);
      continue;
    }
    const traj = (l.trajectory ?? []).slice().reverse();
    console.log(`- ${id} (今日=${l.lastLearnedDate === today ? "★今天" : l.lastLearnedDate})`);
    if (!traj.length) {
      console.log("    暂无所学");
      continue;
    }
    for (const f of traj.slice(0, 10)) {
      const star = fmtDate(f.learnedAt) === today ? " ★今日" : "";
      console.log(`    [${fmtDate(f.learnedAt)}] ${f.title} — ${f.summary}（${f.sourceUrl}）${star}`);
      console.log(`        ${f.selectionPath}`);
    }
  }
}

function cmdSeeds(n) {
  console.log(`== 近期种子 (最近 ${n}) ==`);
  if (!existsSync(PRESTEP_LOG)) {
    console.log(`(无日志 ${PRESTEP_LOG})`);
    return;
  }
  const seeds = lastSeedsFromLog(readFileSync(PRESTEP_LOG, "utf8"), n);
  if (!seeds.length) {
    console.log("(日志中无种子记录)");
    return;
  }
  for (const s of seeds) {
    console.log(`[${s.at}] (${s.channel}) ${s.id}`);
    console.log(`    src=${s.source}`);
    console.log(`    path=${s.selectionPath}`);
  }
}

function cmdLog(n) {
  console.log(`== 后台调度运行日志 (最近 ${n}) (${SCHEDULER_LOG}) ==`);
  if (!existsSync(SCHEDULER_LOG)) {
    console.log(`(无日志 ${SCHEDULER_LOG})`);
    return;
  }
  const events = parseSchedulerLog(readFileSync(SCHEDULER_LOG, "utf8"), n);
  if (!events.length) {
    console.log("(日志中无调度事件)");
    return;
  }
  for (const e of events) {
    const ts = (e.ts ?? "").replace("T", " ").replace("Z", "");
    if (e.kind === "learn") {
      const d = e.detail ?? {};
      console.log(`[${ts}] LEARN  ${e.instanceId}: ${d.title} (rank ${d.chosenRank})`);
      console.log(`        ${d.selectionPath}`);
    } else if (e.kind === "refresh") {
      const d = e.detail ?? {};
      console.log(`[${ts}] REFRESH ${e.instanceId}: 拉取 ${d.drewCount} 条真实感官样本`);
    } else if (e.kind === "drift") {
      const d = e.detail ?? {};
      const by = d.bySource ?? {};
      const parts = Object.entries(by)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ");
      console.log(`[${ts}] DRIFT  ${e.instanceId}: 漂出 ${d.total} 条种子 [${parts}]`);
    } else {
      console.log(`[${ts}] ${e.kind} ${e.instanceId}: ${JSON.stringify(e.detail ?? {})}`);
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help") {
    console.log("用法: inspect.mjs <state|learned|seeds|log> [instanceId?] [n?]");
    process.exit(cmd ? 0 : 1);
  }
  const n = parseInt(rest.find((a) => /^\d+$/.test(a)) ?? "", 10);
  const instanceArg = rest.find((a) => !/^\d+$/.test(a));
  try {
    if (cmd === "state") await cmdState(instanceArg);
    else if (cmd === "learned") cmdLearned(instanceArg);
    else if (cmd === "seeds") cmdSeeds(Number.isFinite(n) ? n : 20);
    else if (cmd === "log") cmdLog(Number.isFinite(n) ? n : 50);
    else {
      console.error("未知命令:", cmd);
      process.exit(1);
    }
  } catch (e) {
    console.error("错误:", e.message);
    process.exit(1);
  }
}

main();
