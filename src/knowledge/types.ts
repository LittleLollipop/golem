/**
 * L0.5 每日知识轨迹 — domain types (req_l05_knowledge_trajectory).
 *
 * "每天学 1 条（Google/Wiki 真实排名，top1 学过则 top2），带来源引用 + 选择路径".
 * The KnowledgeSource contract is pluggable: the default is a curated,
 * citation-backed static source (no network / API key — honest & reproducible
 * offline). A live Google/Wiki adapter is a drop-in replacement that returns
 * the same ranked shape.
 */

export interface KnowledgeCandidate {
  /** stable id (used for dedup / "top1 学过则 top2") */
  id: string;
  title: string;
  summary: string;
  /** where it ranks from — e.g. "Wikipedia" */
  source: string;
  /** real citation URL */
  sourceUrl: string;
  /** real ranking: 1 = top */
  rank: number;
}

export type KnowledgeMode = "top" | "random";

/** Which daily slot produced a learned record. */
export type LearnKind = "random" | "purposeful";

/**
 * Status of a daily learning *attempt* (req_l05 dual-track + abstract status).
 * The purposeful track does NOT fall back to default content; every attempt is
 * recorded as one of these. Only "learned" content leaks into drift.
 *   - learned: real content fetched
 *   - empty:   source returned 0 items / graph empty / planner failed
 *   - junk:    results all flagged as ads/spam by qualityGate
 *   - error:   source threw / timed out
 */
export type LearnStatus = "learned" | "empty" | "junk" | "error";

/** Backends the purposeful planner may choose among (full-open per dec). */
export type KnowledgeBackend = "wiki" | "news" | "social" | "web" | "static";

/** A model-produced learning directive (purposeful track only). */
export interface LearningDirective {
  source: KnowledgeBackend;
  mode?: KnowledgeMode;
  /** wiki search / news-social keyword focus / web search query */
  query?: string;
  /** why the model chose this — into selectionPath for auditability */
  rationale: string;
}

/** Context handed to the planner when it reads the instance graph. */
export interface LearningContext {
  instanceId: string;
  date: string;
  recentTopics: string[];
  learnedTitles: string[];
  graphNodeCount: number;
}

export interface KnowledgeSource {
  /**
   * Per-source default selection mode:
   *   - "top"    = curated / ranked / trending (the source's editorially-chosen
   *                top items; for wiki the 6 ranked topics, for news the top
   *                headlines, for social the trending feed).
   *   - "random" = endless discovery (a random item each call).
   * A global FAKEREN_KNOWLEDGE_MODE env can override this; when unset, the
   * source's defaultMode applies. Convention (dec_knowledge_mode_policy):
   * wiki → random, news/social → top.
   */
  readonly defaultMode: KnowledgeMode;
  /**
   * Ranked, real facts (Google/Wiki-style ranking). Stable, ascending by rank.
   * `directive` (purposeful track) optionally focuses the fetch by query / mode;
   * when omitted the source behaves exactly as before (backward-compatible).
   */
  rankedCandidates(directive?: LearningDirective): Promise<KnowledgeCandidate[]>;
}

export interface LearnedFact {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  /** epoch ms when learned */
  learnedAt: number;
  /** which rank was actually chosen */
  chosenRank: number;
  /** human-readable why, e.g. "top1 已学过 → 选 rank 2" or "模型规划: …" */
  selectionPath: string;
  // ── dual-track + abstract status (req_l05) ──
  /** which slot produced this record */
  kind: LearnKind;
  /** outcome of the attempt: learned / empty / junk / error */
  status: LearnStatus;
  /** present only for purposeful records */
  directive?: { source: string; query?: string; rationale: string };
  /** status note (e.g. "检索返回 0 条" / "结果疑似广告已丢弃" / "源异常: …") */
  statusNote?: string;
}
