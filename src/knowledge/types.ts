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

export interface KnowledgeSource {
  /** Ranked, real facts (Google/Wiki-style ranking). Stable, ascending by rank. */
  rankedCandidates(): Promise<KnowledgeCandidate[]>;
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
  /** human-readable why, e.g. "top1 已学过 → 选 rank 2" */
  selectionPath: string;
}
