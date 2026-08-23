/**
 * Ambient type shim for `@deepseek-ai/dsh-llm`.
 *
 * At compile time fakeren does NOT take a dependency on dsh's internal llm
 * package (keeps C3 clean — only adapter/dsh-seams.ts touches dsh). At runtime
 * dsh's own node_modules tree (under which fakeren is symlinked) resolves the
 * real module. We declare only the slice we use.
 */
declare module "@deepseek-ai/dsh-llm" {
  export function createUserMessage(input: {
    content: string | Array<{ type: string; text?: string }>;
    source: { kind: string; [key: string]: unknown };
  }): { id: string; role: "user"; content: unknown; source: unknown };
}
