/**
 * LearningPlanner — the model-driven "what should I learn today, on purpose?"
 * planner (req_l05 dual-track, purposeful slot only).
 *
 * On idle, it (1) reads the instance's memory graph for recent topics, (2) asks
 * the host LLM (the SAME model the agent uses — no second model) to produce a
 * `LearningDirective` (which source + optional query + rationale), and (3) returns
 * it. The directive then drives the chosen KnowledgeSource's focused fetch.
 *
 * Degradation (never throws, never blocks learning):
 *   - no graph topics  → returns null  (tracker records `empty`, no fallback)
 *   - model returns bad JSON / invalid source → returns null (tracker records `empty`)
 *   - `pinSource` (env FAKEREN_KNOWLEDGE_SOURCE) overrides the chosen source but
 *     NOT the query/mode — "lock the channel, not the model" (dec_l05 dual-track B).
 */

import type { GraphStore } from "../memory/graph-store.js";
import type { LlmClient } from "../llm/client.js";
import { stripFence } from "../llm/client.js";
import type { LearningContext, LearningDirective, KnowledgeBackend } from "./types.js";

const VALID_SOURCES: KnowledgeBackend[] = ["wiki", "news", "social", "web"];

export interface PlannerOptions {
  /** Inject recent learned titles (the tracker supplies this; avoids import cycle). */
  recentLearnedTitles: (instanceId: string) => string[];
  /** Operator pin: locks directive.source but leaves query/mode to the model. */
  pinSource?: string;
}

const PLANNER_SYSTEM = `你是林夏的长期学习规划器。基于她的记忆图库近期话题与已学清单，决定她今天"有目的"地学一条什么、从哪个来源学。
可选来源: wiki(维基百科), news(新闻RSS), social(社媒热榜), web(用搜索引擎自己搜)。
只输出 JSON，不要任何解释或额外文字。格式:
{"source":"wiki|news|social|web","mode":"top|random","query":"<聚焦关键词/搜索词，可选>","rationale":"<一句话说明为什么选它>"}
- query 仅在需要聚焦时使用：wiki 做条目检索、news/social 做关键词过滤、web 做搜索词；若只想泛览某源可不给 query。
- rationale 必须非空，用于审计"为什么今天学这个"。`;

export class LearningPlanner {
  constructor(
    private readonly llm: LlmClient,
    private readonly store: GraphStore,
    private readonly opts: PlannerOptions,
  ) {}

  async plan(instanceId: string): Promise<LearningDirective | null> {
    const ctx = await this.buildContext(instanceId);
    if (!ctx || ctx.recentTopics.length === 0) return null; // no graph → no purposeful plan
    const directive = await this.callModel(ctx);
    if (!directive) return null;
    if (this.opts.pinSource) directive.source = this.normalize(this.opts.pinSource);
    return directive;
  }

  private normalize(src: string): KnowledgeBackend {
    const s = src.toLowerCase();
    if (s === "news-rss") return "news";
    if (s === "social-hn") return "social";
    if ((VALID_SOURCES as string[]).includes(s)) return s as KnowledgeBackend;
    return "wiki";
  }

  private async buildContext(instanceId: string): Promise<LearningContext | null> {
    let recentTopics: string[] = [];
    try {
      const nodes = await this.store.query({ instanceId, limit: 30 });
      recentTopics = nodes
        .map((n) => (n.label || "").trim())
        .filter(Boolean)
        .slice(0, 20);
    } catch {
      return null;
    }
    const learnedTitles = this.opts.recentLearnedTitles(instanceId).slice(0, 15);
    let graphNodeCount = recentTopics.length;
    try {
      const stats = await this.store.stats(instanceId);
      graphNodeCount = stats.nodes;
    } catch {
      /* best-effort */
    }
    return {
      instanceId,
      date: new Date().toISOString().slice(0, 10),
      recentTopics,
      learnedTitles,
      graphNodeCount,
    };
  }

  private async callModel(ctx: LearningContext): Promise<LearningDirective | null> {
    const user = [
      `近期话题: ${ctx.recentTopics.join("、") || "(无)"}`,
      `已学内容: ${ctx.learnedTitles.join("、") || "(无)"}`,
      `图库节点数: ${ctx.graphNodeCount}`,
      `请决定今天有目的学的一条（输出 JSON）。`,
    ].join("\n");
    let raw = "";
    try {
      raw = await this.llm.complete(PLANNER_SYSTEM, user);
    } catch {
      return null; // model error → no plan (tracker records empty)
    }
    try {
      const json = JSON.parse(stripFence(raw));
      const source = this.normalize(json.source);
      if (!json || !(VALID_SOURCES as string[]).includes(source)) return null;
      return {
        source,
        mode: json.mode === "random" ? "random" : "top",
        query: typeof json.query === "string" && json.query.trim() ? json.query.trim() : undefined,
        rationale: typeof json.rationale === "string" ? json.rationale : "",
      };
    } catch {
      return null; // bad JSON → no plan
    }
  }
}
