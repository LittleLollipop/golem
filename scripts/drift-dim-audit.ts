/**
 * 维度审计脚本 —— docs/persona-drift-dimensions.md §11 的五项验证指标，
 * 直接从 JSONL 执行记录里算，不依赖 LLM、不碰图库。
 *
 * 存在理由：换维度不是"换了就完事"。文档 §1 的教训是——旧五维跑了三天，
 * delta 恒定、累积单调、7 天后必撞边界，而**没有任何信号报出来**，直到人
 * 工翻 JSONL 才发现。这个脚本把那次人工排查变成一条命令。
 *
 * 用法：
 *   npx tsx scripts/drift-dim-audit.ts              # 默认审计默认实例全量
 *   npx tsx scripts/drift-dim-audit.ts ysj
 *   npx tsx scripts/drift-dim-audit.ts --all        # 审计所有实例的 jsonl
 *   FAKEREN_DRIFT_REPORT_DIR=/path npx tsx scripts/drift-dim-audit.ts ysj
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readDriftRecords } from "../src/agent/persona-drift.js";
import { loadPersonaDriftConfig } from "../src/leak/config.js";

// ── 判据（文档 §11 失败判据表） ─────────────────────────────────────────────
const THRESHOLDS = {
  /** 逐对维度 delta 的皮尔逊相关 > 此值 → 两维在测同一件事（合并候选） */
  collinearR: 0.7,
  /** 某维度 delta 为 0 的比例 > 此值 → 该维度不可观测（剔除候选） */
  zeroRatio: 0.8,
  /** |cum - target| > 0.9 的维度占比 > 此值 → 回弹参数不足 */
  edgeRatio: 0.1,
  /** delta 标准差低于此值 → 提示词回归指令没生效（模型在输出常数） */
  minStdDev: 0.005,
  /** evidence 能解析为真实节点的比例 < 此值 → 追溯仍失效 */
  evidenceHit: 0.5,
};

