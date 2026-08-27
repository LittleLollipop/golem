/**
 * NewsRssKnowledgeSource — a LIVE KnowledgeSource (req_l05_knowledge_trajectory).
 *
 * Pulls the day's top news from real RSS/Atom feeds and ranks by recency
 * ("top" = the source's curated/trending selection). Per the cross-source mode
 * policy (dec_knowledge_mode_policy): news → defaultMode "top".
 *
 * - Honest & keyless: plain RSS/Atom over HTTPS, no API key.
 * - Default feeds are BBC (zhongwen/en) — reliable, CORS-free, public.
 *   Override per deployment via `feeds` / FAKEREN_NEWS_FEEDS (comma-separated).
 * - Resilience: a feed that fails (timeout/non-200/unparseable) is skipped; if
 *   every feed is unreachable, rankedCandidates() returns [] (tracker learns
 *   nothing that day — no fabricated text).
 * - fetchImpl is injectable for tests (no network).
 */

import { XMLParser } from "fast-xml-parser";
import type { KnowledgeCandidate, KnowledgeMode, KnowledgeSource, LearningDirective } from "./types.js";
import { fetchText, shuffle } from "./http.js";

export interface NewsRssConfig {
  /** Feed language edition. Selects default feeds when `feeds` is unset. */
  lang?: string;
  /** "top" (recency-ranked) | "random" (shuffled). Default "top". */
  mode?: KnowledgeMode;
  /** Explicit feed URLs. Defaults to DEFAULT_FEEDS[lang]. */
  feeds?: string[];
  /** Per-request timeout. Default 8000ms. */
  timeoutMs?: number;
  /** Max items kept per feed before merge + recency sort. Default 10. */
  maxPerFeed?: number;
  /** Override User-Agent (some feeds require one). */
  userAgent?: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_FEEDS: Record<string, string[]> = {
  zh: ["https://feeds.bbci.co.uk/zhongwen/simp/rss.xml"],
  en: ["https://feeds.bbci.co.uk/news/rss.xml"],
};

const SUMMARY_CAP = 280;

/** djb2 → base36, stable id from a URL (survives dedup across days). */
function stableId(prefix: string, key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

interface RawItem {
  title: string;
  link: string;
  description: string;
  ts: number;
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#text"] === "string") return o["#text"];
    if (typeof o["@_href"] === "string") return o["@_href"];
  }
  return "";
}

function rssLinkOf(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return rssLinkOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (o["@_href"] as string) ?? (o["#text"] as string) ?? "";
  }
  return "";
}

function atomLinkOf(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const alt = v.find((l) => l && (l["@_rel"] === "alternate" || l["@_rel"] === undefined));
    return atomLinkOf(alt ?? v[0]);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (o["@_href"] as string) ?? (o["#text"] as string) ?? "";
  }
  return "";
}

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

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseDate(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

export class NewsRssKnowledgeSource implements KnowledgeSource {
  readonly defaultMode = "top" as const;
  private readonly lang: string;
  private readonly mode: KnowledgeMode;
  private readonly feeds: string[];
  private readonly timeoutMs: number;
  private readonly maxPerFeed: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly parser: XMLParser;

  constructor(config: NewsRssConfig = {}) {
    this.lang = config.lang ?? "zh";
    this.mode = config.mode ?? this.defaultMode;
    this.feeds = config.feeds ?? DEFAULT_FEEDS[this.lang] ?? DEFAULT_FEEDS.en;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.maxPerFeed = config.maxPerFeed ?? 10;
    this.userAgent = config.userAgent ?? "fakeren/0.1 (https://github.com/LittleLollipop; local)";
    this.fetchImpl = config.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  }

  async rankedCandidates(directive?: LearningDirective): Promise<KnowledgeCandidate[]> {
    const raw: RawItem[] = [];
    for (const feed of this.feeds) {
      const xml = await fetchText(this.fetchImpl, feed, this.timeoutMs, {
        "User-Agent": this.userAgent,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      });
      if (!xml) continue;
      for (const it of this.parseFeed(xml).slice(0, this.maxPerFeed)) raw.push(it);
    }
    if (raw.length === 0) return [];

    const seen = new Set<string>();
    const collected: { cand: KnowledgeCandidate; ts: number }[] = [];
    for (const it of raw) {
      const title = stripHtml(it.title);
      const url = it.link.trim();
      if (!title || !url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const desc = stripHtml(it.description);
      const summary = desc.length > SUMMARY_CAP ? desc.slice(0, SUMMARY_CAP - 1) + "…" : desc;
      collected.push({
        ts: it.ts,
        cand: {
          id: stableId("news", url),
          title,
          summary: summary ? `${title}。${summary}` : title,
          source: "News",
          sourceUrl: url,
          rank: 0,
        },
      });
    }
    if (collected.length === 0) return [];

    // Purposeful focus: keyword filter (directive.query) on title+summary.
    let filtered = collected;
    const q = directive?.query?.trim().toLowerCase();
    if (q) {
      filtered = collected.filter((c) =>
        (c.cand.title + " " + c.cand.summary).toLowerCase().includes(q),
      );
    }
    if (filtered.length === 0) return [];

    // "top" → recency desc; "random" → shuffled.
    const ordered =
      this.mode === "random"
        ? shuffle(filtered)
        : filtered.sort((a, b) => b.ts - a.ts);

    return ordered.map((c, i) => ({ ...c.cand, rank: i + 1 }));
  }

  private parseFeed(xml: string): RawItem[] {
    let doc: any;
    try {
      doc = this.parser.parse(xml);
    } catch {
      return [];
    }
    const channel = doc?.rss?.channel;
    if (channel?.item) {
      const arr = Array.isArray(channel.item) ? channel.item : [channel.item];
      return arr.map((it: any) => ({
        title: textOf(it?.title),
        link: rssLinkOf(it?.link),
        description: textOf(it?.description ?? it?.encoded),
        ts: parseDate(textOf(it?.pubDate)),
      }));
    }
    if (doc?.feed?.entry) {
      const arr = Array.isArray(doc.feed.entry) ? doc.feed.entry : [doc.feed.entry];
      return arr.map((it: any) => ({
        title: textOf(it?.title),
        link: atomLinkOf(it?.link),
        description: textOf(it?.summary ?? it?.content),
        ts: parseDate(textOf(it?.updated ?? it?.published)),
      }));
    }
    return [];
  }
}
