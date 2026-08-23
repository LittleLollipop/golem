/**
 * Consolidator — runs memory maintenance from the idle phase (H2/req_async_precompute).
 *
 * The actual decay + recursive-growth logic lives in the sidecar (axolotl) so it
 * can operate on the real graph. Here we just schedule it. Plan B decay =
 * stop re-injecting low-weight seeds while keeping the permanent record
 * (dec_decay_planb). Conservative recursive growth = MetaNode only on
 * high-centrality clusters, low frequency (dec_recursive_growth_conservative).
 */

import type { GraphStore } from "./graph-store.js";
import type { ConsolidationReport, InstanceId } from "../types.js";

export class Consolidator {
  constructor(
    private readonly store: GraphStore,
    private readonly budget = 50,
  ) {}

  async run(instanceId: InstanceId): Promise<ConsolidationReport> {
    return this.store.consolidate(instanceId, this.budget);
  }
}
