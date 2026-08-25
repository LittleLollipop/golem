/**
 * Seed-provenance stamping (req_seed_provenance).
 *
 * Channels fill `provenance.source` + `provenance.selectionPath` when they
 * produce a contribution. The assembler calls `stampInjection` once, at the
 * moment the seed is actually injected, to record `injectedAt` (real wall-clock
 * time). This keeps the audit trail grounded in verifiable injection time rather
 * than the model's事后 self-report.
 *
 * Pure & deterministic: clock is injectable so tests are hermetic. Never drops a
 * record — a seed that forgot to set provenance falls back to its seedId as the
 * source and "unknown" as the path, so the audit log is never silently empty.
 */
import type { ChannelContribution } from "../types.js";

export function stampInjection(
  contributions: ChannelContribution[],
  now: Date = new Date(),
): ChannelContribution[] {
  const iso = now.toISOString();
  for (const c of contributions) {
    c.provenance = {
      source: c.provenance?.source ?? c.seedId,
      selectionPath: c.provenance?.selectionPath ?? "unknown",
      injectedAt: iso,
    };
  }
  return contributions;
}
