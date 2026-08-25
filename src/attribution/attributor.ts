/**
 * Output-level contamination attribution (req_output_attribution).
 *
 * CRITICAL CONSTRAINT (decision_attribution_max_first + requirements §71): attribution
 * MUST be based on a VERIFIABLE signal, never on the model's self-report. Asking
 * the model "which seed influenced you?" is exactly the fabrication
 * `rule_mechanism_first` forbids — it just invents a plausible story.
 *
 * The verifiable signal used here is TEXT OVERLAP between each injected seed and
 * the produced output (character-bigram coverage, language-agnostic). On top of
 * that, `counterfactualDiff` isolates the "contamination delta" by comparing the
 * output WITH the leak block against a baseline WITHOUT it. No LLM call, no model
 * claim — pure, replayable, auditable.
 *
 * "按最全做" (max-first): we attribute against the FULL seed text and FULL output,
 * degrading only if a seed has no extractable signal.
 */

export interface SeedInput {
  seedId: string;
  channel: string;
  /** raw seed content (the text that was injected) */
  content: string;
}

export interface SeedAttribution {
  seedId: string;
  channel: string;
  /** overlap coverage 0..1: fraction of the seed's bigrams present in the output */
  score: number;
  matchedBigrams: number;
  content: string;
}

export interface AttributionReport {
  /** seeds ranked by influence (only those with score > 0) */
  attributed: SeedAttribution[];
  totalMatched: number;
  /** always "text-overlap" — the verifiable method, explicitly NOT model self-report */
  method: "text-overlap";
}

/** Strip a leading [channel-label] tag and punctuation, lowercase. */
function normalize(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, "").replace(/[\s\p{P}]+/gu, "").toLowerCase();
}

function bigrams(text: string): string[] {
  const t = normalize(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Verifiable overlap coverage of a single seed against the output. */
export function overlapScore(seedContent: string, output: string): number {
  const sb = bigrams(seedContent);
  if (sb.length === 0) return 0;
  const ob = new Set(bigrams(output));
  let hit = 0;
  for (const g of sb) if (ob.has(g)) hit++;
  return hit / sb.length;
}

/**
 * Attribute an output back to the seeds that likely contaminated it. Pure &
 * synchronous — no LLM, no model self-report (req_output_attribution).
 */
export function attribute(output: string, seeds: SeedInput[]): AttributionReport {
  const attributed: SeedAttribution[] = [];
  let totalMatched = 0;
  for (const s of seeds) {
    const sb = bigrams(s.content);
    if (sb.length === 0) continue;
    const ob = new Set(bigrams(output));
    let hit = 0;
    for (const g of sb) if (ob.has(g)) hit++;
    if (hit > 0) {
      attributed.push({
        seedId: s.seedId,
        channel: s.channel,
        score: hit / sb.length,
        matchedBigrams: hit,
        content: s.content,
      });
      totalMatched += hit;
    }
  }
  attributed.sort((a, b) => b.score - a.score);
  return { attributed, totalMatched, method: "text-overlap" };
}

export interface CounterfactualDiff {
  /** bigrams present WITH the leak but absent WITHOUT it → the contamination delta */
  added: string[];
  /** bigrams present WITHOUT but absent WITH (what the leak suppressed) */
  removed: string[];
  /** coverage of the with-leak output that is NOT explained by the baseline */
  addedCoverage: number;
}

/**
 * Counterfactual re-run diff (the only methodologically sound attribution per
 * requirements §142-144): same params, one run WITH the seed, one WITHOUT, diff
 * the outputs. Isolates what the leak added / removed.
 */
export function counterfactualDiff(withLeak: string, withoutLeak: string): CounterfactualDiff {
  const a = bigrams(withLeak);
  const b = new Set(bigrams(withoutLeak));
  const aSet = new Set(a);
  const addedSet = new Set<string>();
  for (const g of a) if (!b.has(g)) addedSet.add(g);
  const removedSet = new Set<string>();
  for (const g of b) if (!aSet.has(g)) removedSet.add(g);
  return {
    added: [...addedSet],
    removed: [...removedSet],
    addedCoverage: a.length ? addedSet.size / a.length : 0,
  };
}
