/**
 * WebSearchKnowledgeSource — a LIVE "search engine" KnowledgeSource
 * (req_l05_knowledge_trajectory, purposeful track, full-open per user decision).
 *
 * Lets the model-driven planner "use a search engine to search on its own":
 * rankedCandidates(directive) performs a real web search for `directive.query`
 * and returns the top results as candidates. The model only picks the *topic*;
 * the content still comes from a real fetch — no fabrication.
 *
 * - Default backend: DuckDuckGo HTML (keyless, public). Override the endpoint
 *   via `endpoint` / FAKEREN_SEARCH_ENDPOINT (swap to any keyless search that
 *   returns HTML with `result__a`/`result__snippet`/`uddg=` patterns).
 * - Returns [] when no query is given (the planner always supplies one for web)
 *   or when the fetch fails — the tracker then records an `empty`/`error` status,
 *   never fabricated text.
 * - fetchImpl is injectable for tests (no network).
 */

import type { KnowledgeCandidate, KnowledgeSource, LearningDirective } from "./types.js";
import { fetchText } from "./http.js";

export interface WebSearchConfig {
  /** Search endpoint. Default = DuckDuckGo HTML. */
  endpoint?: string;
  /** "top" (ranked results) — only mode used; kept for interface symmetry. */
  mode?: "top" | "random";
  /** Per-request timeout. Default 8000ms. */
  timeoutMs?: number;
  /** Max results kept. Default 5. */
  maxResults?: number;
  /** Override User-Agent. */
  userAgent?: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/?q=";

const ENT: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, k) => (k in ENT ? ENT[k] : m));
}

function stripHtmlLight(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** djb2 → base36, stable id from a URL (survives dedup across days). */
function stableId(prefix: string, key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

interface ParsedResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchKnowledgeSource implements KnowledgeSource {
  readonly defaultMode = "top" as const;
  private readonly endpoint: string;
  private readonly mode: "top" | "random";
  private readonly timeoutMs: number;
  private readonly maxResults: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: WebSearchConfig = {}) {
    this.endpoint = config.endpoint ?? process.env.FAKEREN_SEARCH_ENDPOINT ?? DEFAULT_ENDPOINT;
    this.mode = config.mode ?? "top";
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.maxResults = config.maxResults ?? 5;
    this.userAgent = config.userAgent ?? "fakeren/0.1 (https://github.com/LittleLollipop; local)";
    this.fetchImpl = config.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  async rankedCandidates(directive?: LearningDirective): Promise<KnowledgeCandidate[]> {
    const q = directive?.query?.trim();
    if (!q) return []; // planner always supplies a query for web; otherwise nothing
    const url = `${this.endpoint}${encodeURIComponent(q)}`;
    const html = await fetchText(this.fetchImpl, url, this.timeoutMs, {
      "User-Agent": this.userAgent,
      Accept: "text/html",
    });
    if (!html) return [];

    const results = this.parseResults(html).slice(0, this.maxResults);
    if (this.mode === "random" && results.length > 1) {
      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j], results[i]];
      }
    }
    return results.map((r, i) => ({
      id: stableId("web", r.url),
      title: r.title || "(无标题)",
      summary: r.snippet ? `${r.title}。${r.snippet}` : r.title,
      source: "Web",
      sourceUrl: r.url,
      rank: i + 1,
    }));
  }

  private parseResults(html: string): ParsedResult[] {
    const out: ParsedResult[] = [];
    const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gs;

    const titles: { href: string; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(html))) {
      titles.push({ href: m[1], text: stripHtmlLight(m[2] ?? "") });
    }
    const snippets: string[] = [];
    while ((m = snippetRe.exec(html))) {
      snippets.push(stripHtmlLight(m[1] ?? ""));
    }
    for (let i = 0; i < titles.length; i++) {
      let url = titles[i].href;
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try {
          url = decodeURIComponent(uddg[1]);
        } catch {
          /* keep raw */
        }
      }
      // Drop duckduckgo internal / redirect hosts — only keep real external hits.
      try {
        if (new URL(url).hostname.endsWith("duckduckgo.com")) continue;
      } catch {
        /* keep raw */
      }
      out.push({ title: titles[i].text || "(无标题)", url, snippet: snippets[i] ?? "" });
    }
    return out;
  }
}
