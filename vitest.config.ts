import { defineConfig } from "vitest/config";

/**
 * fakeren uses the ESM-TS import style (relative imports carry a `.js`
 * extension that maps to a `.ts` source file). Vite's resolver does not rewrite
 * `.js` → `.ts` on its own, so we add a tiny resolveId hook that does it for
 * relative specifiers. This keeps the source free of path hacks while letting
 * vitest load it.
 */
export default defineConfig({
  plugins: [
    {
      name: "fakeren-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!importer || !source.startsWith(".") || !source.endsWith(".js")) {
          return null;
        }
        const tsSpec = source.replace(/\.js$/, ".ts");
        const resolved = await this.resolve(tsSpec, importer, { skipSelf: true });
        return resolved ?? null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
