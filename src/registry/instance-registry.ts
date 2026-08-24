/**
 * InstanceRegistry — 维度 I: 以「假人」为隔离单位。
 *
 * - Every self mechanism (memory graph, learning progress, drift seed pool,
 *   valence) is scoped by `instanceId` (req_iso_unit / req_iso_namespace).
 * - Config page can create/list instances (req_iso_config_page).
 * - A session selects its instance at start; switching mid-session is rejected
 *   by an invariant (req_iso_no_mid_switch).
 * - Cross-session drift is FULL (req_iso_full_crosssession): the instance graph
 *   holds all of this instance's history; the instance *boundary* is the limit.
 */

import type { GraphStore } from "../memory/graph-store.js";
import type { InstanceId, InstanceMeta } from "../types.js";

export class InstanceRegistry {
  constructor(private readonly store: GraphStore) {}

  private async readInstances(): Promise<InstanceMeta[]> {
    return await this.store.listMeta();
  }

  async create(id: InstanceId, name: string): Promise<InstanceMeta> {
    const list = await this.readInstances();
    if (list.some((m) => m.id === id)) return list.find((m) => m.id === id)!;
    await this.store.ensureInstance(id); // creates the empty axolotl graph
    const meta: InstanceMeta = { id, name, createdAt: Date.now(), turns: 0 };
    await this.store.setMeta(id, meta);
    return meta;
  }

  async list(): Promise<InstanceMeta[]> {
    return this.readInstances();
  }

  /** Bind a session to an instance. Throws if already bound to a *different* one. */
  async select(sessionId: string, instanceId: InstanceId): Promise<void> {
    const existing = await this.current(sessionId);
    if (existing && existing !== instanceId) {
      throw new Error(
        `[no-mid-switch] session ${sessionId} already bound to "${existing}"; ` +
          `cannot switch to "${instanceId}" mid-session (req_iso_no_mid_switch).`,
      );
    }
    await this.store.bindSession(sessionId, instanceId);
  }

  async current(sessionId: string): Promise<InstanceId | null> {
    return await this.store.resolveSession(sessionId);
  }

  async touch(sessionId: string): Promise<void> {
    const id = await this.current(sessionId);
    if (!id) return;
    const m = await this.store.getMeta(id);
    if (m) {
      m.turns += 1;
      await this.store.setMeta(id, m);
    }
  }

  /** Defensive dsh invariant body: re-affirms the session's bound instance is stable. */
  async assertStable(sessionId: string, expected: InstanceId | null): Promise<void> {
    const cur = await this.current(sessionId);
    if (expected !== null && cur !== null && cur !== expected) {
      throw new Error(`[no-mid-switch] instance drift detected for ${sessionId}`);
    }
  }

  /**
   * Full cross-session history for ONE instance (req_iso_full_crosssession).
   * dsh's sessionPersistence is global, so we filter by the per-session
   * instance tag we set at select() time. Personal scale → fine; cache later.
   */
  async sessionsOf(persistence: { listSessions(): Promise<Array<{ id: string }>> }, instanceId: InstanceId): Promise<string[]> {
    const all = await persistence.listSessions();
    const out: string[] = [];
    for (const s of all) {
      if ((await this.current(s.id)) === instanceId) out.push(s.id);
    }
    return out;
  }
}
