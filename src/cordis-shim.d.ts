/**
 * Minimal Cordis shim so the plugin type-checks standalone (dsh provides the
 * real cordis at runtime). Only the surface golem touches is declared.
 */
declare module "cordis" {
  /** The real Cordis Context is structural; we keep it loose here. */
  export type Context = any;
  export interface Plugin {}
}
