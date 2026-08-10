import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
      // The domain package holds the rules. It carries the repo's highest bar.
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
