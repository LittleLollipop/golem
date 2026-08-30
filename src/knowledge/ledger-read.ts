import * as fs from "node:fs";
import * as path from "node:path";
import type { LearnedFact } from "./types.js";

/**
 * Read the full knowledge trajectory (both random + purposeful records) for an
 * instance from its ledger JSON file. Returns [] when the file does not exist
 * yet (no learning has run). Shared by the remote API (golem-remote.ts) so the
 * file layout stays single-source. Mirrors `readDriftRecords` semantics.
 *
 * The ledger dir defaults to the same `FAKEREN_KNOWLEDGE_DIR ?? "./.fakeren-knowledge"`
 * the DailyKnowledgeTracker uses, so this reads exactly where learning writes.
 */
export function readKnowledgeRecords(
  instanceId: string,
  knowledgeDir: string = process.env.FAKEREN_KNOWLEDGE_DIR ?? "./.fakeren-knowledge",
): LearnedFact[] {
  const file = path.join(knowledgeDir, `${instanceId}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  try {
    const data = JSON.parse(raw) as { trajectory?: unknown };
    const traj = Array.isArray(data?.trajectory) ? data.trajectory : [];
    return traj as LearnedFact[];
  } catch {
    return [];
  }
}
