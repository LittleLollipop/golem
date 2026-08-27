/**
 * KnowledgeSourceRegistry — indexes all live KnowledgeSources by backend name
 * (req_l05 dual-track). Only the selected source incurs IO (lazy per call).
 *
 * Backend names map 1:1 to `LearningDirective.source` values the planner emits:
 *   wiki | news | social | web | static.
 * `get()` falls back to `defaultBackend` for an unknown/empty key, so a planner
 * mistake never throws — it degrades to the default source.
 */

import type { KnowledgeSource, KnowledgeBackend } from "./types.js";

export class KnowledgeSourceRegistry {
  private readonly map: Record<string, KnowledgeSource>;
  private readonly defaultBackend: KnowledgeBackend;

  constructor(sources: Record<string, KnowledgeSource>, defaultBackend: KnowledgeBackend = "wiki") {
    this.map = sources;
    this.defaultBackend = defaultBackend;
  }

  get(backend: string | undefined): KnowledgeSource {
    if (backend && this.map[backend]) return this.map[backend];
    return this.map[this.defaultBackend] ?? Object.values(this.map)[0];
  }

  /** Backend names registered (for diagnostics / startup logging). */
  backends(): string[] {
    return Object.keys(this.map);
  }
}
