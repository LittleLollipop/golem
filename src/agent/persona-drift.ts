/**
 * PersonaDriftService — daily introspection that nudges a golem's personality
 * along structured dimensions, accumulating into a slow, rollback-able drift.
 *
 * Design (docs/persona-drift.md):
 *   - base persona is an IMMUTABLE anchor (never rewritten on disk).
 *   - each calendar day (first idle after a day flip) an introspection reads
 *     recent dialogue + memory + the prior drift chain, asks the host LLM for a
 *     SMALL per-dimension delta, persists it as a `persona_drift` Event node
 *     wired into a causal chain, and composes an "effective persona" =
 *     base + current cumulative leanings.
 *   - guards: single-day delta cap, cumulative clamp, output validation,
 *     no-dialogue-skips (a gap in the chain is itself meaningful).
 *
 * Degradation (never throws, never blocks): no LLM → skip; bad JSON → skip
 * (chain simply doesn't grow that day); store error bubbles to the idle caller
 * which catches it so other maintenance still runs.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GraphStore } from "../memory/graph-store.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";
import type { InstanceId, GraphNode, GraphEdge, InstanceMeta, TraitBaseline } from "../types.js";
import { normalizeTraitBaseline, zeroTraitBaseline } from "../types.js";
import { loadPersonaDriftConfig, type PersonaDriftConfig } from "../leak/config.js";

/**
 * 解析「常驻核心人设」(docs/persona-layering.md §3)。
 * 优先级：personaCore (显式精简核心) > persona (旧字段兼容) > fallback。
 * 红线/身份/维度基线只从此处注入，绝不进图库 recall 路径。
 */
export function resolveCorePersona(meta: InstanceMeta | null | undefined, fallback: string): string {
  return meta?.personaCore ?? meta?.persona ?? fallback;
}

// ── 三层人格坐标系（docs/persona-drift-dimensions.md §3/§4） ────────────────
//
// 维度定义是**后端的单一真源**：前端经 `getDriftDims` 拉取，不再硬编码
// （旧实现把维度名写死在 DriftDashboard.tsx，一改维度 UI 立即错位，§9.1）。

/** 一个可漂移维度的完整定义。 */
export interface DriftDimDef {
  key: string;
  /** 中文名（UI 与人设文案共用）。 */
  label: string;
  /** 正向（累积 > 0）时的人设描述。 */
  pos: string;
  /** 负向（累积 < 0）时的人设描述。 */
  neg: string;
  /** state = 人格状态轴（HEXACO 子集）；expression = 表现层（聊天机器人专用）。 */
  layer: "state" | "expression";
  /**
   * 操作定义——写进提示词用于**去共线**（§4.2）。没有它，模型会把
   * "话变多了" 同时记进 extraversion 与 verbosity，同一信号被计两遍。
   */
  scope: string;
  /** 该维度排除在外的语义（同样写进提示词）。 */
  notScope: string;
}

/**
 * State 层四维 + 表现层两维。
 *
 * HEXACO 的 **C（尽责性）与 H（诚实-谦逊）被刻意剔除**（§4.1）：它们在闲聊
 * 文本中不可观测——模型找不到证据，只能输出噪声。它们仍留在 Trait 层的
 * HEXACO 坐标里（标一次，用于人格画像），只是不参与每日漂移。
 */
export const DIM_DEFS: readonly DriftDimDef[] = [
  {
    key: "extraversion",
    label: "外向性",
    pos: "更主动开启话题、更外放",
    neg: "更内敛、更少主动",
    layer: "state",
    scope: "社交能量与主动性：是否主动开启话题、主动追问、情绪外放",
    notScope: "不含「说了多少字」",
  },
  {
    key: "agreeableness",
    label: "宜人性",
    pos: "更包容随和、更少反驳",
    neg: "更爱坚持己见、更爱抬杠",
    layer: "state",
    scope: "对抗性：是否反驳、挑刺、坚持己见（分数下降 = 更有主张）",
    notScope: "不含「热不热情」",
  },
  {
    key: "openness",
    label: "开放性",
    pos: "对新鲜事物更敞开、更愿意尝试",
    neg: "更偏好熟悉与安稳",
    layer: "state",
    scope: "联想与好奇：是否主动类比、展开、对新想法有兴趣",
    notScope: "不含「话多」",
  },
  {
    key: "emotionality",
    label: "情绪性",
    pos: "更容易担忧、更敏感",
    neg: "更平稳、更不易受影响",
    layer: "state",
    scope: "情绪底色：担忧、敏感、易受影响的表达密度",
    notScope: "不含今日心情好坏（那是 mood 字段的事）",
  },
  {
    key: "verbosity",
    label: "表达欲",
    pos: "表达更丰沛、话更多",
    neg: "更惜字如金",
    layer: "expression",
    scope: "表达量：单轮回复的长度、是否展开细节",
    notScope: "不含「主不主动」",
  },
  {
    key: "playfulness",
    label: "俏皮度",
    pos: "更爱玩笑、反讽与玩梗",
    neg: "更端庄严肃",
    layer: "expression",
    scope: "语言游戏密度：玩笑、反讽、玩梗、自嘲的使用频率",
    notScope: "不含「情绪高不高」",
  },
];

