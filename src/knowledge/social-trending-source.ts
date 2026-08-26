/**
 * SocialTrendingKnowledgeSource — a LIVE KnowledgeSource (req_l05_knowledge_trajectory).
 *
 * Pulls the trending front-page feed from Hacker News (Algolia keyless JSON API)
 * as a stand-in for "social media hot list". Per the cross-source mode policy
 * (dec_knowledge_mode_policy): social → defaultMode "top".
 *
 * - Honest & keyless: public JSON endpoint, no API key, no auth.
 * - Endpoint / tag are configurable (e.g. swap to a sub-feed or another
 *   keyless trending API) via `endpoint` / FAKEREN_SOCIAL_ENDPOINT.
 * - Resilience: a failed fetch returns [] (tracker learns nothing that day).
 * - fetchImpl is injectable for tests (no network).
 */

import type { KnowledgeCandidate, KnowledgeMode, KnowledgeSource } from "./types.js";
import { fetchJson, shuffle } from "./http.js";

export interface SocialTrendingConfig {
  /** "top" (API order / popularity) | "random" (shuffled). Default "top". */
  mode?: KnowledgeMode;
  /** HN Algolia search endpoint. Default = front-page top stories. */
  endpoint?: string;
  /** Per-request timeout. Default 8000ms. */
  timeoutMs?: number;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT =
  "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30";

interface HnHit {
  objectID?: string;
  title?: string;
  url?: string;
  points?: number;
  num_comments?: number;
  author?: string;
}

export class SocialTrendingKnowledgeSource implements KnowledgeSource {
  readonly defaultMode = "top" as const;
  private readonly mode: KnowledgeMode;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SocialTrendingConfig = {}) {
    this.mode = config.mode ?? this.defaultMode;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchImpl = config.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  async rankedCandidates(): Promise<KnowledgeCandidate[]> {
    const json = await fetchJson<{ hits?: HnHit[] }>(
      this.fetchImpl,
      this.endpoint,
      this.timeoutMs,
      { "User-Agent": "fakeren/0.1 (https://github.com/LittleLollipop; local)" },
    );
    if (!json?.hits) return [];

    let hits = json.hits.filter((h) => h.objectID && h.title);
    if (this.mode === "random") hits = shuffle(hits);

    return hits.map((h, i) => {
      const id = h.objectID!;
      const hnUrl = `https://news.ycombinator.com/item?id=${id}`;
      const target = h.url?.trim() || hnUrl;
      const meta = [`${h.points ?? 0} 分`, `${h.num_comments ?? 0} 评论`, `@${h.author ?? "?"}`].join(" · ");
      return {
        id: `social-hn-${id}`,
        title: h.title!,
        summary: `${h.title}。${meta}`,
        source: "Hacker News",
        sourceUrl: target,
        rank: i + 1,
      };
    });
  }
}