interface Row {
  date: string;
  dims: Record<string, number>;
  cumulative: Record<string, number>;
  traitTarget?: Record<string, number>;
  evidenceEdges: number;
  evidenceSkipped: number;
  /** 该记录是否带悬空计数（v2+ 才有）。false → evidence 指标不可审计。 */
  evidenceAuditable: boolean;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

function audit(instanceId: string, rows: Row[]): number {
  console.log(`\n=== ${instanceId} ===`);
  if (rows.length === 0) {
    console.log(Y("  无已写入的 drift 记录，跳过"));
    return 0;
  }
  console.log(`  样本：${rows.length} 天（${rows[0].date} ~ ${rows[rows.length - 1].date}）`);

  const dims = [...new Set(rows.flatMap((r) => Object.keys(r.dims)))].sort();
  let failures = 0;

  // ── 指标 4：delta 方差（最关键——它是 §1.1「恒定 delta」的直接检测器） ──
  console.log("\n[4] delta 方差（stdDev 过低 = 模型在输出常数）");
  for (const d of dims) {
    const series = rows.map((r) => r.dims[d] ?? 0);
    const sd = stdDev(series);
    const bad = sd < THRESHOLDS.minStdDev;
    if (bad) failures++;
    console.log(
      `    ${d.padEnd(16)} stdDev=${sd.toFixed(4)}  ${bad ? R("✗ 近乎恒定") : G("✓")}  ` +
        `序列 [${series.map((v) => v.toFixed(2)).join(", ")}]`,
    );
  }

  // ── 指标 2：维度失效（delta 恒为 0 的比例） ──
  console.log("\n[2] 维度失效（delta=0 占比 > 80% = 不可观测）");
  for (const d of dims) {
    const series = rows.map((r) => r.dims[d] ?? 0);
    const zero = series.filter((v) => v === 0).length / series.length;
    const bad = zero > THRESHOLDS.zeroRatio;
    if (bad) failures++;
    console.log(
      `    ${d.padEnd(16)} zero=${(zero * 100).toFixed(0)}%  ${bad ? R("✗ 剔除候选") : G("✓")}`,
    );
  }

  // ── 指标 1：维度共线 ──
  console.log("\n[1] 维度共线（|r| > 0.7 = 两维在测同一件事）");
  let pairs = 0;
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      const r = pearson(
        rows.map((x) => x.dims[dims[i]] ?? 0),
        rows.map((x) => x.dims[dims[j]] ?? 0),
      );
      if (Math.abs(r) > THRESHOLDS.collinearR) {
        failures++;
        pairs++;
        console.log(R(`    ✗ ${dims[i]} × ${dims[j]}  r=${r.toFixed(3)}`));
      }
    }
  }
  if (pairs === 0) console.log(G("    ✓ 无共线对"));

  // ── 指标 3：贴边率 ──
  const last = rows[rows.length - 1];
  console.log("\n[3] 贴边率（|cum - target| > 0.9）");
  const edge = dims.filter((d) => {
    const target = last.traitTarget?.[d] ?? 0;
    return Math.abs((last.cumulative[d] ?? 0) - target) > 0.9;
  });
  const edgeRatio = dims.length === 0 ? 0 : edge.length / dims.length;
  const edgeBad = edgeRatio > THRESHOLDS.edgeRatio;
  if (edgeBad) failures++;
  console.log(
    `    ${edge.length}/${dims.length} 维贴边  ${edgeBad ? R("✗ 回弹参数不足") : G("✓")}` +
      (edge.length ? `：${edge.join(", ")}` : ""),
  );

  // ── 指标 5：evidence 有效性 ──
  // ⚠️ 只对 v2+ 记录统计：v1 记录没有 `evidenceSkipped` 字段，而它记的
  // evidenceEdges **全是悬空边**（§1.4 实测）——把它算进来会得出 100% 命中的
  // 虚假结论。这正是该缺陷"静默"的原因：计数在涨、能力为零。
  const v2Rows = rows.filter((r) => r.evidenceAuditable);
  const totalEdges = v2Rows.reduce((a, r) => a + r.evidenceEdges, 0);
  const totalSkipped = v2Rows.reduce((a, r) => a + r.evidenceSkipped, 0);
  const totalRefs = totalEdges + totalSkipped;
  if (v2Rows.length === 0) {
    console.log(
      `\n[5] evidence 有效性：${Y("不可审计")} —— 全部 ${rows.length} 条记录均为 v1` +
        `（无悬空计数；v1 的 evidence 边实测 100% 指向不存在的节点，见 §1.4）`,
    );
  } else {
    const hit = totalRefs === 0 ? 1 : totalEdges / totalRefs;
    const evBad = hit < THRESHOLDS.evidenceHit;
    if (evBad) failures++;
    console.log(
      `\n[5] evidence 有效性：命中 ${totalEdges} / 引用 ${totalRefs} = ${(hit * 100).toFixed(0)}%  ` +
        (evBad ? R("✗ 追溯失效") : G("✓")) +
        (v2Rows.length < rows.length ? Y(`  （仅统计 ${v2Rows.length}/${rows.length} 条 v2+ 记录）`) : ""),
    );
  }

  // ── 累积轨迹（人读） ──
  console.log("\n    累积轨迹（cum → 目标）：");
  for (const d of dims) {
    const target = last.traitTarget?.[d] ?? 0;
    const traj = rows.map((r) => (r.cumulative[d] ?? 0).toFixed(2)).join(" → ");
    console.log(`      ${d.padEnd(16)} ${traj}   (target ${target.toFixed(2)})`);
  }

  console.log(
    failures === 0
      ? G(`\n  ✓ ${instanceId}：五项指标全部通过`)
      : Y(`\n  ⚠ ${instanceId}：${failures} 项未达标（判据见文档 §11）`),
  );
  return failures;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cfg = loadPersonaDriftConfig();
  const dir = cfg.reportDir;

  let targets: string[];
  if (args.includes("--all")) {
    if (!fs.existsSync(dir)) {
      console.log(Y(`报告目录不存在：${dir}`));
      return;
    }
    targets = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".drift-records.jsonl"))
      .map((f) => f.replace(".drift-records.jsonl", ""));
  } else {
    const id = args.find((a) => !a.startsWith("--"));
    if (!id) {
      console.log("用法: npx tsx scripts/drift-dim-audit.ts <instanceId> | --all");
      return;
    }
    targets = [id];
  }

  if (targets.length === 0) {
    console.log(Y(`${dir} 下没有 drift 记录文件`));
    return;
  }

  let total = 0;
  for (const id of targets) {
    const records = await readDriftRecords(id, dir);
    const rows: Row[] = records
      .filter((r) => r.parsed && r.written)
      .map((r) => ({
        date: r.date,
        dims: r.parsed!.dims,
        cumulative: r.parsed!.cumulative,
        traitTarget: r.parsed!.traitTarget,
        evidenceEdges: r.written!.evidenceEdges,
        evidenceSkipped: r.written!.evidenceSkipped ?? 0,
        evidenceAuditable: typeof r.written!.evidenceSkipped === "number",
      }));
    total += audit(id, rows);
  }

  console.log(
    total === 0
      ? G(`\n全部通过。样本量提示：维度相关的判据（共线/失效/方差）需要 ≥ 7 天样本才有统计意义。`)
      : Y(`\n共 ${total} 项未达标。`),
  );
  if (rows_sample_warn(targets, dir)) {
    console.log(Y("⚠ 样本 < 7 天：共线/失效/方差三项判据尚不可靠。"));
  }
}

/** 任意目标实例的有效样本是否不足 7 天（给出统计显著性提醒）。 */
function rows_sample_warn(targets: string[], dir: string): boolean {
  for (const id of targets) {
    const file = path.join(dir, `${id}.drift-records.jsonl`);
    if (!fs.existsSync(file)) continue;
    const n = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as { written?: unknown };
        } catch {
          return null;
        }
      })
      .filter((r) => r?.written).length;
    if (n > 0 && n < 7) return true;
  }
  return false;
}

void main();