const DIM_BY_KEY: Record<string, DriftDimDef> = Object.fromEntries(
  DIM_DEFS.map((d) => [d.key, d]),
);

// ── Trait 层：HEXACO 六维人格坐标（§3 / §12-Q3 裁定：全部露出） ────────────

export interface TraitDimDef {
  key: "H" | "E" | "X" | "A" | "C" | "O";
  /** 中文维度名。 */
  label: string;
  /** 白话注解——HEXACO 六词对非专业用户偏学术，必须给一句人话（§12-Q3）。 */
  hint: string;
  /** 高分端描述。 */
  pos: string;
  /** 低分端描述。 */
  neg: string;
  /**
   * 是否参与每日漂移。
   * H（诚实-谦逊）与 C（尽责性）为 false：它们在闲聊文本中不可观测，
   * 强行每日打分只会退化成噪声（§4.1）。UI 据此**灰显**这两维并注明
   * "仅作人格坐标，不参与每日漂移"。
   */
  drifts: boolean;
}

export const TRAIT_DIM_DEFS: readonly TraitDimDef[] = [
  {
    key: "H",
    label: "诚实谦逊",
    hint: "高 = 不投机、不虚荣、不占小便宜；低 = 爱炫耀、讲策略、求回报",
    pos: "更不屑投机取巧",
    neg: "更会为自己争取",
    drifts: false,
  },
  {
    key: "E",
    label: "情绪性",
    hint: "高 = 易担忧、易受伤、需要情感支持；低 = 情绪平稳、抗压",
    pos: "更容易担忧受伤",
    neg: "更情绪平稳",
    drifts: true,
  },
  {
    key: "X",
    label: "外向性",
    hint: "高 = 社交自信、活跃、爱表达；低 = 安静、慢热、回避社交",
    pos: "更社交自信活跃",
    neg: "更安静慢热",
    drifts: true,
  },
  {
    key: "A",
    label: "宜人性",
    hint: "高 = 温顺包容、少反驳；低 = 爱抬杠、坚持己见、不易让步",
    pos: "更温顺包容",
    neg: "更爱抬杠坚持",
    drifts: true,
  },
  {
    key: "C",
    label: "尽责性",
    hint: "高 = 有条理、自律、靠谱；低 = 随性、拖延、不拘小节",
    pos: "更有条理自律",
    neg: "更随性散漫",
    drifts: false,
  },
  {
    key: "O",
    label: "开放性",
    hint: "高 = 好奇、爱联想、接受新鲜事物；低 = 务实、偏好熟悉",
    pos: "更好奇爱联想",
    neg: "更务实守成",
    drifts: true,
  },
];

/**
 * 当前实际生效的漂移维度定义（按 cfg.dims 过滤并保序）。
 *
 * cfg.dims 可被 `FAKEREN_DRIFT_DIMS` 覆盖，且可能包含 DIM_DEFS 之外的自定义
 * 维度——那种情况给一个兜底 def，保证 UI 至少能显示维度名而不是崩掉。
 */
export function activeDimDefs(dims: readonly string[]): DriftDimDef[] {
  return dims.map(
    (k) =>
      DIM_BY_KEY[k] ?? {
        key: k,
        label: k,
        pos: "更偏正向",
        neg: "更偏负向",
        layer: "expression" as const,
        scope: "自定义维度",
        notScope: "无",
      },
  );
}

/** 给 composeEffectivePersona 用的查表（等价于旧 DIM_LABELS）。 */
function dimLabel(key: string): { name: string; pos: string; neg: string } | undefined {
  const d = DIM_BY_KEY[key];
  return d ? { name: d.label, pos: d.pos, neg: d.neg } : undefined;
}

/**
 * State 维度 → Trait 基线的回弹目标（§5.3）。
 *
 * 表现层两维在 HEXACO 中没有对应轴，用**代理映射**而非硬编码 0：
 * 话多话少随外向性走，玩心随外向与开放走。
 */
export function targetOf(stateDim: string, trait: TraitBaseline): number {
  switch (stateDim) {
    case "extraversion":
      return trait.X;
    case "agreeableness":
      return trait.A;
    case "openness":
      return trait.O;
    case "emotionality":
      return trait.E;
    case "verbosity":
      return trait.X;
    case "playfulness":
      return (trait.X + trait.O) / 2;
    default:
      return 0;
  }
}

