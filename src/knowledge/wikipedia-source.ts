/**
 * WikipediaKnowledgeSource — a LIVE KnowledgeSource (req_l05_knowledge_trajectory).
 *
 * Replaces the curated offline StaticKnowledgeSource: instead of hardcoding the
 * fact text, it fetches the REAL current intro from Wikipedia (zh by default) at
 * learn time, so 林夏 genuinely "goes to wiki and learns a piece of content".
 *
 * Design contract (unchanged from StaticKnowledgeSource):
 *   - implements KnowledgeSource.rankedCandidates(): Promise<KnowledgeCandidate[]>
 *   - returns candidates ascending by rank; the tracker picks the first unlearned
 *     one ("top1 学过则 top2"), records selectionPath, dedups by id.
 *
 * Two modes:
 *   - "top": fetch the curated ranked topic list live. Preserves the
 *     top1→top2 selection narrative and per-instance dedup. After all topics are
 *     learned, returns [] (no more learning until the list grows).
 *   - "random" (default): pick a random Wikipedia article each call (endless
 *     discovery); dedup still applies via id = `wiki-<normalizedTitle>`.
 *     Per dec_knowledge_mode_policy, wiki defaults to random (news/social → top).
 *
 * Resilience: any fetch failure (network/timeout/non-200/disambiguation) is
 * skipped — the tracker then falls through to the next candidate, or returns
 * null for the day if nothing is reachable. No hardcoded fallback text.
 */

import type { KnowledgeCandidate, KnowledgeSource, LearningDirective } from "./types.js";

export interface WikiTopic {
  /** stable id — MUST stay constant across runs so per-instance dedup survives */
  id: string;
  /** Wikipedia article title (URL-encoded at fetch time) */
  title: string;
  /** real ranking: 1 = top */
  rank: number;
}

export interface WikipediaSourceConfig {
  /** Wikipedia language edition, e.g. "zh" | "en". Default "zh". */
  lang?: string;
  /** "top" (curated, ranked) or "random" (endless). Default "random". */
  mode?: "top" | "random";
  /** curated topic list for mode "top". */
  topics?: WikiTopic[];
  /** per-request timeout. Default 8000ms. */
  timeoutMs?: number;
  /** in-memory cache TTL for repeated idles within a window. Default 6h. */
  cacheTtlMs?: number;
  /** injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TOPICS: WikiTopic[] = [
  { id: "wiki-photosynthesis", title: "光合作用", rank: 1 },
  { id: "wiki-thermodynamics", title: "热力学第二定律", rank: 2 },
  { id: "wiki-mitochondria", title: "线粒体", rank: 3 },
  { id: "wiki-gutenberg", title: "古腾堡印刷术", rank: 4 },
  { id: "wiki-plate-tectonics", title: "板块构造", rank: 5 },
  { id: "wiki-recursion", title: "递归", rank: 6 },
];

interface RestSummary {
  title?: string;
  extract?: string;
  type?: string;
  content_urls?: { desktop?: { page?: string } };
}

export class WikipediaKnowledgeSource implements KnowledgeSource {
  /** Default selection mode: wiki → random (endless discovery). */
  readonly defaultMode = "random" as const;
  private readonly lang: string;
  private readonly mode: "top" | "random";
  private readonly topics: WikiTopic[];
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private cache: { at: number; items: KnowledgeCandidate[] } | null = null;

  constructor(config: WikipediaSourceConfig = {}) {
    this.lang = config.lang ?? "zh";
    this.mode = config.mode ?? this.defaultMode;
    this.topics = config.topics ?? DEFAULT_TOPICS;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.cacheTtlMs = config.cacheTtlMs ?? 6 * 3600 * 1000;
    this.fetchImpl = config.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  async rankedCandidates(directive?: LearningDirective): Promise<KnowledgeCandidate[]> {
    // Purposeful focus: a model-given query → live Wikipedia search, not the
    // curated topics. Real current intros, same shape.
    if (directive?.query && directive.query.trim()) {
      return this.fetchBySearch(directive.query.trim());
    }
    if (this.mode === "random") {
      const c = await this.fetchRandom();
      return c ? [c] : [];
    }
    if (this.cache && Date.now() - this.cache.at < this.cacheTtlMs) {
      return this.cache.items.slice().sort((a, b) => a.rank - b.rank);
    }
    const out: KnowledgeCandidate[] = [];
    for (const t of this.topics) {
      const c = await this.fetchTopic(t);
      if (c) out.push(c);
    }
    const sorted = out.sort((a, b) => a.rank - b.rank);
    this.cache = { at: Date.now(), items: sorted };
    return sorted;
  }

  /** Live Wikipedia search → top matches' current intros (purposeful focus). */
  private async fetchBySearch(query: string): Promise<KnowledgeCandidate[]> {
    const enc = encodeURIComponent(query);
    const url =
      `https://${this.lang}.wikipedia.org/w/api.php` +
      `?action=query&list=search&srsearch=${enc}&srlimit=5&format=json`;
    try {
      const j = await this.getJson<{ query?: { search?: { title?: string }[] } }>(url);
      const results = j?.query?.search ?? [];
      const out: KnowledgeCandidate[] = [];
      for (let i = 0; i < results.length; i++) {
        const title = results[i].title;
        if (!title) continue;
        const s = await this.fetchSummary(title);
        if (s) {
          out.push({
            id: `wiki-${this.slug(s.title ?? title)}`,
            title: s.title ?? title,
            summary: s.extract,
            source: "Wikipedia",
            sourceUrl: s.page,
            rank: i + 1,
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private async fetchTopic(t: WikiTopic): Promise<KnowledgeCandidate | null> {
    const s = await this.fetchSummary(t.title);
    if (!s) return null;
    return {
      id: t.id,
      title: s.title ?? t.title,
      summary: s.extract,
      source: "Wikipedia",
      sourceUrl: s.page,
      rank: t.rank,
    };
  }

  private async fetchRandom(): Promise<KnowledgeCandidate | null> {
    const url =
      `https://${this.lang}.wikipedia.org/w/api.php` +
      `?action=query&list=random&rnnamespace=0&rnlimit=1&format=json`;
    try {
      const j = await this.getJson<{ query?: { random?: { title?: string }[] } }>(url);
      const title = j?.query?.random?.[0]?.title;
      if (!title) return null;
      const s = await this.fetchSummary(title);
      if (!s) return null;
      return {
        id: `wiki-${this.slug(s.title ?? title)}`,
        title: s.title ?? title,
        summary: s.extract,
        source: "Wikipedia",
        sourceUrl: s.page,
        rank: 1,
      };
    } catch {
      return null;
    }
  }

  private async fetchSummary(
    title: string,
  ): Promise<{ title?: string; extract: string; page: string } | null> {
    const enc = encodeURIComponent(title);
    const url = `https://${this.lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`;
    try {
      const j = await this.getJson<RestSummary>(url);
      if (!j || j.type === "disambiguation") return null;
      const extract = j.extract?.trim();
      if (!extract) return null;
      const page =
        j.content_urls?.desktop?.page ?? `https://${this.lang}.wikipedia.org/wiki/${enc}`;
      return { title: j.title, extract, page };
    } catch {
      return null;
    }
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          "User-Agent": "golem/0.1 (https://github.com/LittleLollipop; local)",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      } as RequestInit);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private slug(s: string): string {
    return s.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 64);
  }
}
