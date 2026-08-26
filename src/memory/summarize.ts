/**
 * Deterministic extractive summarizer for an assistant reply.
 *
 * No LLM, no randomness, fully observable: it produces a short extract
 * (lead sentence + the most salient follow-on sentences) so a remembered
 * reply can be surfaced in recall without dumping the raw wall of text.
 *
 * This is the v1 stand-in for the LLM self-summary path (#22/#23). When that
 * lands, swap the producer but keep the `props.assistantSummary` contract so
 * RecallChannel stays unchanged.
 */

/** Split into sentences, keeping trailing punctuation on each piece. */
function splitSentences(text: string): string[] {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** CJK + word keyword set, mirrors RecallChannel.toKeywords intent. */
function keywordsOf(text: string): Set<string> {
  const t = (text ?? "").toLowerCase();
  const seen = new Set<string>();
  for (const tok of t.split(/[^\p{L}\p{N}]+/u)) {
    if (tok.length >= 2) seen.add(tok);
  }
  for (const run of t.match(/[\p{L}]+/gu) ?? []) {
    if (/[一-鿿]/.test(run)) {
      for (let i = 0; i + 2 <= run.length; i++) seen.add(run.slice(i, i + 2));
    }
  }
  return seen;
}

export interface SummarizeOpts {
  /** hard budget for the joined extract; sentence-boundary truncation if exceeded */
  maxChars?: number;
  /** max number of sentences to keep */
  maxSentences?: number;
}

export function summarizeReply(
  assistantText: string,
  userText: string,
  opts: SummarizeOpts = {},
): string {
  const maxChars = opts.maxChars ?? 120;
  const maxSentences = opts.maxSentences ?? 3;
  const sentences = splitSentences(assistantText);
  if (sentences.length === 0) return "";
  if (sentences.length === 1) {
    const only = sentences[0];
    return only.length > maxChars ? only.slice(0, maxChars) + "…" : only;
  }

  const userKw = keywordsOf(userText);
  const scored = sentences.map((s, i) => {
    let score = 0;
    if (i === 0) score += 3; // lead sentence almost always salient
    if (/[“"「『《]([^”"」』》]{2,20})[”"」』》]/.test(s)) score += 1.5; // quoted / named span
    if (/\b[A-Z][a-zA-Z]{2,}\b/.test(s)) score += 1; // latin entity
    const sKw = keywordsOf(s);
    let overlap = 0;
    for (const k of sKw) if (userKw.has(k)) overlap++;
    score += Math.min(overlap, 3); // echoes the user's own question
    return { s, i, score };
  });

  // Always keep the lead; then greedily add highest-scoring sentences that fit.
  const picked = new Set<number>([0]);
  let chars = sentences[0].length;
  const rest = scored.filter((x) => x.i !== 0).sort((a, b) => b.score - a.score);
  for (const x of rest) {
    if (picked.size >= maxSentences) break;
    if (chars + 1 + x.s.length > maxChars) continue; // would overflow the budget
    picked.add(x.i);
    chars += 1 + x.s.length;
  }

  const ordered = [...picked].sort((a, b) => a - b).map((i) => sentences[i]);
  let out = ordered.join("");
  if (out.length > maxChars) {
    // Drop trailing sentences until within budget, then hard-cap + ellipsis.
    while (ordered.length > 1 && ordered.join("").length > maxChars) ordered.pop();
    out = ordered.join("");
    if (out.length > maxChars) out = out.slice(0, maxChars) + "…";
  }
  return out;
}