/**
 * 重力回弹（§5.2）：把累积值往 trait 基线拉。
 *
 * `|cum - target| <= softBand` 内只有弱回弹（保留真实漂移空间）；
 * 超出软带后，每再偏离 0.2，系数**翻倍**——于是即使模型天天给满正向增量，
 * 累积也会稳定在 target ± 0.5 附近，**永不长期贴边**。
 *
 * 这是修复「实测 delta 恒定 → 7 天撞满边界」（§1.2）的唯一手段：
 * 旧代码只有硬 clamp，没有任何回复力。
 */
export function revertPull(cum: number, target: number, k: number, softBand: number): number {
  const d = cum - target;
  const over = Math.max(0, Math.abs(d) - softBand);
  const coeff = k * (1 + over / 0.2);
  return -coeff * d;
}

/**
 * 波动幅度因子：> 1 表示「这个人波动更大」→ 回弹更弱。
 *
 * ⚠️ **工程启发式，没有文献支持**（§5.4）。文献支持的只有两件事：
 * trait 是状态分布的中心（→ 决定回弹目标），以及波动幅度存在稳定的个体
 * 差异（→ 每个人可以有自己的系数）。**不支持**「trait 水平高 → 波动大」
 * 这种线性映射。所以默认关闭（`FAKEREN_DRIFT_HEURISTIC_VOL=0`）。
 */
function volatilityFactor(dim: string, trait: TraitBaseline, on: boolean): number {
  if (!on) return 1;
  return 1 + Math.abs(targetOf(dim, trait)) * 0.5;
}

const DRIFT_KIND = "persona_drift";
const DAY_MS = 86_400_000;
/** leanings below this magnitude are treated as "no noticeable drift yet". */
const LEANING_EPS = 0.05;
/**
 * drift 节点结构版本。v1 = 旧五维（openness/warmth/verbosity/playfulness/
 * assertiveness，无此字段）；v2 = 三层人格坐标系六维。
 *
 * v1 节点**不删除**（留作审计），但被排除在累积计算之外——旧维度的语义
 * 无法无损映射到新维度（§7）。
 */
export const DRIFT_SCHEMA_VERSION = 2;

/**
 * 一条 evidence 引用（§6.4）。
 *
 * 历史 bug（2026-09-01 实测）：模型一直在返回**自然语言文本**（如
 * `U: 你知道写故事的节拍吗?...`），而建边代码直接把它当节点 id 用 →
 * 全部 `relates` 边指向不存在的节点，UI 上「evidence 边 4」的计数在涨、
 * 追溯能力实际为 0。根因是提示词要求 id 却没把 id 喂给模型。
 *
 * 现在引用与引文分离：`nodeId` 必须是图中真实存在的 id（建边前校验），
 * `quote` 只作人读摘录、不进图。
 */
export interface DriftEvidenceRef {
  /** 图中真实存在的节点 id。缺失 = 模型只给了引文，没对应到节点。 */
  nodeId?: string;
  /** 支撑判断的原文摘录（人读）。 */
  quote: string;
}

export interface DriftRecord {
  date: string;
  /** today's per-dimension delta (NOT absolute). */
  dims: Record<string, number>;
  /** cumulative leanings including today (kept so compose() reads one node). */
  cumulative: Record<string, number>;
  mood?: string;
  leaning?: string;
  preoccupation?: string;
  rationale?: string;
  evidence: string[];
  /**
   * 结构化 evidence 引用（§6.4）。`evidence` 是它的兼容视图
   * （= refs.map(r => r.quote)），保证旧 JSONL / UI 不破坏。
   */
  evidenceRefs?: DriftEvidenceRef[];
  /** v2 起：本次计算所用的回弹目标（可审计）。 */
  traitTarget?: Record<string, number>;
  /** v2 起：本次实际施加的回弹量（可审计，负值 = 往基线拉回）。 */
  revertPull?: Record<string, number>;
  /** drift 节点结构版本；缺失 = v1（旧五维）。 */
  schemaVersion?: number;
}

/**
 * Structured, machine+human readable record of ONE introspection run. Emitted
 * to a DriftReporter after EVERY run (success / skip / failure) so the
 * otherwise-black-box idle introspection becomes observable (user 2026-08-30).
 */
