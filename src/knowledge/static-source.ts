/**
 * StaticKnowledgeSource — the default KnowledgeSource (req_l05_knowledge_trajectory).
 *
 * A curated set of REAL facts, each with a real Wikipedia citation URL and a
 * stable rank. This keeps L0.5 honest and reproducible offline (no black-box
 * network call, no API key). The ranking mimics "Google/Wiki 真实排名": rank 1
 * is the "top" fact; if it's already learned, the tracker falls through to rank 2
 * ("top1 学过则 top2").
 *
 * To use a live source, implement KnowledgeSource against a real search/lookup
 * API and inject it instead — nothing else in the pipeline changes.
 */

import type { KnowledgeCandidate, KnowledgeSource, LearningDirective } from "./types.js";

const FACTS: KnowledgeCandidate[] = [
  {
    id: "wiki-photosynthesis",
    title: "光合作用",
    summary: "绿色植物与部分细菌利用光能将二氧化碳和水转化为有机物并释放氧气，是地表绝大多数生命的能量起点。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Photosynthesis",
    rank: 1,
  },
  {
    id: "wiki-thermodynamics",
    title: "热力学第二定律",
    summary: "孤立系统的熵不自发减少，能量转化总有耗散；它解释了为何时间有方向、为何永动机不可能。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Second_law_of_thermodynamics",
    rank: 2,
  },
  {
    id: "wiki-mitochondria",
    title: "线粒体",
    summary: "真核细胞的「能量工厂」，通过有氧呼吸产生绝大多数 ATP；它有自己的环状 DNA，源于远古的内共生。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Mitochondrion",
    rank: 3,
  },
  {
    id: "wiki-gutenberg",
    title: "古腾堡印刷术",
    summary: "15 世纪活字印刷让知识得以廉价复制，直接催化了宗教改革与科学革命的传播。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Printing_press",
    rank: 4,
  },
  {
    id: "wiki-plate-tectonics",
    title: "板块构造",
    summary: "地壳分裂为若干缓慢移动的板块，其碰撞与张裂塑造了山脉、海沟与地震带。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Plate_tectonics",
    rank: 5,
  },
  {
    id: "wiki-recursion",
    title: "递归",
    summary: "一个过程在定义中调用自身，是数学归纳与计算机科学里最基础的结构之一。",
    source: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Recursion",
    rank: 6,
  },
];

export class StaticKnowledgeSource implements KnowledgeSource {
  /** Curated, ranked facts → "top" mode. */
  readonly defaultMode = "top" as const;
  // directive is ignored: static is a mechanical fallback source (no focus).
  async rankedCandidates(_directive?: LearningDirective): Promise<KnowledgeCandidate[]> {
    return FACTS.slice().sort((a, b) => a.rank - b.rank);
  }
}