export interface DriftExecutionResult {
  instanceId: string;
  /** calendar day this run targets (ymd). */
  date: string;
  /** ISO timestamp the run started. */
  triggeredAt: string;
  /** true once we actually called the LLM (vs short-circuited / skipped). */
  triggered: boolean;
  /** why the run did NOT produce a drift node. */
  skipReason?: "already-done" | "no-dialogue" | "no-llm" | "model-empty";
  /** node id of the already-existing same-day drift (already-done). */
  existingNodeId?: string;
  /** what the run read before calling the model. */
  input?: { dialogTurns: number; recentDays: number; memoryTopics: number; historyDrifts: number };
  /** raw LLM response (for debugging model drift / prompt issues). */
  llmRaw?: string;
  /** model/parse failure. */
  error?: "llm-error" | "bad-json";
  /** parsed + validated outcome (present when a node was actually written). */
  parsed?: {
    dims: Record<string, number>;
    cumulative: Record<string, number>;
    mood?: string;
    leaning?: string;
    preoccupation?: string;
    rationale?: string;
    evidence: string[];
    evidenceRefs?: DriftEvidenceRef[];
    traitTarget?: Record<string, number>;
    revertPull?: Record<string, number>;
  };
  /** where the result was persisted. */
  written?: {
    nodeId: string;
    causalEdges: number;
    evidenceEdges: number;
    /**
     * 未能建成边的 evidence 条数（引文没对应到真实节点，§6.4）。
     * 与 evidenceEdges 一起显示成「evidence 边 2（悬空 3）」——追溯有效性
     * 从此可直接读数，不再是黑盒。
     */
    evidenceSkipped: number;
  };
}

/** Sink for introspection execution results (file log, stdout, …). */
export interface DriftReporter {
  report(instanceId: string, result: DriftExecutionResult): void;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function emptyDims(dims: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const d of dims) o[d] = 0;
  return o;
}

/**
 * 内省提示词。
 *
 * ⚠️ 三处针对「实测 delta 恒定」（§1.3）新增的硬规定，缺一不可：
 *   ① 给出**当前偏离量**并要求无新证据时回归——旧提示词从没告诉模型已经
 *      偏离多少，LLM 的默认倾向是"每天都能找到一点正向变化"，于是产生
 *      系统性正向偏置（实测 08-31 与 09-01 的 dims 向量逐字节相同）。
 *   ② 明确"性格不会每天都变"，并允许输出 0。
 *   ③ evidence 必须从上下文里给出的 **候选 id 方括号**中选取——旧提示词
 *      要 id 却没把 id 喂进去，模型只能编（§6.4 根因）。
 */
function introspectSystem(dims: readonly DriftDimDef[], dimCaps: Record<string, number>, defaultCap: number): string {
  const dimLines = dims
    .map((d) => {
      const cap = dimCaps[d.key] ?? defaultCap;
      return `- ${d.key}（${d.label}）：测「${d.scope}」。${d.notScope}。单日上限 ±${cap}。`;
    })
    .join("\n");
  return `你是某个 AI 假人的"性格内省器"。基于她近期的对话与记忆，判断她的性格今天应向哪些方向做**微小**调整。
你只能输出 JSON，不要任何解释。格式：
{"dims":{"<维度名>":<当日增量 -1..1>},"mood":"<一个词形容今日心境>","leaning":"<一句话：她更倾向于怎么回应>","preoccupation":"<反复出现的主题>","rationale":"<一句话说明为什么这么判断>","evidence":[{"nodeId":"<候选 id>","quote":"<支撑判断的原文摘录>"}]}
规则：
- dims 是**当日增量**（不是绝对值），只输出给定的维度集合中的维度；不要输出其它键去改写 base persona（base 是不可改的锚）。
- 单日幅度必须克制（通常不超过 ±${defaultCap}）。**性格不会每天都变**——若今日对话没有新的性格信号，请输出 0，不要为了"有变化"而凑一个增量。
- 下面会给出各维度**当前已偏离基线的量**。若该维度已经在同方向上偏离较多、而今日对话又没有新增证据支持继续同向移动，请输出 0 或反向的小增量，让她回到基线附近。
- mood 是**今日心境**，可以每日大幅波动，不用在 dims 里重复；emotionality（情绪性）是**情绪底色**，只有当连续多日出现同类情绪表达时才微调。
- 去共线：严格按下列每维的定义边界打分，同一件事只记进一个维度。
${dimLines}
- evidence 最多 5 条。nodeId **必须**从下面对话/记忆里方括号中的候选 id 选取（如 [evt_7f3a]），**绝不自己编造 id**；quote 填支撑你判断的原文摘录。若找不到对应节点，就只给 quote、不给 nodeId。`;
}

/**
 * 从 core persona 推断 HEXACO 六维基线（§6.1 路径①）。
 *
 * 只在**用户显式触发**（UI「从人设自动推断」按钮）时调用——内省路径绝不
 * 静默写回 meta：`set_meta` 是整块覆盖，与 UI 编辑并发会丢改（§12-Q2）。
 * 失败/无 LLM → 回退全 0 基线，不抛异常（降级不崩）。
 */
export async function inferTraitBaseline(
  corePersona: string,
  llm: LlmClient | undefined,
): Promise<TraitBaseline> {
  if (!llm || !corePersona.trim()) return zeroTraitBaseline();
  const system = `你是人格评估器。阅读下面这段 AI 假人的核心人设，按 HEXACO 六维给她打一个**静态人格坐标**（这是她长期稳定的特质，不是今天的状态）。
只输出 JSON：{"H":<-1..1>,"E":<-1..1>,"X":<-1..1>,"A":<-1..1>,"C":<-1..1>,"O":<-1..1>}
- H 诚实-谦逊：高=不投机、不虚荣、不占便宜；低=爱炫耀、讲策略、求回报
- E 情绪性：高=易担忧、易受伤、需要情感支持；低=情绪平稳、不怕压力
- X 外向性：高=社交自信、活跃、爱表达；低=安静、回避社交、慢热
- A 宜人性：高=温顺包容、少反驳；低=爱抬杠、坚持己见、不易让步
- C 尽责性：高=有条理、自律、靠谱；低=随性、拖延、不拘小节
- O 经验开放性：高=好奇、爱联想、接受新鲜事物；低=务实、偏好熟悉
0 = 常人均值。没有依据的维度给 0，不要臆测。`;
  let raw = "";
  try {
    raw = await llm.complete(system, `【核心人设】\n${corePersona}`);
    const json = JSON.parse(stripFence(raw)) as unknown;
    return normalizeTraitBaseline(json);
  } catch {
    return zeroTraitBaseline();
  }
}

/** 把任意输入规整成 evidence 引用数组（兼容字符串 / 对象两种写法）。 */
function parseEvidence(raw: unknown): DriftEvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: DriftEvidenceRef[] = [];
  for (const item of (raw as unknown[]).slice(0, 5)) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push({ quote: s });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const quote =
        typeof o.quote === "string"
          ? o.quote.trim()
          : typeof o.text === "string"
            ? o.text.trim()
            : "";
      const nodeId =
        typeof o.nodeId === "string"
          ? o.nodeId.trim()
          : typeof o.id === "string"
            ? o.id.trim()
            : undefined;
      if (!quote && !nodeId) continue;
      out.push({ ...(nodeId ? { nodeId } : {}), quote: quote || nodeId! });
    }
  }
  return out;
}

export class PersonaDriftService {
  constructor(
    private readonly store: GraphStore,
    private readonly llm: LlmClient | undefined,
    private readonly cfg: PersonaDriftConfig,
    private readonly reporter?: DriftReporter,
  ) {}

  // ── read side ────────────────────────────────────────────────────────────

  /**
   * All persona_drift records for an instance, chronological.
   *
   * 默认**只返回 v2**（`schemaVersion === 2`）。v1（旧五维，无此字段）节点
   * 仍留在图里供审计，但不参与累积计算——旧维度无法无损映射到新维度（§7）。
   * 传 `includeLegacy: true` 可读到全部（审查 / 迁移脚本用）。
   */
  private async loadDriftChain(
    instanceId: InstanceId,
    opts?: { includeLegacy?: boolean },
  ): Promise<Array<{ rec: DriftRecord; id: string }>> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    const out: Array<{ rec: DriftRecord; id: string }> = [];
    for (const n of all) {
      if (n.type !== "Event") continue;
      if ((n.props as any)?.kind !== DRIFT_KIND) continue;
      const rec = this.parseRecord(n);
      if (!rec) continue;
      if (!opts?.includeLegacy && rec.schemaVersion !== DRIFT_SCHEMA_VERSION) continue;
      out.push({ rec, id: n.id });
    }
    out.sort((a, b) => (a.rec.date < b.rec.date ? -1 : a.rec.date > b.rec.date ? 1 : 0));
    return out;
  }

  private parseRecord(n: GraphNode): DriftRecord | null {
    const p = n.props as any;
    if (typeof p?.date !== "string" || typeof p?.dims !== "object" || p.dims === null) return null;
    const dims: Record<string, number> = {};
    for (const k of Object.keys(p.dims)) {
      const v = Number(p.dims[k]);
      if (Number.isFinite(v)) dims[k] = v;
    }
    const cumRaw = p.cumulative && typeof p.cumulative === "object" ? p.cumulative : {};
    const cumulative: Record<string, number> = {};
    for (const k of Object.keys(cumRaw)) {
      const v = Number((cumRaw as any)[k]);
      if (Number.isFinite(v)) cumulative[k] = v;
    }
    const refs = parseEvidence(p.evidenceRefs);
    return {
      date: p.date,
      dims,
      cumulative,
      mood: typeof p.mood === "string" ? p.mood : undefined,
      leaning: typeof p.leaning === "string" ? p.leaning : undefined,
      preoccupation: typeof p.preoccupation === "string" ? p.preoccupation : undefined,
      rationale: typeof p.rationale === "string" ? p.rationale : undefined,
      // 有 refs 时以它为准；否则回退到旧的 evidence: string[]（v1 兼容）
      evidence:
        refs.length > 0
          ? refs.map((r) => r.quote)
          : Array.isArray(p.evidence)
            ? (p.evidence as unknown[]).filter((x) => typeof x === "string").map((x) => x as string)
            : [],
      evidenceRefs: refs.length > 0 ? refs : undefined,
      traitTarget:
        p.traitTarget && typeof p.traitTarget === "object" ? (p.traitTarget as Record<string, number>) : undefined,
      revertPull:
        p.revertPull && typeof p.revertPull === "object" ? (p.revertPull as Record<string, number>) : undefined,
      schemaVersion: typeof p.schemaVersion === "number" ? p.schemaVersion : undefined,
    };
  }

  /**
   * Recent dialogue turns, cleaned (system-reminders / field-incomplete dropped).
   *
   * 带上节点 id——evidence 边要指回这些 id（§6.4①）。旧实现只带文本，
   * 导致提示词要求 id、模型只能编造，evidence 边 100% 悬空。
   */
  private async recentDialogue(
    instanceId: InstanceId,
    cutoff: number,
  ): Promise<Array<{ id: string; u: string; a: string }>> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    const out: Array<{ id: string; u: string; a: string }> = [];
    for (const n of all) {
      if (n.type !== "Event") continue;
      const p = n.props as any;
      if (p?.kind === DRIFT_KIND) continue; // never feed the drift chain back in
      const u = typeof p?.userText === "string" ? p.userText : "";
      const a = typeof p?.assistantSummary === "string" ? p.assistantSummary : "";
      if (!u || !a) continue; // 字段残缺（手工测试节点）→ 丢弃
      if (u.startsWith("<system-reminder")) continue; // 系统提醒非真实对话
      if ((n.timestamp ?? 0) < cutoff) continue; // 时间窗口
      out.push({ id: n.id, u, a });
    }
    return out;
  }

  private async recentMemoryTopics(
    instanceId: InstanceId,
  ): Promise<Array<{ id: string; label: string }>> {
    const all = await this.store.query({ instanceId, limit: 1000 });
    return all
      .filter((n) => n.type === "Entity" && typeof n.label === "string")
      .map((n) => ({ id: n.id, label: n.label as string }))
      .slice(0, 20);
  }

  // ── write side: introspection ─────────────────────────────────────────────

  /**
   * Run today's introspection. Idempotent per calendar day (a drift node for
   * `today` already existing short-circuits). Returns the new record, or null
   * when skipped (already done / no LLM / no dialogue / model produced nothing).
   */
  async introspect(instanceId: InstanceId, now: Date = new Date()): Promise<DriftRecord | null> {
    const today = ymd(now);
    const triggeredAt = now.toISOString();
    const result: DriftExecutionResult = { instanceId, date: today, triggered: false, triggeredAt };

    const chain = await this.loadDriftChain(instanceId);
    const existing = chain.find((c) => c.rec.date === today);
    if (existing) {
      result.skipReason = "already-done";
      result.existingNodeId = existing.id;
      this.reporter?.report(instanceId, result);
      return null;
    }

    const nowTs = now.getTime();
    const cutoff = nowTs - this.cfg.recentDays * DAY_MS;
    const dialogue = await this.recentDialogue(instanceId, cutoff);
    const memoryTopics = await this.recentMemoryTopics(instanceId);
    result.input = {
      dialogTurns: dialogue.length,
      recentDays: this.cfg.recentDays,
      memoryTopics: memoryTopics.length,
      historyDrifts: chain.length,
    };

    if (dialogue.length === 0) {
      result.skipReason = "no-dialogue";
      this.reporter?.report(instanceId, result);
      return null; // Q3: 无对话 → 跳过（链断档）
    }

    const prev = chain.length > 0 ? chain[chain.length - 1].rec.cumulative : emptyDims(this.cfg.dims);
    let base = "";
    let trait = zeroTraitBaseline();
    try {
      const m = await this.store.getMeta(instanceId);
      base = m?.personaCore ?? m?.persona ?? "";
      // 未标注 traitBaseline → 全 0（回弹目标退化为 0），功能不中断（§10 用例 9）。
      trait = normalizeTraitBaseline(m?.traitBaseline);
    } catch {
      /* ignore — base anchor optional for the prompt */
    }

    if (!this.llm) {
      result.skipReason = "no-llm";
      this.reporter?.report(instanceId, result);
      return null;
    }

    result.triggered = true;
    const outcome = await this.callModel({ today, base, dialogue, memoryTopics, prev, trait });
    result.llmRaw = outcome.llmRaw;
    if (outcome.error) {
      result.error = outcome.error;
      this.reporter?.report(instanceId, result);
      return null;
    }
    if (!outcome.record) {
      result.skipReason = "model-empty";
      this.reporter?.report(instanceId, result);
      return null;
    }

    const record = outcome.record;
    const newId = `persona-drift-${today}-${Math.random().toString(36).slice(2, 8)}`;
    const node: GraphNode = {
      id: newId,
      type: "Event",
      label: `性格漂移 ${today}`,
      instanceId,
      props: {
        kind: DRIFT_KIND,
        schemaVersion: DRIFT_SCHEMA_VERSION,
        ...record,
      } as Record<string, unknown>,
      valence: 0,
      valenceSelf: true,
      weight: 1,
      decayed: false,
      timestamp: nowTs,
    };
    await this.store.addNode(node);

    let causalEdges = 0;
    let evidenceEdges = 0;
    let evidenceSkipped = 0;
    // causal chain: link to the previous drift node
    if (chain.length > 0) {
      const e: GraphEdge = {
        from: chain[chain.length - 1].id,
        to: newId,
        kind: "causal",
        instanceId,
        weight: 1,
      };
      await this.store.addEdge(e);
      causalEdges = 1;
    }

    // evidence edges — **建边前校验节点真实存在**（§6.4③）。
    // 旧实现无条件 `to: ev`，而 ev 常是自然语言文本 → 100% 悬空边，
    // 「evidence 边 N」的计数在涨、追溯能力为零。现在悬空的只记 skipped、不建边。
    const refs = record.evidenceRefs ?? [];
    const liveIds = new Set(
      (await this.store.query({ instanceId, limit: 1000 })).map((n) => n.id),
    );
    for (const ref of refs) {
      // 兼容：模型只给了一个裸字符串、而它恰好是真实节点 id → 提升为 nodeId
      const nodeId = ref.nodeId ?? (liveIds.has(ref.quote) ? ref.quote : undefined);
      if (!nodeId || !liveIds.has(nodeId)) {
        evidenceSkipped++;
        continue;
      }
      const e: GraphEdge = { from: newId, to: nodeId, kind: "relates", instanceId, weight: 1 };
      await this.store.addEdge(e);
      evidenceEdges++;
    }

    result.parsed = {
      dims: record.dims,
      cumulative: record.cumulative,
      mood: record.mood,
      leaning: record.leaning,
      preoccupation: record.preoccupation,
      rationale: record.rationale,
      evidence: record.evidence,
      evidenceRefs: record.evidenceRefs,
      traitTarget: record.traitTarget,
      revertPull: record.revertPull,
    };
    result.written = { nodeId: newId, causalEdges, evidenceEdges, evidenceSkipped };
    this.reporter?.report(instanceId, result);
    return record;
  }

  private async callModel(ctx: {
    today: string;
    base: string;
    dialogue: Array<{ id: string; u: string; a: string }>;
    memoryTopics: Array<{ id: string; label: string }>;
    prev: Record<string, number>;
    trait: TraitBaseline;
  }): Promise<{ record: DriftRecord | null; llmRaw?: string; error?: "llm-error" | "bad-json" }> {
    // 当前偏离量 = cum - target。这是治「系统性正向偏置」的关键输入（§1.3）：
    // 旧提示词从没告诉模型已经偏离多少，于是它每天都"找到一点正向变化"。
    const targets: Record<string, number> = {};
    const offsets: Record<string, number> = {};
    for (const k of this.cfg.dims) {
      const t = targetOf(k, ctx.trait);
      targets[k] = t;
      offsets[k] = Number(((ctx.prev[k] ?? 0) - t).toFixed(3));
    }
    const defs = this.cfg.dims.map((k) => DIM_BY_KEY[k]).filter((d): d is DriftDimDef => !!d);

    const user = [
      `【base persona（不可修改的锚）】\n${ctx.base || "(无)"}`,
      `【近期对话（方括号内为节点 id，evidence 只能从中选）】\n${ctx.dialogue
        .map((d) => `[${d.id}] U: ${d.u}\n${" ".repeat(d.id.length + 2)}A: ${d.a}`)
        .join("\n\n")}`,
      `【近期记忆主题（方括号内为节点 id）】\n${ctx.memoryTopics
        .map((m) => `[${m.id}] ${m.label}`)
        .join("、") || "(无)"}`,
      `【各维度当前已偏离基线的量（正=已高于基线，负=已低于基线）】\n${JSON.stringify(offsets)}`,
      `【她的 HEXACO 人格基线】\n${JSON.stringify(ctx.trait)}`,
      `请输出今日性格微调 JSON（维度集合：${this.cfg.dims.join(", ")}）。`,
    ].join("\n");

    let raw = "";
    try {
      raw = await this.llm!.complete(
        introspectSystem(defs.length > 0 ? defs : DIM_DEFS, this.cfg.dimCaps, this.cfg.dailyDeltaCap),
        user,
      );
    } catch {
      return { record: null, llmRaw: raw, error: "llm-error" };
    }
    let json: any;
    try {
      json = JSON.parse(stripFence(raw));
    } catch {
      return { record: null, llmRaw: raw, error: "bad-json" };
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) return { record: null, llmRaw: raw };

    // validate + clamp dims to the allowed set and the single-day cap
    // （per-dim cap 覆盖默认 cap：emotionality 单独收紧到 0.08，§4.3）
    const allowed = new Set(this.cfg.dims);
    const dims: Record<string, number> = {};
    for (const k of Object.keys(json.dims ?? {})) {
      if (!allowed.has(k)) continue; // 丢弃非维度 / 改写 base 的字段
      const v = Number(json.dims[k]);
      if (!Number.isFinite(v)) continue;
      const cap = this.cfg.dimCaps[k] ?? this.cfg.dailyDeltaCap;
      dims[k] = clamp(v, -cap, cap);
    }
    if (Object.keys(dims).length === 0) return { record: null, llmRaw: raw }; // 平凡日

    // cumulative = prev + today's delta + 重力回弹，clamped to the soft boundary。
    // 回弹是修复「delta 恒定 → 7 天撞满边界」的关键（§1.2 / §5.2）；
    // traitTarget / revertPull 一并存节点，便于事后审计回弹是否生效。
    const cumulative: Record<string, number> = { ...emptyDims(this.cfg.dims), ...ctx.prev };
    const pulls: Record<string, number> = {};
    const appliedTargets: Record<string, number> = {};
    for (const k of Object.keys(dims)) {
      const before = cumulative[k] ?? 0;
      const target = targets[k] ?? targetOf(k, ctx.trait);
      const kEff =
        this.cfg.revertK > 0
          ? this.cfg.revertK / volatilityFactor(k, ctx.trait, this.cfg.heuristicVol)
          : 0;
      const pull = kEff > 0 ? revertPull(before, target, kEff, this.cfg.softBand) : 0;
      pulls[k] = Number(pull.toFixed(4));
      appliedTargets[k] = target;
      cumulative[k] = clamp(
        before + dims[k] + pull,
        -this.cfg.cumulativeClamp,
        this.cfg.cumulativeClamp,
      );
    }

    const refs = parseEvidence(json.evidence);

    return {
      record: {
        date: ctx.today,
        dims,
        cumulative,
        mood: typeof json.mood === "string" ? json.mood : undefined,
        leaning: typeof json.leaning === "string" ? json.leaning : undefined,
        preoccupation: typeof json.preoccupation === "string" ? json.preoccupation : undefined,
        rationale: typeof json.rationale === "string" ? json.rationale : undefined,
        evidence: refs.map((r) => r.quote),
        evidenceRefs: refs,
        traitTarget: appliedTargets,
        revertPull: pulls,
        schemaVersion: DRIFT_SCHEMA_VERSION,
      },
      llmRaw: raw,
    };
  }

  // ── read side: effective persona composition ───────────────────────────────

  /**
   * Compose the effective persona = base + current cumulative leanings. The base
   * is returned verbatim when there is no drift yet, or when every cumulative
   * dimension is still within the noise floor. The base string itself is NEVER
   * mutated — we only APPEND a "当前性格倾向" section.
   */
  async composeEffectivePersona(
    basePersona: string,
    instanceId: InstanceId,
    _now: Date = new Date(),
  ): Promise<string> {
    const chain = await this.loadDriftChain(instanceId);
    if (chain.length === 0) return basePersona;
    const cumulative = chain[chain.length - 1].rec.cumulative;

    const lines: string[] = [];
    for (const dim of this.cfg.dims) {
      const v = cumulative[dim] ?? 0;
      if (Math.abs(v) < LEANING_EPS) continue;
      const lab = dimLabel(dim);
      const dir = v > 0 ? (lab?.pos ?? dim) : (lab?.neg ?? dim);
      const mag = Math.abs(v) >= 0.6 ? "明显" : Math.abs(v) >= 0.3 ? "有所" : "略";
      lines.push(`- ${lab?.name ?? dim}：${mag}${dir}`);
    }
    if (lines.length === 0) return basePersona;
    return `${basePersona}\n\n【近期性格倾向】\n${lines.join("\n")}`;
  }
}

/**
 * Read the structured introspection timeline for an instance from the
 * append-only JSONL that FileDriftReporter writes. Returns [] when the file
 * does not exist yet (no introspection has run). Shared by the remote API
 * (golem-remote.ts) and any other reader so the file layout stays single-source.
 */
export async function readDriftRecords(
  instanceId: string,
  reportDir: string = loadPersonaDriftConfig().reportDir,
): Promise<DriftExecutionResult[]> {
  const file = path.join(reportDir, `${instanceId}.drift-records.jsonl`);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: DriftExecutionResult[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as DriftExecutionResult);
    } catch {
      /* skip a corrupted line rather than failing the whole timeline */
    }
  }
  return out;
}
